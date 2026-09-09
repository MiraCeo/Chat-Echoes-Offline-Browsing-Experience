import { readFile, writeFile, cp, mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resourceMatches } from './archive-resources.mjs';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export const previewKind = resource => {
  const extension = extname(resource.name || resource.local_path || '').toLowerCase();
  const mime = resource.mime_type || '';
  if (mime === 'application/pdf' || extension === '.pdf') return 'pdf';
  if (mime.includes('spreadsheetml') || extension === '.xlsx') return 'xlsx';
  if (mime.includes('wordprocessingml') || extension === '.docx') return 'docx';
  if (mime.startsWith('text/') || ['.txt', '.md', '.log', '.csv', '.json'].includes(extension)) return 'txt';
  return null;
};

const replaceText = (root, before, after) => {
  for (const node of root.childNodes || []) {
    if (node.nodeType === 3) node.nodeValue = node.nodeValue.replaceAll(before, after);
    else replaceText(node, before, after);
  }
};

const restoreClipboardBlockquote = source => {
  const lines = String(source || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const firstTask = lines.findIndex(line => /^Task\s+:/.test(line));
  if (firstTask < 0) return lines.join('\n');
  return lines.map((line, index) => index < firstTask ? line : line ? `> ${line}` : '>').join('\n');
};

const replacePastedProse = (document, container, source) => {
  const lines = String(source || '').split('\n');
  const firstQuote = lines.findIndex(line => /^>\s?/.test(line));
  const appendLines = (parent, values, quote = false) => {
    const paragraph = document.createElement('p');
    values.forEach((value, index) => {
      const span = document.createElement('span');
      span.textContent = quote ? value.replace(/^>\s?/, '') : value;
      paragraph.append(span);
      if (index < values.length - 1) paragraph.append(document.createElement('br'));
    });
    parent.append(paragraph);
  };
  container.innerHTML = '';
  const plain = (firstQuote < 0 ? lines : lines.slice(0, firstQuote)).filter((line, index, values) =>
    line || values.slice(index + 1).some(Boolean));
  if (plain.length) appendLines(container, plain);
  if (firstQuote >= 0) {
    const quote = document.createElement('blockquote');
    appendLines(quote, lines.slice(firstQuote), true);
    container.append(quote);
  }
};

export async function buildFilePreviews(document, projectRoot, outputRoot, conversation, templates, sourceRoot, sampleAssets = false) {
  const assets = join(outputRoot, 'previews');
  const templateAssets = join(assets, 'templates');
  await mkdir(assets, { recursive: true });
  await mkdir(templateAssets, { recursive: true });
  const candidates = [process.env.CEOBE_PYTHON, 'python', join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')].filter(Boolean);
  const sampleRoot = join(sourceRoot, 'preview-inputs');
  const sampleSpecs = [
    { key: 'txt', kind: 'txt', name: 'apk构筑.txt' },
    { key: 'docx', kind: 'docx', name: 'LMS.docx' },
    { key: 'pdf', kind: 'pdf', name: '技术部-开发组-加分题.pdf', source: join(sampleRoot, '技术部-开发组-加分题.pdf') },
    { key: 'xlsx', kind: 'xlsx', name: '票据收集情况.xlsx', source: join(sampleRoot, '票据收集情况.xlsx') },
    { key: 'pasted', kind: 'pasted', parserKind: 'txt', name: '粘贴的文本 (1).txt', source: join(sampleRoot, '粘贴的文本.txt'), restoreBlockquote: true, entryPoint: 'card' },
    { key: 'pasted-reference', kind: 'pasted-reference', parserKind: 'txt', name: '粘贴的文本 (1).txt', source: join(sampleRoot, '粘贴的文本.txt'), restoreBlockquote: true, entryPoint: 'reference' },
  ];
  const bigPasteAttachments = Object.values(conversation.messages || {}).flatMap(message =>
    (message.attachments || []).filter(attachment => attachment.is_big_paste));
  const archivedSpecs = (conversation.resources || [])
    .filter(resource => resource.status === 'downloaded' && resource.local_path && previewKind(resource))
    .flatMap(resource => {
      const isBigPaste = resource.is_big_paste || bigPasteAttachments.some(attachment => resourceMatches(resource, attachment));
      const base = {
        key: `file-${resource.key}`,
        kind: isBigPaste ? 'pasted' : previewKind(resource),
        parserKind: previewKind(resource),
        name: resource.name,
        resourceKey: resource.key,
        source: join(sourceRoot, resource.local_path),
        entryPoint: 'card',
      };
      return isBigPaste
        ? [base, { ...base, key: `${base.key}-reference`, kind: 'pasted-reference', entryPoint: 'reference' }]
        : [base];
    });
  const specs = sampleAssets ? sampleSpecs : archivedSpecs;
  for (const element of document.querySelectorAll('[data-ceobe-open-preview]')) element.removeAttribute('data-ceobe-open-preview');
  if (!specs.length) return new Map();
  const imports = [...new Set(specs.flatMap(spec => (spec.parserKind || spec.kind) === 'pdf' ? ['pypdfium2'] : (spec.parserKind || spec.kind) === 'xlsx' ? ['openpyxl'] : []))];
  const probe = imports.length ? `import ${imports.join(', ')}` : 'pass';
  const python = candidates.find(exe => spawnSync(exe, ['-c', probe], { windowsHide: true }).status === 0);
  if (specs.some(spec => spec.source) && !python) throw new Error(`File previews require Python${imports.length ? ` with ${imports.join(' and ')}` : ''}. Set CEOBE_PYTHON to a compatible executable.`);
  const names = new Map(specs.filter(spec => spec.entryPoint !== 'reference').map(spec => [spec.name, spec.key]));
  // The same file has different official viewers at the card and citation entry points.
  names.set('粘贴的文本 (1).txt', 'pasted');
  const byId = new Map();
  const previewFiles = new Map();
  for (const message of Object.values(conversation.messages)) {
    for (const reference of message.content_references || []) {
      if (names.has(reference.name)) byId.set(reference.id, reference.name === '粘贴的文本 (1).txt' ? 'pasted-reference' : names.get(reference.name));
    }
  }
  for (const spec of specs) {
    const { key, kind, name } = spec;
    const pane = templates.clone(`preview:${kind}`, document);
    const originalName = { txt: 'apk构筑.txt', docx: 'LMS.docx', pdf: '技术部-开发组-加分题.pdf', xlsx: '票据收集情况.xlsx' }[kind];
    if (originalName && originalName !== name) replaceText(pane, originalName, name);
    let data = { pages: [], sheets: [], html: '' };
    let assetFolder = '';
    if (spec.source) {
      assetFolder = key.replace(/[^a-zA-Z0-9_-]/g, '_');
      const preparedRoot = join(assets, assetFolder);
      await mkdir(preparedRoot, { recursive: true });
      const result = spawnSync(python, [join(projectRoot, 'scripts/prepare-preview-data.py'), spec.source, preparedRoot, spec.parserKind || kind], { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0) throw new Error(result.stderr || `Attachment preview preparation failed: ${name}`);
      console.log(result.stdout.trim());
      data = JSON.parse(await readFile(join(preparedRoot, 'manifest.json'), 'utf8'));
    }
    if (kind === 'pasted-reference') {
      pane.setAttribute('data-ceobe-pasted-reference', '');
      if (!data.text) {
        const lines = pane.querySelectorAll('.cm-content > .cm-line').length;
        for (const gap of pane.querySelectorAll('.cm-gap')) {
          const notice = document.createElement('div');
          notice.className = 'cm-line text-token-text-secondary';
          notice.setAttribute('data-ceobe-incomplete-preview', '');
          notice.textContent = `此网页快照仅捕获前 ${lines} 行，后续日志尚未保存。`;
          gap.replaceWith(notice);
        }
      }
    }
    if (kind === 'pasted') {
      names.set(pane.querySelector('h2').textContent.trim(), key);
      // Silk's runtime-only attributes are replaced by the native dialog lifecycle.
      for (const element of [pane, ...pane.querySelectorAll('[data-silk]')]) element.removeAttribute('data-silk');
    }
    // Only copy the preview subtree: no account state, live scripts or conversation DOM.
    for (const element of pane.querySelectorAll('script, iframe')) element.remove();
    for (const element of [pane, ...pane.querySelectorAll('*')]) {
      for (const attr of element.getAttributeNames()) if (/^on/i.test(attr)) element.removeAttribute(attr);
    }
    for (const use of pane.querySelectorAll('use')) use.setAttribute('href', use.getAttribute('href').replace('sprites-core-ff27b486', 'sprites-core-26c3f2d4').replace('sprites-shell-45f921f2', 'sprites-shell-097001e7'));
    for (const button of pane.querySelectorAll('button')) {
      button.setAttribute('tabindex', '-1');
      if (button.getAttribute('aria-label') === '关闭' || (key === 'pasted' && button.textContent.trim() === '关闭')) {
        button.setAttribute('data-ceobe-close-preview', '');
        button.setAttribute('tabindex', '0');
        button.removeAttribute('aria-controls');
        button.removeAttribute('aria-expanded');
      }
    }
    if (kind === 'txt' && data.html) pane.querySelector('.ProseMirror').innerHTML = data.html;
    if (['pasted', 'pasted-reference'].includes(kind) && data.text) {
      const text = spec.restoreBlockquote ? restoreClipboardBlockquote(data.text) : data.text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
      if (kind === 'pasted') replacePastedProse(document, pane.querySelector('.ProseMirror'), text);
      else {
        const content = pane.querySelector('.cm-content');
        content.replaceChildren(...text.split('\n').map(value => {
          const line = document.createElement('div');
          line.className = 'cm-line';
          line.textContent = value;
          if (!value) line.append(document.createElement('br'));
          return line;
        }));
        for (const gap of pane.querySelectorAll('.cm-gap')) gap.remove();
        pane.setAttribute('data-ceobe-complete-preview', 'clipboard-recovery');
      }
    }
    if (kind === 'docx' && data.html) {
      const panel = pane.querySelector('[data-testid="docx-preview-panel"]');
      const article = panel?.querySelector('.artifact-docx-preview-wrapper > .artifact-docx-preview > article');
      if (!article) throw new Error('Frozen official DOCX preview DOM is incomplete');
      // Keep the captured ChatGPT document viewer and page DOM intact. Only the
      // document body is data-driven; replacing the panel itself discards the
      // official page wrapper, dimensions, padding and scrolling surface.
      article.innerHTML = data.html;
      panel.setAttribute('aria-label', name);
      pane.setAttribute('aria-label', name);
    }
    if (kind === 'pdf') {
      const parent = pane.querySelector('[data-testid="artifact-pdf-preview-surface"] > div');
      const pageTemplate = parent.firstElementChild.cloneNode(true);
      parent.innerHTML = '';
      data.pages.forEach((page, index) => {
        const node = pageTemplate.cloneNode(true);
        node.setAttribute('data-testid', `artifact-pdf-page-${index + 1}`);
        node.style.width = page.width + 'px'; node.style.height = page.height + 'px';
        node.innerHTML = `<img src="./previews/${assetFolder}/${page.src}" alt="${escape(name)} 第 ${index + 1} 页" width="${page.width}" height="${page.height}" style="width:100%;height:100%;display:block" loading="lazy">`;
        parent.append(node);
      });
    }
    if (kind === 'xlsx') {
      const viewport = pane.querySelector('[data-testid="popcorn-viewport-host"]');
      viewport.classList.add('ceobe-sheet-viewport');
      viewport.innerHTML = data.sheets.map((sheet, index) => {
        const columns = sheet.widths.map((width, c) => `<th style="min-width:${width}px;width:${width}px">${String.fromCharCode(65 + c)}</th>`).join('');
        const rows = sheet.rows.map((row, r) => `<tr style="height:${sheet.heights[r]}px"><th>${r + 1}</th>${row.map(cell => `<td style="color:${cell.color};background:${cell.fill};font-size:${cell.size}px;font-weight:${cell.bold ? 700 : 400};font-style:${cell.italic ? 'italic' : 'normal'};text-align:${['left','right','center'].includes(cell.align) ? cell.align : 'left'};white-space:${cell.wrap ? 'pre-wrap' : 'pre'}">${escape(cell.value)}</td>`).join('')}</tr>`).join('');
        return `<table class="ceobe-sheet-grid" data-ceobe-sheet="${index}" aria-label="${escape(sheet.name)}" ${index ? 'hidden' : ''}><thead><tr><th></th>${columns}</tr></thead><tbody>${rows}</tbody></table>`;
      }).join('');
      for (const [index, button] of [...pane.querySelectorAll('[data-testid^="popcorn-sheet-tab-"]')].entries()) {
        button.setAttribute('data-ceobe-sheet-tab', String(index));
        button.setAttribute('tabindex', '0');
        button.setAttribute('aria-pressed', String(index === 0));
      }
    }
    // Keep the official viewer DOM out of the conversation document. The
    // browser fetches and parses this fragment only when its opener is used.
    const previewFile = `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.html`;
    await writeFile(join(templateAssets, previewFile), pane.outerHTML, 'utf8');
    previewFiles.set(key, previewFile);
  }
  const existingStylesheets = new Set([...document.querySelectorAll('link[rel="stylesheet"]')]
    .map(link => basename(link.getAttribute('href') || '')));
  for (const filename of templates.manifest.preview_stylesheets || []) {
    if (existingStylesheets.has(filename)) continue;
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = `./assets/${filename}`;
    document.head.append(css);
  }
  for (const spec of specs) if (spec.resourceKey) {
    const resource = (conversation.resources || []).find(item => item.key === spec.resourceKey);
    for (const identifier of [resource?.key, ...(resource?.aliases || []), ...(resource?.pointers || [])].filter(Boolean)) byId.set(identifier, spec.key);
  }
  for (const citation of document.querySelectorAll('[data-file-citation-primary-file-id]')) {
    const key = byId.get(citation.getAttribute('data-file-citation-primary-file-id'));
    if (key) {
      citation.setAttribute('data-ceobe-open-preview', key);
      citation.setAttribute('data-ceobe-preview-file', previewFiles.get(key));
      citation.querySelector('button')?.setAttribute('tabindex', '0');
    }
  }
  for (const button of document.querySelectorAll('button')) {
    const key = names.get(button.getAttribute('aria-label')) || names.get(button.textContent.trim());
    if (key) {
      button.setAttribute('data-ceobe-open-preview', key);
      button.setAttribute('data-ceobe-preview-file', previewFiles.get(key));
      button.setAttribute('tabindex', '0');
    }
  }
  const script = document.createElement('script'); script.type = 'module'; script.src = './file-previews.js'; document.body.append(script);
  await cp(join(projectRoot, 'scripts/file-previews.js'), join(outputRoot, 'file-previews.js'));
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = './file-previews.css'; document.head.append(css);
  await cp(join(projectRoot, 'scripts/file-previews.css'), join(outputRoot, 'file-previews.css'));
  await cp(assets,join(outputRoot,'public/previews'),{recursive:true});
  return previewFiles;
}
