const importHref = location.pathname.includes('/conversations/') ? '../import.html' : './import.html';
const triggers = [...new Set(document.querySelectorAll(
  '[data-testid="create-new-chat-button"], a[aria-label="新聊天"]',
))];

for (const trigger of triggers) {
  trigger.dataset.ceobeImportShare = '';
  trigger.setAttribute('aria-label', '导入会话');
  trigger.setAttribute('href', importHref);
  for (const node of [trigger, ...trigger.querySelectorAll('*')]) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent.includes('新聊天')) {
        child.textContent = child.textContent.replace('新聊天', '导入会话');
      }
    }
  }
  trigger.addEventListener('click', event => {
    event.preventDefault();
    location.assign(new URL(importHref, location.href).href);
  });
}

if (document.body.hasAttribute('data-ceobe-import-page')) {
  for (const item of document.querySelectorAll('[data-sidebar-item][data-active]')) {
    item.removeAttribute('data-active');
  }
  for (const trigger of triggers) trigger.dataset.active = '';

  const form = document.querySelector('[data-ceobe-import-form]');
  const input = document.querySelector('[data-ceobe-import-input]');
  const submit = document.querySelector('[data-ceobe-import-submit]');
  if (!form || !input || !submit) throw new Error('Official import composer is incomplete.');

  input.setAttribute('contenteditable', 'true');
  input.setAttribute('role', 'textbox');
  input.setAttribute('aria-multiline', 'false');
  submit.type = 'submit';

  const status = document.createElement('div');
  status.dataset.ceobeImportStatus = '';
  status.className = 'mt-4 text-center text-sm text-token-text-secondary';
  status.setAttribute('role', 'status');
  form.insertAdjacentElement('afterend', status);

  const value = () => input.textContent.trim();
  const setBusy = busy => {
    input.setAttribute('contenteditable', String(!busy));
    submit.disabled = busy;
    submit.setAttribute('aria-busy', String(busy));
  };

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const url = value();
    if (!url) {
      status.textContent = '请粘贴 ChatGPT 分享链接。';
      input.focus();
      return;
    }

    setBusy(true);
    status.textContent = '正在读取并归档会话…';
    try {
      const response = await fetch('/api/archive-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ url }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '导入失败');
      status.textContent = '导入完成，正在打开会话…';
      location.href = result.page;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      setBusy(false);
      input.focus();
    }
  });
}
