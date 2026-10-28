// 分享页内入口：只在 chatgpt.com/share/* 注入一个浮动按钮，抓取与投递都交给 Service Worker。
// 样式放在 content.css（由 manifest 注入），避免受页面 CSP 对内联样式的影响。
(() => {
  if (!/^https:\/\/chatgpt\.com\/share\/[\w-]+\/?$/.test(location.href)) return;

  const BUTTON_ID = 'ceobe-send-button';
  const TOAST_ID = 'ceobe-send-toast';
  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.className = 'ceobe-send-button';
  button.textContent = '发送到 CEOBE';

  const toast = (text, kind = 'info') => {
    document.getElementById(TOAST_ID)?.remove();
    const node = document.createElement('div');
    node.id = TOAST_ID;
    node.className = 'ceobe-send-toast' + (kind === 'error' ? ' is-error' : '');
    node.textContent = text;
    node.setAttribute('role', 'status');
    document.body.append(node);
    if (kind !== 'error') setTimeout(() => node.remove(), 5200);
  };

  const reset = () => {
    button.disabled = false;
    button.textContent = '发送到 CEOBE';
  };

  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = '正在发送…';
    toast('正在匿名抓取分享页并发送到本地 CEOBE…');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'ceobe:capture', url: location.href, deliver: 'post' });
      if (!response?.ok) {
        const error = new Error(response?.error || '发送失败');
        if (response?.archived) error.archived = true;
        throw error;
      }
      const result = response.result || {};
      const page = result.page ? response.endpoint + result.page : '';
      toast(`已归档「${result.title || result.shareId || ''}」${page ? '\n' + page : ''}`);
      button.textContent = '已发送';
      setTimeout(reset, 4000);
    } catch (error) {
      toast('发送失败：' + (error?.message || error)
        + (error?.archived
          ? '\n采集包已经归档，只是页面没更新；运行 npm run library 或再次发送（不会重复导入）。'
          : '\n请确认本地 CEOBE 已启动（npm run dev），并在扩展里允许访问 127.0.0.1。'), 'error');
      reset();
    }
  });

  const mount = () => {
    if (document.getElementById(BUTTON_ID) || !document.body) return;
    document.body.append(button);
  };
  if (document.body) mount();
  else addEventListener('DOMContentLoaded', mount, { once: true });
})();
