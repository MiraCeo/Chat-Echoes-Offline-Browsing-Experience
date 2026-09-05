import { readFile, readdir, cp, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseHTML } from 'linkedom';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export async function buildFilePreviews(document, projectRoot, outputRoot, conversation) {
  const root = join(projectRoot, '文件');
  const assets = join(outputRoot, 'previews');
  await mkdir(assets, { recursive: true });
  const candidates = [process.env.CEOBE_PYTHON, 'python', join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')].filter(Boolean);
  const python = candidates.find(exe => spawnSync(exe, ['-c', 'import pypdfium2, openpyxl'], { windowsHide: true }).status === 0);
  if (!python) throw new Error('File previews require Python with pypdfium2 and openpyxl. Set CEOBE_PYTHON to that Python executable.');
  const result = spawnSync(python, [join(projectRoot, 'scripts/prepare-preview-data.py'), root, assets], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || 'Attachment preview preparation failed');
  console.log(result.stdout.trim());
  const data = JSON.parse(await readFile(join(assets, 'manifest.json'), 'utf8'));
  const specs = [
    ['txt', '文件', 'apk构筑.txt'], ['docx', 'docx', 'LMS.docx'],
    ['pdf', 'pdf', '技术部-开发组-加分题.pdf'], ['xlsx', 'xlsx', '票据收集情况.xlsx'],
    ['pasted', '粘贴的文本', '粘贴的文本 (1).txt'],
    ['pasted-reference', '粘贴的文本2', '粘贴的文本 (1).txt'],
  ];
  const names = new Map(specs.map(([key, , name]) => [name, key]));
  // The same file has different official viewers at the card and citation entry points.
  names.set('粘贴的文本 (1).txt', 'pasted');
  const byId = new Map();
  for (const message of Object.values(conversation.messages)) {
    for (const reference of message.content_references || []) {
      if (names.has(reference.name)) byId.set(reference.id, reference.name === '粘贴的文本 (1).txt' ? 'pasted-reference' : names.get(reference.name));
    }
  }
  const copied = new Set();
  for (const [key, snapshot, name] of specs) {
    const source = parseHTML(await readFile(join(root, snapshot + '.html'), 'utf8')).document;
    const pane = key === 'pasted' ? source.querySelector('.content-sheet.popup')
      : source.querySelector('[data-testid="artifact-preview-side-pane-surface"]').closest('aside');
    if (!pane) throw new Error(`Missing preview DOM in ${snapshot}.html`);
    if (key === 'pasted-reference') {
      pane.setAttribute('data-ceobe-pasted-reference', '');
      const lines = pane.querySelectorAll('.cm-content > .cm-line').length;
      for (const gap of pane.querySelectorAll('.cm-gap')) {
        const notice = source.createElement('div');
        notice.className = 'cm-line text-token-text-secondary';
        notice.setAttribute('data-ceobe-incomplete-preview', '');
        notice.textContent = `此网页快照仅捕获前 ${lines} 行，后续日志尚未保存。`;
        gap.replaceWith(notice);
      }
    }
    if (key === 'pasted') {
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
    if (key === 'pdf') {
      const parent = pane.querySelector('[data-testid="artifact-pdf-preview-surface"] > div');
      const pageTemplate = parent.firstElementChild.cloneNode(true);
      parent.innerHTML = '';
      data.pages.forEach((page, index) => {
        const node = pageTemplate.cloneNode(true);
        node.setAttribute('data-testid', `artifact-pdf-page-${index + 1}`);
        node.style.width = page.width + 'px'; node.style.height = page.height + 'px';
        node.innerHTML = `<img src="./previews/${page.src}" alt="${escape(name)} 第 ${index + 1} 页" width="${page.width}" height="${page.height}" style="width:100%;height:100%;display:block" loading="lazy">`;
        parent.append(node);
      });
    }
    if (key === 'xlsx') {
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
    const template = document.createElement('template');
    template.setAttribute('data-ceobe-preview', key);
    template.innerHTML = pane.outerHTML;
    document.body.append(template);
    // Keep each snapshot's CSS in its own directory; do not overwrite other versions.
    const resourceDir = snapshot + '_files';
    await mkdir(join(assets, resourceDir), { recursive: true });
    for (const entry of await readdir(join(root, resourceDir))) {
      if (entry.endsWith('.css')) await cp(join(root, resourceDir, entry), join(assets, resourceDir, entry));
    }
    for (const link of source.querySelectorAll('link[rel="stylesheet"]')) {
      const filename = basename(link.getAttribute('href') || '');
      // Scoped viewer CSS, not a second global ChatGPT theme.
      if (!/^(?:WidgetRenderer|writing-block|react-|conversation-small|user-markdown-formatted-text|code-block-editor)/.test(filename) || copied.has(filename)) continue;
      copied.add(filename);
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = `./previews/${resourceDir}/${filename}`;
      document.head.append(css);
    }
  }
  for (const citation of document.querySelectorAll('[data-file-citation-primary-file-id]')) {
    const key = byId.get(citation.getAttribute('data-file-citation-primary-file-id'));
    if (key) {
      citation.setAttribute('data-ceobe-open-preview', key);
      citation.querySelector('button')?.setAttribute('tabindex', '0');
    }
  }
  for (const button of document.querySelectorAll('button')) {
    const key = names.get(button.getAttribute('aria-label')) || names.get(button.textContent.trim());
    if (key) { button.setAttribute('data-ceobe-open-preview', key); button.setAttribute('tabindex', '0'); }
  }
  const script = document.createElement('script'); script.type = 'module'; script.src = './file-previews.js'; document.body.append(script);
  await cp(join(projectRoot, 'scripts/file-previews.js'), join(outputRoot, 'file-previews.js'));
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = './file-previews.css'; document.head.append(css);
  await cp(join(projectRoot, 'scripts/file-previews.css'), join(outputRoot, 'file-previews.css'));
}
