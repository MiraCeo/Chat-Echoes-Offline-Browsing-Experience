// Normalize the saved official shell before serialization, not after first paint.
export function prepareLocalSidebar(document, active = null) {
  for (const item of document.querySelectorAll('[data-testid="sidebar-item-tasks"], [data-testid="plugins-button"]')) item.remove();
  for (const item of document.querySelectorAll('[data-sidebar-item]')) {
    if (['已安排', '插件'].includes(item.textContent.trim()) || ['已安排', '插件'].includes(item.getAttribute('aria-label'))) item.remove();
  }
  const projects = [...document.querySelectorAll('[data-testid="sidebar-item-projects"], [data-ceobe-projects-link]')];
  const imports = [...document.querySelectorAll('[data-ceobe-import-share], [data-testid="create-new-chat-button"], a[aria-label="新聊天"], a[aria-label="新对话"]')];
  const assets = [...document.querySelectorAll('a')].filter(e => e.hasAttribute('data-ceobe-asset-library-link') || e.getAttribute('aria-label') === '资料库' || e.textContent.trim() === '资料库');
  if (active) {
    for (const e of document.querySelectorAll('[data-sidebar-item][data-active], [data-ceobe-import-share], [data-ceobe-asset-library-link], [data-ceobe-projects-link]')) {
      e.removeAttribute('data-active'); e.removeAttribute('aria-current');
    }
  }
  for (const link of imports) {
    link.dataset.ceobeImportShare = '';
    link.setAttribute('aria-label', '导入会话');
    link.setAttribute('href', './import.html');
    link.style.setProperty('pointer-events', 'auto', 'important');
    for (const node of [link, ...link.querySelectorAll('*')]) {
      for (const attribute of ['title', 'data-tooltip-content']) {
        if (node.hasAttribute(attribute)) node.setAttribute(attribute, node.getAttribute(attribute).replace(/新聊天|新对话|导入对话/g, '导入会话'));
      }
      for (const child of node.childNodes) if (child.nodeType === 3) child.textContent = child.textContent.replace(/新聊天|新对话|导入对话/g, '导入会话');
    }
    if (active === 'import') { link.dataset.active = ''; link.setAttribute('aria-current', 'page'); }
  }
  for (const link of assets) {
    link.dataset.ceobeAssetLibraryLink = '';
    link.setAttribute('href', './assets.html');
    link.style.setProperty('pointer-events', 'auto', 'important');
    if (active === 'assets') { link.dataset.active = ''; link.setAttribute('aria-current', 'page'); }
  }
  for (const link of projects) {
    link.dataset.ceobeProjectsLink = '';
    link.setAttribute('href', './projects.html');
    link.style.setProperty('pointer-events', 'auto', 'important');
    if (active === 'projects') { link.dataset.active = ''; link.setAttribute('aria-current', 'page'); }
  }
}
