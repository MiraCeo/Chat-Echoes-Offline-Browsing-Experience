import { htmlSafeSvg } from './serialize-html.mjs';

// Templates supply appearance only. Names and resource identity come from input.
export function createGeneratedFiles(snapshot) {
  const inlineTemplate = [...snapshot.querySelectorAll('button.behavior-btn')]
    .find(node => node.querySelector('[data-library-file-icon-key="xls"]'));
  const cardButton = [...snapshot.querySelectorAll('button')]
    .find(node => node.classList.contains('group/open-file'));
  let cardTemplate = cardButton;
  while (cardTemplate && !cardTemplate.classList.contains('border')) cardTemplate = cardTemplate.parentElement;
  if (!inlineTemplate || !cardTemplate) throw new Error('Official generated-file templates missing.');
  // Keep the official 480px maximum-width wrapper, not just the border.
  if (cardTemplate.parentElement.classList.contains('w-full')) cardTemplate = cardTemplate.parentElement;
  const clone = (document, node) => {
    const holder = document.createElement('div');
    holder.innerHTML = htmlSafeSvg(node.outerHTML)
      .replaceAll('sprites-core-ff27b486.svg', 'sprites-core-26c3f2d4.svg');
    return holder.firstElementChild;
  };
  return {
    enhance(container) {
      const document = container.ownerDocument;
      const seen = new Set();
      for (const link of [...container.querySelectorAll('a[href^="sandbox:/mnt/data/"]')]) {
        let pointer = link.getAttribute('href');
        try { pointer = decodeURI(pointer); } catch { /* preserve malformed source */ }
        let filename = pointer.split('/').at(-1);
        try { filename = decodeURIComponent(filename); } catch { /* preserve malformed source */ }
        const spreadsheet = /\.(xlsx?|ods)$/i.test(filename);
        const inline = clone(document, inlineTemplate);
        for (const node of [...inline.childNodes]) if (node.nodeType === 3) node.remove();
        inline.append(document.createTextNode(link.textContent));
        inline.setAttribute('aria-label', link.textContent);
        inline.setAttribute('aria-disabled', 'true');
        inline.setAttribute('title', '附件未保存，暂不可下载');
        inline.setAttribute('data-ceobe-generated-file', pointer);
        if (!spreadsheet) inline.querySelector('svg')?.remove();
        link.replaceWith(inline);
        // The captured code-source badge is evidence for this exact link only.
        if (inlineTemplate.getAttribute('aria-label') === inline.textContent) {
          const badge = inlineTemplate.nextElementSibling;
          if (badge) inline.after(document.createTextNode(' '), clone(document, badge));
        }
        if (seen.has(pointer)) continue;
        seen.add(pointer);
        const card = clone(document, cardTemplate);
        card.setAttribute('data-ceobe-generated-file', pointer);
        card.setAttribute('data-ceobe-file-state', 'missing');
        const button = [...card.querySelectorAll('button')].find(node => node.classList.contains('group/open-file'));
        button.setAttribute('aria-label', filename);
        const labels = button.querySelectorAll('span > span');
        labels[0].textContent = filename;
        labels[1].textContent = (spreadsheet ? '电子表格' : '文件') + ' · 附件未保存';
        labels[2].textContent = '附件未保存，暂不可打开';
        if (!spreadsheet) button.querySelector('svg')?.remove();
        for (const control of card.querySelectorAll('button')) {
          control.setAttribute('aria-disabled', 'true');
          control.setAttribute('title', '附件未保存，暂不可打开或下载');
        }
        container.append(card);
      }
    },
  };
}
