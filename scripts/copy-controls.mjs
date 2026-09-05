import { marked, Renderer } from 'marked';

const safeUrl = value => {
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
};
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const cell = value => String(value ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');

export function messageCopyContent(parts, document, referencePrefix = '') {
  const definitions = new Map();
  const text = parts.filter(part => part.type === 'markdown').map(part => {
    const references = new Map((part.contentReferences || []).map(ref => [ref.matched_text, ref]));
    return part.markdown.replace(/\uE200([^\uE201\uE202]+)(?:\uE202(.*?))?\uE201/gs, (raw, kind, payload = '') => {
      const ref = references.get(raw) || {};
      if (kind === 'cite') {
        const items = ref.items || (ref.url ? [ref] : []);
        const links = items.flatMap(item => {
          const url = safeUrl(item.url);
          if (!url) return [];
          if (!definitions.has(url)) definitions.set(url, { id: `${referencePrefix}${definitions.size + 1}`, title: item.title || '' });
          const { id } = definitions.get(url);
          const label = item.attribution || new URL(url).hostname;
          return [`[${label.replace(/[\[\]]/g, '\\$&')}][${id}]`];
        });
        return links.length ? `(${links.join(', ')})` : ref.alt || '';
      }
      if (kind === 'filecite') return ref.alt || (ref.name ? `（${ref.name}）` : '');
      if (kind === 'url') {
        const [title, target] = payload.split('\uE202');
        const url = safeUrl(target);
        return url ? `[${title.replace(/[\[\]]/g, '\\$&')}](${url.replaceAll('(', '%28').replaceAll(')', '%29')})` : title;
      }
      if (kind === 'genui') {
        try {
          const content = JSON.parse(payload).chart?.content;
          if (!content) return ref.alt || '';
          const series = content.series || [];
          const rows = (content.data || []).map(row => [row[content.xKey], ...series.map(s => row[s.dataKey])]);
          const headings = [content.xAxisLabel || content.xKey, ...series.map(s => s.label || s.dataKey)];
          return [content.meta?.title, content.meta?.description, '',
            '| ' + headings.map(cell).join(' | ') + ' |',
            '| ' + headings.map(() => '---').join(' | ') + ' |',
            ...rows.map(row => '| ' + row.map(cell).join(' | ') + ' |')].filter(v => v != null).join('\n');
        } catch { return ref.alt || ''; }
      }
      return ref.alt || '';
    });
  }).join('\n\n').trim();
  const markdown = text + (definitions.size ? '\n\n' + [...definitions].map(([url, ref]) =>
    `[${ref.id}]: ${url} ${JSON.stringify(ref.title)}`).join('\n') : '');
  const renderer = new Renderer();
  renderer.html = token => escape(token.text);
  // Preserve TeX delimiters from Markdown escaping; don't copy rendered glyphs twice.
  const math = [];
  const source = markdown.replace(/\\\[[\s\S]*?\\\]|\\\([^\n]*?\\\)/g, value => {
    const token = `CEOBECOPYMATHTOKEN${math.length}END`;
    math.push({ token, value });
    return token;
  });
  let html = marked.parse(source, { renderer, gfm: true, breaks: true });
  for (const { token, value } of math) html = html.replaceAll(token, escape(value));
  const holder = document.createElement('div');
  holder.innerHTML = html;
  for (const node of holder.querySelectorAll('a[href],img[src]')) {
    const attr = node.localName === 'a' ? 'href' : 'src';
    if (!safeUrl(node.getAttribute(attr))) node.removeAttribute(attr);
  }
  return { text: markdown, html: holder.innerHTML };
}

export function attachCopyControls(section, parts) {
  for (const button of section.querySelectorAll('button')) {
    const label = button.getAttribute('aria-label');
    let text, html;
    if (button.getAttribute('data-testid') === 'copy-turn-action-button') ({ text, html } = messageCopyContent(parts, section.ownerDocument));
    else if (label === '复制表格') {
      const table = button.closest('.TyagGW_tableWrapper')?.querySelector('table');
      if (table) {
        const rows = [...table.querySelectorAll('tr')].map(row => [...row.querySelectorAll('th,td')]
          .map(cell => ({ tag: cell.localName, text: cell.textContent.trim() })));
        text = rows.map(row => row.map(cell => cell.text.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
        html = '<table>' + rows.map(row => '<tr>' + row.map(cell => `<${cell.tag}>${escape(cell.text)}</${cell.tag}>`).join('') + '</tr>').join('') + '</table>';
      }
    } else if (label === '复制') {
      const block = button.closest('.ceobe-code-block') || button.closest('pre');
      const code = block?.querySelector('code');
      if (code) text = code.textContent;
    }
    if (text === undefined) continue;
    button.setAttribute('data-ceobe-copy', text);
    if (html) button.setAttribute('data-ceobe-copy-html', html);
    button.setAttribute('tabindex', '0');
    button.setAttribute('title', label || '复制');
  }
}
