// Turbo is used only for conversation-to-conversation navigation. Other links
// and all forms keep the normal full-page behavior.
(() => {
  if (!window.Turbo) return;
  Turbo.session.drive = false;

  const isConversationUrl = url => /\/conversations\/[^/]+\.html$/.test(url.pathname);
  let navigation = 0;
  document.addEventListener('turbo:before-render', event => {
    navigation += 1;
    const body = event.detail?.newBody;
    for (const script of body?.querySelectorAll?.('script[src]') || []) {
      const url = new URL(script.src);
      url.searchParams.set('turbo', String(navigation));
      script.src = url.href;
    }
  });
  document.addEventListener('turbo:load', () => {
    if (!location.hash.startsWith('#bookmark=')) return;
    let messageId;
    try { messageId = decodeURIComponent(location.hash.slice(10)); } catch { return; }
    const chatId = document.body.dataset.readerChatId;
    if (messageId && chatId) {
      document.dispatchEvent(new CustomEvent('ceobe:jump-message', { detail: { chatId, messageId } }));
    }
  });

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // Conversation pages all live at the same depth; keeping the sidebar across
    // that boundary avoids rebasing relative links when coming from the root.
    if (!location.pathname.startsWith('/conversations/')) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || link.target || link.hasAttribute('download') || link.dataset.turbo === 'false') return;
    let url;
    try { url = new URL(link.href); } catch { return; }
    if (url.origin !== location.origin || !isConversationUrl(url)) return;
    event.preventDefault();
    Turbo.visit(url.href, { action: 'advance' });
  }, true);
})();
