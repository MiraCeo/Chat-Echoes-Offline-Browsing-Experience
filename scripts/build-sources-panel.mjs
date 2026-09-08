import { cp } from 'node:fs/promises';
import { join } from 'node:path';

export async function buildSourcesPanel(document, root, output, conversation, templates) {
  const clone = name => templates.clone(name, document);
  const cloneNode = node => node.cloneNode(true);
  const messageText = message => (message?.content?.blocks || [])
    .filter(block => block.type === 'text' || block.type === 'markdown')
    .map(block => block.text || '')
    .join('\n')
    .trim();
  const previewText = value => value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  const toggle = clone('sources:toggle');
  toggle.setAttribute('data-ceobe-sources-toggle', '');
  toggle.setAttribute('aria-pressed', 'false');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'ceobe-sources-panel');
  toggle.setAttribute('tabindex', '0');
  for (const name of [...toggle.classList]) if (name.includes('bg-token-interactive-bg-secondary-selected')) toggle.classList.remove(name);
  const options = document.querySelector('[data-testid="conversation-options-button"]');
  options.parentElement.after(toggle);
  const panel = clone('sources:panel');
  panel.id = 'ceobe-sources-panel';
  panel.setAttribute('data-ceobe-sources-panel', '');
  panel.hidden = true;
  panel.querySelector('aside').setAttribute('aria-label', '文件和来源');
  for (const script of panel.querySelectorAll('script,iframe')) script.remove();
  for (const node of panel.querySelectorAll('*')) {
    for (const attr of node.getAttributeNames()) if (/^on/i.test(attr)) node.removeAttribute(attr);
  }
  const sections = [...panel.querySelectorAll('section')];
  const fileList = sections[0].querySelector('ul');
  const fileTemplates = [...fileList.children].map(cloneNode);
  const sourceList = sections[1].querySelector('ul');
  const sourceTemplate = cloneNode(sourceList.firstElementChild);
  fileList.replaceChildren(); sourceList.replaceChildren();
  for (const fade of panel.querySelectorAll('[data-testid^="sources-scroll-fade-"]')) fade.remove();
  const searchIcon = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '搜索聊天')?.querySelector('svg');
  const panelSearchIcon = panel.querySelector('[data-testid="library-search-container"] > svg');
  if (searchIcon && panelSearchIcon) panelSearchIcon.innerHTML = searchIcon.innerHTML;
  const files = new Map(), urls = new Map();
  for (const id of conversation.linear_message_ids) {
    const message = conversation.messages[id];
    for (const file of message.attachments || []) {
      if (!file.name) continue;
      let name = file.type === 'generated_file' ? file.pointer.split('/').at(-1) : file.name;
      try { name = decodeURIComponent(name); } catch {}
      files.set(file.id || file.pointer || name, { ...file, name });
    }
    for (const ref of message.content_references || []) {
      const items = ref.items || (ref.url ? [ref] : ref.item?.url ? [{ ...ref.item, title: ref.title }] : []);
      for (const item of items) {
        try {
          const url = new URL(item.url);
          if (!['http:', 'https:'].includes(url.protocol)) continue;
        if (!urls.has(url.href)) urls.set(url.href, item.title || item.attribution || url.hostname);
        } catch {}
      }
    }
  }
  const previewButtons = [...document.querySelectorAll('button[data-ceobe-open-preview]')];
  for (const resource of conversation.resources || []) {
    if (resource.message_ids.some(id => conversation.linear_message_ids.includes(id)) && !files.has(resource.key)) {
      files.set(resource.key, { id: resource.key, name: resource.name });
    }
  }
  for (const file of [...files.values()].sort((a,b) => Number(b.type === 'generated_file') - Number(a.type === 'generated_file'))) {
    const kind = /\.(xlsx?|ods)$/i.test(file.name) ? 'xls' : /\.(png|jpe?g|gif|webp)$/i.test(file.name) ? 'photo' : 'text';
    const row = cloneNode(fileTemplates.find(t => t.querySelector(`[data-library-file-icon-key="${kind}"]`)) || fileTemplates[0]);
    const button = row.querySelector('button');
    button.removeAttribute('data-ceobe-open-preview');
    button.setAttribute('aria-label', file.name);
    button.setAttribute('data-ceobe-source-file', '');
    button.setAttribute('tabindex', '0');
    const title = row.querySelector('[data-file-name-truncation-target]');
    title.textContent = file.name; title.setAttribute('aria-label', file.name);
    row.querySelector('[data-file-name-full-text]').setAttribute('data-file-name-full-text', file.name);
    const preview = previewButtons.find(b => b.getAttribute('aria-label') === file.name);
    const resource = (conversation.resources || []).find(r => r.status === 'downloaded' &&
      (r.key === file.id || r.pointers.includes(file.pointer)));
    if (preview) {
      button.setAttribute('data-ceobe-open-preview', preview.getAttribute('data-ceobe-open-preview'));
      button.setAttribute('data-ceobe-preview-file', preview.getAttribute('data-ceobe-preview-file'));
    }
    else if (resource) {
      const link = document.createElement('a');
      for (const attribute of button.attributes) link.setAttribute(attribute.name, attribute.value);
      link.removeAttribute('aria-disabled');
      link.href = './archive-resources/' + resource.local_path.split('/').at(-1);
      link.setAttribute('download', file.name);
      link.title = '下载已归档的文件';
      link.append(...button.childNodes);
      button.replaceWith(link);
    }
    else {
      button.setAttribute('aria-disabled', 'true');
      button.title = '此文件尚未接入本地预览';
    }
    fileList.append(row);
  }
  for (const [url, title] of urls) {
    const row = cloneNode(sourceTemplate), anchor = row.querySelector('a');
    anchor.href = url; anchor.title = title; anchor.rel = 'noopener noreferrer';
    anchor.querySelector('span.truncate').textContent = title;
    // A captured favicon must not be assigned to a different website.
    const favicon = anchor.querySelector('img');
    if (new URL(url).hostname === new URL(sourceTemplate.querySelector('a').href).hostname && favicon) {
      favicon.src = './assets/favicons.png';
    } else favicon?.parentElement.remove();
    sourceList.append(row);
  }
  for (const [index, section] of sections.entries()) {
    section.setAttribute('data-ceobe-source-section', '');
    const button = section.querySelector('h2 button');
    button.setAttribute('data-ceobe-source-collapse', ''); button.tabIndex = 0;
    const body = section.querySelector('h2').parentElement.nextElementSibling;
    body.setAttribute('data-ceobe-source-body', '');
    if (!index) {
      const more = [...body.querySelectorAll('button')].find(b => b.textContent.startsWith('再显示'));
      if (more) { more.setAttribute('data-ceobe-source-more', ''); more.tabIndex = 0; }
    }
  }
  panel.querySelector('input').setAttribute('data-ceobe-source-search', '');
  panel.querySelector('input').tabIndex = 0;
  for (const b of panel.querySelectorAll('button')) if (!b.hasAttribute('data-ceobe-source-collapse') && !b.hasAttribute('data-ceobe-source-more') && !b.hasAttribute('data-ceobe-source-file')) {
    b.tabIndex = -1; b.setAttribute('aria-disabled', 'true');
  }
  options.closest('header').append(panel);

  // Rebuild the official prompt rail against this input's actual user turns.
  {
    const rail = clone('navigation:prompt-rail');
    rail.setAttribute('data-ceobe-prompt-rail', '');
    const list = rail.querySelector('[data-toc-item-index]').parentElement;
    const template = cloneNode(list.firstElementChild); list.replaceChildren();
    const linearMessages = conversation.linear_message_ids.map(id => conversation.messages[id]).filter(Boolean);
    const userMessages = linearMessages
      .map((message, linearIndex) => ({ message, linearIndex }))
      .filter(entry => entry.message.role === 'user');
    const replyAfter = linearIndex => {
      const parts = [];
      for (let i = linearIndex + 1; i < linearMessages.length && linearMessages[i].role !== 'user'; i++) {
        if (linearMessages[i].role === 'assistant') {
          const text = messageText(linearMessages[i]);
          if (text) parts.push(text);
        }
      }
      return previewText(parts.join('\n')).slice(0, 180);
    };
    for (const [index, turn] of [...document.querySelectorAll('section[data-turn="user"]')].entries()) {
      const button = cloneNode(template);
      const record = userMessages[index];
      const message = record?.message;
      const text = messageText(message);
      const filenames = (message?.attachments || [])
        .filter(attachment => attachment.name && !attachment.mime_type?.startsWith('image/') && attachment.type !== 'image')
        .map(attachment => attachment.name);
      const fileUpload = filenames.length > 0 && !text;
      button.setAttribute('data-toc-item-index', index);
      button.setAttribute('data-ceobe-jump', turn.getAttribute('data-testid'));
      button.setAttribute('aria-label', fileUpload
        ? `跳转到第 ${index + 1} 条用户消息，File upload：${filenames.join('、')}`
        : `跳转到第 ${index + 1} 条用户消息`);
      button.title = turn.querySelector('.whitespace-pre-wrap')?.textContent.slice(0,100) || button.getAttribute('aria-label');
      const copy = turn.querySelector('[data-testid="copy-turn-action-button"]')?.getAttribute('data-ceobe-copy');
      button.setAttribute('data-ceobe-prompt-label', fileUpload ? 'File upload' : copy || text || button.title);
      if (fileUpload) {
        button.setAttribute('data-ceobe-prompt-kind', 'file-upload');
        button.setAttribute('data-ceobe-prompt-filename', filenames.join('、'));
      }
      const reply = record ? replyAfter(record.linearIndex) : '';
      if (reply) button.setAttribute('data-ceobe-prompt-reply', reply);
      button.removeAttribute('title');
      button.removeAttribute('data-toc-active');
      button.tabIndex = 0; list.append(button);
    }
    document.body.append(rail);
  }
  for (const name of ['sources-panel.js', 'sources-panel.css', 'prompt-rail.js']) await cp(join(root, 'scripts', name), join(output, name));
  const script = document.createElement('script'); script.type = 'module'; script.src = './sources-panel.js'; document.body.append(script);
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = './sources-panel.css'; document.head.append(css);
}
