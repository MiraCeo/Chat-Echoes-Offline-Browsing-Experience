// Visual templates come only from saved official DOM, never hand-authored pills.
export function createOfficialCitations(documents) {
  const metadata = reference => JSON.stringify(reference).replace(/[\uE000-\uF8FF]/g, c => '\\u' + c.charCodeAt(0).toString(16));
  const fileTemplate = documents.flatMap(d => [...d.querySelectorAll('[data-file-citation-group-size="1"]')])[0];
  const webTemplates = documents.flatMap(d => [...d.querySelectorAll('[data-testid="webpage-citation-pill"]')]);
  const linkTemplate = documents.flatMap(d => [...d.querySelectorAll('a.decorated-link')])
    .find(link => link.querySelector('svg use'));
  const sourcesButtonTemplate = documents.flatMap(d => [...d.querySelectorAll('button')])
    .find(button => button.textContent.trim() === '来源' && button.classList.contains('not-prose'));
  if (!fileTemplate || !webTemplates.length) throw new Error('Official citation DOM templates are missing');
  const safeUrl = value => {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : '#'; }
    catch { return '#'; }
  };
  const normalizeAssets = node => {
    for (const image of node.querySelectorAll('img')) {
      const src = image.getAttribute('src');
      if (src?.startsWith('./') && src.includes('_files/')) {
        const name = src.split('_files/')[1];
        image.setAttribute('src', './assets/' + (name === 'favicons' ? 'favicons.png' : name));
      }
    }
    for (const use of node.querySelectorAll('use')) {
      use.setAttribute('href', use.getAttribute('href')
        .replace('sprites-core-ff27b486', 'sprites-core-26c3f2d4')
        .replace('sprites-shell-45f921f2', 'sprites-shell-097001e7'));
    }
    return node.outerHTML;
  };
  return {
    url(title, url) {
      if (!linkTemplate) throw new Error('Official decorated URL template is missing');
      const node = linkTemplate.cloneNode(true);
      const icon = node.querySelector('span[aria-hidden="true"]')?.cloneNode(true);
      node.textContent = title;
      if (icon) node.append(icon);
      node.setAttribute('href', safeUrl(url));
      node.setAttribute('rel', 'noopener noreferrer');
      return normalizeAssets(node);
    },
    file(reference = {}, groupedReferences = [reference]) {
      const node = fileTemplate.cloneNode(true);
      // Replace captured identity, never associate new text with the template's file.
      for (const name of node.getAttributeNames()) if (name.startsWith('data-file-citation-')) node.removeAttribute(name);
      node.removeAttribute('data-ceobe-open-preview');
      const groupSize = Math.max(groupedReferences.length, 1);
      node.setAttribute('data-file-citation-group-size', String(groupSize));
      node.setAttribute('data-file-citation-primary-file-id', reference.id || '');
      node.setAttribute('data-file-citation-primary-library-provider', '');
      node.setAttribute('data-file-citation-primary-source', reference.source || '');
      node.setAttribute('data-ceobe-reference', metadata(reference));
      node.querySelector('p').textContent = (reference.name || '附件').replace(/\.[^.]+$/, '')
        + (groupSize > 1 ? ` +${groupSize - 1}` : '');
      return normalizeAssets(node);
    },
    sourcesButton() {
      if (!sourcesButtonTemplate) return '';
      const node = sourcesButtonTemplate.cloneNode(true);
      node.setAttribute('data-ceobe-sources-toggle', '');
      node.setAttribute('aria-pressed', 'false');
      node.setAttribute('aria-expanded', 'false');
      node.setAttribute('aria-controls', 'ceobe-sources-panel');
      node.setAttribute('tabindex', '0');
      return normalizeAssets(node);
    },
    web(reference = {}) {
      const item = reference.items?.[0] || {};
      const url = safeUrl(item.url || reference.safe_urls?.[0]);
      const label = item.attribution || item.title || '网页来源';
      const count = item.supporting_websites?.length || Math.max((reference.items?.length || 1) - 1, 0);
      const hasCount = node => [...node.querySelectorAll('span')].some(s => /^\+\d+$/.test(s.textContent));
      const candidates = webTemplates.filter(node => hasCount(node) === (count > 0));
      const template = candidates.find(node => node.textContent.startsWith(label)) || candidates[0];
      if (!template) throw new Error('Official grouped web citation template is missing');
      const node = template.cloneNode(true);
      const anchor = node.querySelector('a');
      const originalLabel = node.querySelector('.truncate').textContent;
      node.querySelector('.truncate').textContent = label;
      anchor.setAttribute('href', url);
      anchor.setAttribute('alt', url);
      anchor.setAttribute('rel', 'noopener noreferrer');
      // Do not misattribute an unrelated website with the captured OpenAI favicon.
      if (originalLabel !== label) {
        node.querySelector('img')?.remove();
        node.removeAttribute('style');
        anchor.removeAttribute('style');
      }
      if (count) [...node.querySelectorAll('span')].find(s => /^\+\d+$/.test(s.textContent)).textContent = '+' + count;
      node.setAttribute('data-ceobe-reference', metadata(reference));
      return normalizeAssets(node);
    },
  };
}
