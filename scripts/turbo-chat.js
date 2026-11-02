// Turbo keeps the sidebar across local page navigation, not only between
// conversations. Forms and non-page links keep the normal browser behavior.
(() => {
  if (!window.Turbo) return;
  Turbo.session.drive = false;

  const isConversationUrl = url => /\/conversations\/[^/]+\.html$/.test(url.pathname);
  const topPages = new Set(['/', '/index.html', '/import.html', '/assets.html', '/projects.html', '/project.html', '/timeline.html', '/memory.html']);
  const isPageUrl = url => isConversationUrl(url) || topPages.has(url.pathname);
  const topNav = '[data-ceobe-import-share], [data-ceobe-asset-library-link], [data-ceobe-projects-link], [data-ceobe-timeline-row], [data-ceobe-memory-row]';
  const isRelative = value => typeof value === 'string' && value && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(value);
  function absolute(value) {
    if (!isRelative(value)) return value;
    try { return new URL(value, location.href).href; } catch { return value; }
  }
  // The sidebar is Turbo-permanent, but top-level navigation changes the
  // document URL. Resolve every link/icon once so relative URLs from the first
  // page cannot be reinterpreted under /conversations/.
  function absolutizeSidebarUrls() {
    const sidebar = document.getElementById('stage-slideover-sidebar');
    if (!sidebar) return;
    for (const node of sidebar.querySelectorAll('a[href]')) {
      const href = node.getAttribute('href');
      if (isRelative(href)) node.setAttribute('href', absolute(href));
    }
    for (const node of sidebar.querySelectorAll('use[href]')) {
      const href = node.getAttribute('href');
      if (isRelative(href)) node.setAttribute('href', absolute(href));
    }
    for (const node of sidebar.querySelectorAll('img[src]')) {
      const src = node.getAttribute('src');
      if (isRelative(src)) node.setAttribute('src', absolute(src));
    }
  }
  const sidebar = document.getElementById('stage-slideover-sidebar');
  if (sidebar) new MutationObserver(absolutizeSidebarUrls).observe(sidebar, { childList: true, subtree: true });
  absolutizeSidebarUrls();
  function markTopNav() {
    let active = null;
    if (location.pathname.endsWith('/import.html')) active = '[data-ceobe-import-share]';
    else if (location.pathname.endsWith('/assets.html')) active = '[data-ceobe-asset-library-link]';
    else if (location.pathname.endsWith('/projects.html') || location.pathname.endsWith('/project.html')) active = '[data-ceobe-projects-link]';
    else if (location.pathname.endsWith('/timeline.html')) active = '[data-ceobe-timeline-row]';
    else if (location.pathname.endsWith('/memory.html')) active = '[data-ceobe-memory-row]';
    for (const link of document.querySelectorAll(topNav)) {
      link.removeAttribute('data-active');
      link.removeAttribute('aria-current');
      if (active && link.matches(active)) {
        link.dataset.active = '';
        link.setAttribute('aria-current', 'page');
      }
    }
  }
  let navigation = 0;
  let navigationUrl = location.href;
  document.addEventListener('turbo:before-visit', event => {
    if (event.detail?.url) navigationUrl = event.detail.url;
  });
  document.addEventListener('turbo:before-render', event => {
    navigation += 1;
    // Top-level page scripts register document/window listeners. Abort them so
    // a repeated visit cannot stack stale handlers from a previous document.
    window.__ceobeTopPageAbort?.abort();
    window.__ceobeTopPageAbort = null;
    const body = event.detail?.newBody;
    const pageUrl = navigationUrl || body?.baseURI || location.href;
    for (const script of body?.querySelectorAll?.('script[src]') || []) {
      // Resolve against the target page, not the current document: Turbo now
      // crosses /conversations/ and root-level pages.
      try {
        const url = new URL(script.getAttribute('src'), pageUrl);
        url.searchParams.set('turbo', String(navigation));
        script.setAttribute('src', url.href);
      } catch {}
    }
  });
  document.addEventListener('turbo:load', () => {
    absolutizeSidebarUrls();
    markTopNav();
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
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || link.target || link.hasAttribute('download') || link.dataset.turbo === 'false') return;
    // Sidebar chat rows wrap trailing controls (pin/options/delete) inside the
    // conversation anchor. Do not turn a click on one of those controls into a
    // Turbo visit; let the control's own handler open its menu.
    if (event.target instanceof Element && event.target.closest('button, [role="button"], input, select, textarea, label, [data-conversation-options-trigger]')) return;
    let url;
    try { url = new URL(link.href); } catch { return; }
    if (url.origin !== location.origin || !isPageUrl(url)) return;
    if (url.hash && url.pathname === location.pathname) return;
    event.preventDefault();
    Turbo.visit(url.href, { action: 'advance' });
  }, true);
})();
