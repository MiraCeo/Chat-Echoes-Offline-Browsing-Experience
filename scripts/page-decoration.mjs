// 后处理步骤必须“可重复执行”：同一份数据重建时页面要逐字节一致。
// 否则删改一个会话就会改写全部页面（每页 3–4 MB），重复注入的节点还会一直累积。
// 每个步骤在注入之前，先用这里删掉自己上一次注入的节点；资源引用则原地更新，保持头部顺序稳定。

export function removeInjected(document, selectors) {
  for (const selector of selectors) for (const node of document.querySelectorAll(selector)) node.remove();
}

// 五个后处理步骤注入的全部节点。每趟构建先整份清掉，再按固定顺序重新注入，
// 这样“注入顺序”在第一次构建和之后每次重建里完全一致（否则节点会在 body 末尾互相错位）。
// 注意只清注入物：正文、消息、侧栏的行标记与官方样式表都不在此列。
export const DECORATION_SELECTORS = [
  // chat-menu
  '[data-ceobe-chat-wrapper]', '#ceobe-chat-project-row', '#ceobe-chat-icon-bank', '#ceobe-chat-status', '#ceobe-chat-layout',
  'script[src*="chat-menu.js"]', 'link[href*="chat-menu.css"]',
  // chat-actions
  '#ceobe-sidebar-project-label', '#ceobe-sidebar-chat-row', '[data-chat-delete]', '[data-chat-pinned-section]',
  '#ceobe-rename-row', '#ceobe-pinned-row', 'script[src*="chat-actions"]', 'link[href*="chat-actions"]',
  '[data-project-modal]', '[data-project-picker]', '#ceobe-project-icons', '#ceobe-projects-data', 'script[data-ceobe-project-script]', 'link[data-ceobe-project-style]',
  // chat-organizer
  '[data-organizer-projects]', '[data-organizer-template]', '#ceobe-organizer-bank', '[data-organizer-popup]',
  '[data-project-more-popup]', '[data-project-header-popup]', '[data-project-action-modal]',
  '#ceobe-project-inline-rename', 'link[href*="project-actions."]', 'link[href*="chat-organizer."]',
  // sidebar-controls
  '[data-ceobe-rail-recent]', '#ceobe-rail-recent-row', '[data-ceobe-search]', '#ceobe-search-row',
  '[data-ceobe-search-body-row]', '#ceobe-search-empty', 'script[src*="sidebar-controls."]', 'link[href*="sidebar-controls"]',
  // timeline nav
  '[data-ceobe-timeline-row]', '[data-ceobe-timeline-link]',
  // reader-ui
  '[data-reader-menu]', '[data-reader-move]', '#ceobe-reader-project-row', '[data-reader-image-viewer]',
  '[data-project-settings-preview]', '[data-preview-picker]', 'script[src*="reader-ui."]', 'link[href*="reader-ui."]',
  // bookmarks
  'template#ceobe-bookmark-icon-user', 'template#ceobe-bookmark-icon-gpt', 'template#ceobe-bookmark-icon-edit',
  '#ceobe-bookmark-data', '[data-bookmark-menu]', '[data-bookmark-dialog]', '[data-bookmark-status]',
  '[data-bookmark-open]', '[data-bookmark-mark]',
  'script[src*="bookmarks."]', 'script[src*="reading-position."]',
  'link[href*="bookmarks."]', 'link[href*="reading-position."]',
];

export function clearPageDecorations(document, { stylesheets = new Set() } = {}) {
  removeInjected(document, DECORATION_SELECTORS);
  // 各步骤补的官方样式表也要一起清掉，才能按固定顺序重新补回。
  const name = href => (href || '').split('/').pop().split('?')[0];
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    if (stylesheets.has(name(link.getAttribute('href')))) link.remove();
  }
  // 侧栏折叠态的开机脚本没有选择器可用，按内容识别。
  for (const script of document.querySelectorAll('script')) {
    if ((script.textContent || '').includes('ceobeSidebarCollapsed')) script.remove();
  }
}

const styles = (document, match) => [...document.querySelectorAll(`link[rel="stylesheet"][href*="${match}"]`)];
const scripts = (document, match) => [...document.querySelectorAll(`script[src*="${match}"]`)];

/**
 * 保证页面里只有一份该样式表，并且位置不随重建而移动：
 * 已有就把 href 改到新版本（就地更新），没有才追加。
 */
export function placeStylesheet(document, match, href) {
  if (!href) return null;
  const links = styles(document, match);
  for (const extra of links.slice(1)) extra.remove();
  if (links[0]) {
    if (links[0].getAttribute('href') !== href) links[0].setAttribute('href', href);
    return links[0];
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
  return link;
}

/** 同上，针对模块脚本。 */
export function placeScript(document, match, src) {
  if (!src) return null;
  const found = scripts(document, match);
  for (const extra of found.slice(1)) extra.remove();
  if (found[0]) {
    if (found[0].getAttribute('src') !== src) found[0].setAttribute('src', src);
    return found[0];
  }
  const script = document.createElement('script');
  script.type = 'module';
  script.src = src;
  document.body.append(script);
  return script;
}

/** 只补一份样式表；同 href 已存在时不动，保持首次构建的链接顺序稳定。 */
export function ensureStylesheet(document, href) {
  if (!href) return null;
  const existing = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some(link => link.getAttribute('href') === href);
  if (existing) return null;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
  return link;
}
