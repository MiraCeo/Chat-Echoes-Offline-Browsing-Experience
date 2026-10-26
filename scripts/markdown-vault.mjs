// Markdown 导出用的纯函数：Obsidian-ready 的 frontmatter、数学定界符、引用来源。
// 这里不碰文件系统、不依赖 DOM，方便单测；文件与附件的搬运留给 CLI / API。

const pad = value => String(value).padStart(2, '0');

// epoch 秒 → 本地时区的 ISO 8601（带偏移），例如 2026-09-03T00:08:23+08:00
export function isoLocal(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${hours}:${minutes}`;
}

// YAML 标量：能裸写就裸写，否则用双引号包起来（转义反斜杠与引号）。
// 裸写的安全条件：不以色标/注释符开头、不含“冒号+空格”或“空格+#”、不是 YAML 关键字或纯数字。
export function yamlScalar(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  if (!text) return "''";
  const plain = !/^[-?:,[\]{}#&*!|>'"%@`]/.test(text)
    && !/: /.test(text)
    && !/\s#/.test(text)
    && !/["\\]/.test(text)
    && !/^(true|false|null|yes|no|on|off|~|-?\d+(\.\d+)?)$/i.test(text);
  if (plain) return text;
  return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// frontmatter 只写真正知道的字段，避免写出空占位。
export function buildFrontmatter(meta = {}) {
  const lines = [];
  const push = (key, value) => { if (value !== undefined && value !== null && String(value).trim() !== '') lines.push(`${key}: ${yamlScalar(value)}`); };
  push('title', meta.title);
  push('chat_id', meta.chatId);
  push('url', meta.url);
  push('project', meta.project);
  push('created', meta.created);
  push('updated', meta.updated);
  push('model', meta.model);
  if (Array.isArray(meta.tags) && meta.tags.length) lines.push(`tags:\n${meta.tags.map(tag => `  - ${yamlScalar(tag)}`).join('\n')}`);
  if (!lines.length) return '';
  return ['---', ...lines, '---', ''].join('\n');
}

// 把代码块与行内代码替换成占位符，转换时不会误改里面的内容。
const protectCode = markdown => {
  const blocks = [];
  const stashed = markdown.replace(/(^```[\s\S]*?^```[ \t]*$)|(^~~~[\s\S]*?^~~~[ \t]*$)/gm, match => {
    blocks.push(match);
    return `\u0000CEOBECODE${blocks.length - 1}\u0000`;
  });
  const spans = [];
  const withSpans = stashed.replace(/`[^`\n]*`/g, match => {
    spans.push(match);
    return `\u0000CEOBESPAN${spans.length - 1}\u0000`;
  });
  return { text: withSpans, restore: value => value
    .replace(/\u0000CEOBESPAN(\d+)\u0000/g, (_, index) => spans[Number(index)])
    .replace(/\u0000CEOBECODE(\d+)\u0000/g, (_, index) => blocks[Number(index)]) };
};

// `\( … \)` → `$…$`，`\[ … \]` → `$$…$$`；代码内不动，货币 `$` 转义成 `\$`。
export function convertMath(markdown) {
  const { text, restore } = protectCode(markdown);
  let next = text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, body) => `\n$$\n${body.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, body) => `$${body.trim()}$`);
  // 剩下的 `$` 若后面紧跟数字，多半是货币；转义避免被当作公式起点。
  next = next.replace(/(^|[^\\$])\$(\d)/g, (_, before, digit) => `${before}\\$${digit}`);
  return restore(next);
}

// 去掉追踪参数再比对：同一篇文章经常同时出现带 utm_* 与不带的链接。
const normalizeUrl = url => {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) if (/^utm_/i.test(key)) parsed.searchParams.delete(key);
    parsed.hash = '';
    return parsed.toString();
  } catch { return url; }
};

// 从 content_references 里收集网页引用：grouped_webpages / url / sources_footnote。
export function collectSources(conversation) {
  const seen = new Set();
  const web = [];
  const add = (title, url, site) => {
    const clean = normalizeUrl(String(url || '').trim());
    if (!/^https?:\/\//i.test(clean) || seen.has(clean)) return;
    seen.add(clean);
    web.push({ title: String(title || '').trim() || clean, url: clean, site: String(site || '').trim() });
  };
  for (const message of Object.values(conversation?.messages || {})) {
    for (const reference of message.content_references || []) {
      if (reference.type === 'grouped_webpages') {
        for (const item of reference.items || []) add(item.title, item.url, item.attribution);
        for (const url of reference.safe_urls || []) add('', url, '');
      } else if (reference.type === 'url') {
        const parts = String(reference.matched_text || '').split('\uE202');
        const title = parts[1] || '';
        const url = parts[2] || (reference.safe_urls || [])[0] || '';
        add(title, url, '');
      } else if (reference.type === 'sources_footnote') {
        for (const source of reference.sources || []) add(source.title, source.url, source.attribution || source.site_name);
      }
    }
  }
  return web;
}

// 文末的来源小节；没有来源时返回空串。
export function buildSourcesSection(sources = []) {
  if (!sources.length) return '';
  const lines = sources.map((source, index) => {
    const label = source.title || source.url;
    const site = source.site && source.site !== label ? ` · ${source.site}` : '';
    return `${index + 1}. [${label.replace(/[[\]]/g, ' ').trim()}](${source.url})${site}`;
  });
  return ['', '## Sources', '', ...lines, ''].join('\n');
}
