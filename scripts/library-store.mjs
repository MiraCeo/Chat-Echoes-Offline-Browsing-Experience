import { acquireMutation } from './workspace-mutation.mjs';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

// 资料库的“个人组织”数据：文件夹（当标签用，一条资源可属于多个）、标签分配、上传记录。
// 上传的字节单独放在 data/private/library-files/，不进 archive/（archive 是只增不改的原始档案）；
// 删文件夹只删标签，删上传只删记录——**任何文件都不会被删除**，这是资源库的既定语义。

export const LIBRARY_KIND = 'ceobe.library';
export const FOLDER_LIMIT = 200;
export const NAME_LIMIT = 60;
export const UPLOAD_NAME_LIMIT = 200;
export const UPLOAD_BYTES_LIMIT = 128 * 1024 * 1024;

const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const blank = () => ({ schema_version: '1.0.0', kind: LIBRARY_KIND, folders: [], tags: {}, uploads: [] });

export const cleanName = (value, limit = NAME_LIMIT) => String(value ?? '')
  .replace(/[\x00-\x1f\x7f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .normalize('NFC')
  .slice(0, limit);

export const uploadId = sha256 => `up-${sha256.slice(0, 32)}`;

// 文件夹名不静默截断：超长直接拒绝，免得用户输入的名字被悄悄改掉。
const folderName = value => {
  const raw = String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) throw bad('请输入文件夹名称');
  if ([...raw].length > NAME_LIMIT) throw bad(`文件夹名称须为 1–${NAME_LIMIT} 个字符`);
  return raw.normalize('NFC');
};

// 图片直接内联预览；文本类在浏览器里现取现显示（preview.kind = 'text'），避免构建期生成一大堆片段。
export const uploadKind = (name, mime = '') => {
  const extension = extname(name || '').toLowerCase();
  if (/^image\//i.test(mime) || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp'].includes(extension)) return 'image';
  if (/^text\//i.test(mime) || ['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.log', '.yml', '.yaml', '.toml', '.ini', '.xml', '.html', '.css', '.js', '.mjs', '.ts', '.py', '.sh', '.ps1', '.sql'].includes(extension)) return 'text';
  return 'file';
};

export function createLibraryStore(file, { filesDir, maxBytes = UPLOAD_BYTES_LIMIT } = {}) {
  let queue = Promise.resolve();
  const run = work => { const next = queue.then(work); queue = next.catch(() => {}); return next; };

  async function read() {
    let text;
    try { text = await readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return blank(); throw error; }
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('资料库数据文件损坏，未覆盖原文件'); }
    if (data?.kind !== LIBRARY_KIND || !Array.isArray(data.folders) || typeof data.tags !== 'object' || data.tags === null || !Array.isArray(data.uploads))
      throw new Error('资料库数据文件格式异常，未覆盖原文件');
    return { ...blank(), ...data, folders: data.folders.filter(f => f && typeof f.id === 'string'), uploads: data.uploads.filter(u => u && typeof u.id === 'string') };
  }

  async function save(data) {
    await mkdir(dirname(file), { recursive: true });
    const tmp = file + '.' + randomUUID() + '.tmp';
    try { await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8'); await rename(tmp, file); }
    finally { await unlink(tmp).catch(() => {}); }
  }

  // 只保留仍然存在的文件夹 id，避免手改数据后残留脏值。
  const tidyTags = data => {
    const ids = new Set(data.folders.map(folder => folder.id));
    const tags = {};
    for (const [asset, list] of Object.entries(data.tags || {})) {
      const kept = [...new Set((Array.isArray(list) ? list : []).filter(id => ids.has(id)))];
      if (kept.length) tags[asset] = kept;
    }
    data.tags = tags;
    return data;
  };

  async function snapshot() {
    const data = tidyTags(await read());
    return {
      folders: [...data.folders].sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN') || String(a.created_at).localeCompare(String(b.created_at))),
      tags: data.tags,
      uploads: [...data.uploads].sort((a, b) => String(b.added_at).localeCompare(String(a.added_at))),
    };
  }

  const list = () => run(snapshot);

  function folders(body) {
    return run(async () => {
      const action = body?.action;
      const data = tidyTags(await read());
      if (action === 'create') {
        const name = folderName(body.name);
        if (data.folders.length >= FOLDER_LIMIT) throw bad(`文件夹最多 ${FOLDER_LIMIT} 个`);
        if (data.folders.some(folder => String(folder.name).toLocaleLowerCase() === name.toLocaleLowerCase())) throw bad('已存在同名文件夹', 409);
        data.folders.push({ id: randomUUID(), name, created_at: new Date().toISOString() });
        await save(data);
        return snapshot();
      }
      const id = body?.id;
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw bad('无效文件夹 ID');
      const folder = data.folders.find(item => item.id === id);
      if (!folder) throw bad('文件夹不存在', 404);
      if (action === 'rename') {
        const name = folderName(body.name);
        if (data.folders.some(item => item.id !== id && String(item.name).toLocaleLowerCase() === name.toLocaleLowerCase())) throw bad('已存在同名文件夹', 409);
        folder.name = name;
      } else if (action === 'delete') {
        data.folders = data.folders.filter(item => item.id !== id);
        for (const asset of Object.keys(data.tags)) if (data.tags[asset].includes(id)) {
          const kept = data.tags[asset].filter(value => value !== id);
          if (kept.length) data.tags[asset] = kept; else delete data.tags[asset];
        }
      } else throw bad('无效文件夹操作');
      await save(tidyTags(data));
      return snapshot();
    });
  }

  // 一次设置某条资源的全部标签（文件夹）。
  function tags(assetId, folderIds) {
    return run(async () => {
      if (typeof assetId !== 'string' || !/^[\w-]{1,80}$/.test(assetId)) throw bad('无效资源 ID');
      if (!Array.isArray(folderIds)) throw bad('标签格式不正确');
      const data = tidyTags(await read());
      const known = new Set(data.folders.map(folder => folder.id));
      for (const id of folderIds) if (!known.has(id)) throw bad('文件夹不存在', 404);
      const kept = [...new Set(folderIds)];
      if (kept.length) data.tags[assetId] = kept; else delete data.tags[assetId];
      await save(tidyTags(data));
      return snapshot();
    });
  }

  function addUpload({ name, mime, bytes }) {
    return run(async () => {
      const clean = cleanName(name, UPLOAD_NAME_LIMIT) || '未命名文件';
      if (!bytes?.length) throw bad('文件为空，未保存');
      if (bytes.length > maxBytes) throw bad(`单个文件不能超过 ${Math.round(maxBytes / 1024 / 1024)} MB`, 413);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const data = tidyTags(await read());
      const id = uploadId(sha256);
      const existing = data.uploads.find(item => item.id === id);
      if (existing) return { upload: existing, duplicate: true };
      await mkdir(filesDir, { recursive: true });
      const extension = (extname(clean).toLowerCase().match(/^\.[a-z0-9]{1,8}$/) || [''])[0];
      const stored = `${sha256}${extension}`;
      // 内容寻址：同名文件已存在就说明字节已经在盘上，不重写也不删除。
      try { await writeFile(join(filesDir, stored), bytes, { flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      const upload = { id, name: clean, sha256, stored, mime: String(mime || '').slice(0, 120), kind: uploadKind(clean, mime), size: bytes.length, added_at: new Date().toISOString() };
      data.uploads.push(upload);
      await save(data);
      return { upload, duplicate: false };
    });
  }

  // 移除的是“资料库里的这条记录”，磁盘上的文件保留（资源库不删原文件）。
  function removeUpload(id) {
    return run(async () => {
      if (typeof id !== 'string' || !/^up-[a-f0-9]{32}$/.test(id)) throw bad('无效上传记录');
      const data = tidyTags(await read());
      const index = data.uploads.findIndex(item => item.id === id);
      if (index < 0) throw bad('上传记录不存在', 404);
      const [removed] = data.uploads.splice(index, 1);
      delete data.tags[id];
      await save(data);
      return { removed: removed.id, fileKept: true, ...(await snapshot()) };
    });
  }

  return { list, folders, tags, addUpload, removeUpload, file };
}

export function libraryMiddleware(root) {
  const dataDir = join(root, 'data', 'private');
  const filesDir = join(dataDir, 'library-files');
  const publicDir = join(root, 'replay', 'public', 'library-files');
  const store = createLibraryStore(join(dataDir, 'library.ceobe.json'), { filesDir });
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const routes = ['/api/library', '/api/library/folders', '/api/library/tags', '/api/library/upload', '/api/library/uploads/remove'];
    if (!routes.includes(path)) return next();
    const send = (status, payload) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(payload));
    };
    let release;
    try {
      if (path === '/api/library') {
        if (req.method !== 'GET') return send(405, { error: '仅支持 GET' });
        return send(200, { ...(await store.list()), writable: true });
      }
      if (req.method !== 'POST') return send(405, { error: '仅支持 POST' });
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host))
        return send(403, { error: '不允许跨站修改资料库' });

      if (path === '/api/library/upload') {
        const type = String(req.headers['content-type'] || '');
        if (!/^application\/octet-stream/i.test(type)) return send(415, { error: '需要 application/octet-stream' });
        const name = url.searchParams.get('name') || '';
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > UPLOAD_BYTES_LIMIT) throw bad(`单个文件不能超过 ${Math.round(UPLOAD_BYTES_LIMIT / 1024 / 1024)} MB`, 413);
          chunks.push(chunk);
        }
        release = await acquireMutation(root);
        const result = await store.addUpload({ name, mime: String(url.searchParams.get('mime') || ''), bytes: Buffer.concat(chunks) });
        // 立刻给 dev/生产静态目录放一份副本，下载链接不必等下一次构建。
        await mkdir(publicDir, { recursive: true });
        const source = join(filesDir, result.upload.stored);
        try { await writeFile(join(publicDir, result.upload.stored), await readFile(source), { flag: 'wx' }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        await release(); release = null;
        return send(result.duplicate ? 200 : 201, { upload: result.upload, duplicate: result.duplicate });
      }

      if (!/^application\/json(?:;|$)/i.test(String(req.headers['content-type'] || ''))) return send(415, { error: '需要 JSON 请求' });
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 65536) throw bad('请求内容过大', 413);
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw bad('无效 JSON'); }
      release = await acquireMutation(root);
      if (path === '/api/library/folders') { const result = await store.folders(body); await release(); release = null; return send(200, result); }
      if (path === '/api/library/tags') { const result = await store.tags(body?.assetId, body?.folders); await release(); release = null; return send(200, result); }
      const result = await store.removeUpload(body?.id);
      await release(); release = null;
      return send(200, result);
    } catch (error) {
      send(error.status || 500, { error: error.status ? error.message : '资料库数据读取或保存失败，原数据未被覆盖，请检查本地服务' });
    } finally { if (release) await release(); }
  };
}
