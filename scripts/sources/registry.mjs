// 多站点适配层：调用方（CLI、API、将来的 UI）只认这里的描述符，不去判断具体站点。
// 目前只有 ChatGPT 公开分享；加 Claude 或别的站点时，在这里登记一个 descriptor 即可，
// 不需要改 archive-share / local-import-api 的分支逻辑。

const chatgptShare = {
  id: 'chatgpt-share',
  label: 'ChatGPT 公开分享',
  // 分享页失败时的用户提示（API 与 CLI 共用同一句话）。
  message: '请输入公开的 ChatGPT 分享链接',
  // 归档根目录：采集写入 <repo>/<archiveRoot>/<shareId>/<timestamp>/
  archiveRoot: 'archive/chatgpt-share',
  // 规范化的 Python 导入器；null 表示该来源还没有实现导入。
  importer: 'scripts/import-chatgpt-share.py',
  match(url) {
    return url.protocol === 'https:'
      && url.hostname === 'chatgpt.com'
      && !url.port
      && !url.username
      && !url.password
      && /^\/share\/[\w-]+\/?$/.test(url.pathname);
  },
  shareId(url) {
    return url.pathname.split('/')[2];
  },
  // 严格校验：导入接口要求带连字符的 UUID 形状，避免把任意字符串写进导入任务文件名。
  isValidId(id) {
    return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(String(id || ''));
  },
};

export const SOURCES = Object.freeze([chatgptShare]);

export const sourceList = () => SOURCES.map(({ id, label, archiveRoot }) => ({ id, label, archiveRoot }));

export const findSource = url => SOURCES.find(source => source.match(url)) || null;

// 找不到来源时给一个带 400 的错误，调用方可以直接把 message 回给用户。
export const requireSource = url => {
  const source = findSource(url);
  if (source) return source;
  const error = new Error('暂不支持这个来源的分享链接；目前只支持 ChatGPT 公开分享');
  error.status = 400;
  throw error;
};

export const sourceById = id => SOURCES.find(source => source.id === id) || null;
