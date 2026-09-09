// Normalize the saved official shell before serialization, not after first paint.
export function prepareLocalSidebar(document, active = null) {
  for (const item of document.querySelectorAll('[aria-label="下载应用"]')) item.remove();
  for (const profile of document.querySelectorAll('[data-testid="accounts-profile-button"]')) {
    profile.querySelector('.trailing')?.remove();
    for (const attr of ['tabindex','role','type','id','aria-haspopup','aria-expanded','aria-describedby','data-state','data-testid','data-sidebar-item','data-fill']) profile.removeAttribute(attr);
    profile.dataset.ceobeLocalProfile = '';
    profile.setAttribute('aria-label', 'CEOBE 本地归档');
    for (const cls of ['hoverable','keyboard-focused:focus-ring','keyboard-focused:-outline-offset-2']) profile.classList.remove(cls);
    const avatar = profile.querySelector('.ceobe-local-avatar');
    if (avatar) { avatar.textContent = 'CE'; avatar.setAttribute('aria-label', '本地头像 CE'); }
    const name = profile.querySelector('.truncate');
    if (name) name.textContent = 'CEOBE';
    const subscription = profile.querySelector('.text-caption-regular');
    if (subscription) subscription.textContent = '本地归档';
  }
  const wordmark = document.querySelector('#sidebar-header .header-wordmark');
  if (wordmark) {
    (wordmark.querySelector('span') || wordmark).textContent = 'CEOBE';
    const home = wordmark.closest('a');
    home.setAttribute('href', 'https://github.com/MiraCeo/Chat-Echoes-Offline-Browsing-Experience');
    home.setAttribute('aria-label', 'CEOBE 项目主页');
    home.style.setProperty('pointer-events', 'auto', 'important');
  }
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
