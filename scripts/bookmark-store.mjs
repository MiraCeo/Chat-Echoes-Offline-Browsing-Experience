import { readFile, writeFile, mkdir, rename, rm, lstat } from 'node:fs/promises';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireMutation } from './workspace-mutation.mjs';
import { bookmarkTargets } from './bookmark-targets.mjs';
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const idOK = (s) => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(s);
const controls = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
export async function readBookmarkDocument(root) {
  for (const part of ['data', 'data/private']) {
    try {
      if ((await lstat(join(root, part))).isSymbolicLink()) throw Error('拒绝书签目录符号链接');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  const file = join(root, 'data/private/bookmarks.ceobe.json');
  let raw;
  try {
    if ((await lstat(file)).isSymbolicLink()) throw Error('拒绝书签符号链接');
    raw = await readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { schema_version: '1.0.0', kind: 'ceobe.bookmarks', items: [] };
    throw e;
  }
  const d = JSON.parse(raw),
    seen = new Set(),
    ids = new Set();
  if (d.schema_version !== '1.0.0' || d.kind !== 'ceobe.bookmarks' || !Array.isArray(d.items))
    throw Error('书签数据格式异常');
  for (const b of d.items) {
    const key = JSON.stringify([b.chat_id, b.message_id]);
    if (
      !idOK(b.id) ||
      !idOK(b.chat_id) ||
      !idOK(b.message_id) ||
      typeof b.title !== 'string' ||
      typeof b.note !== 'string' ||
      typeof b.excerpt !== 'string' ||
      !['user', 'assistant'].includes(b.role) ||
      typeof b.created_at !== 'string' ||
      typeof b.updated_at !== 'string' ||
      !Number.isSafeInteger(b.version) ||
      b.version < 1 ||
      seen.has(key) ||
      ids.has(b.id)
    )
      throw Error('书签记录异常，未覆盖原文件');
    seen.add(key);
    ids.add(b.id);
  }
  return d;
}
async function writeDocument(root, d) {
  const file = join(root, 'data/private/bookmarks.ceobe.json');
  await mkdir(dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, JSON.stringify(d, null, 2));
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}
async function catalog(root) {
  const d = JSON.parse(await readFile(join(root, 'archive/library.ceobe.json'), 'utf8'));
  if (d.kind !== 'ceobe.library' || !Array.isArray(d.conversations)) throw Error('聊天索引异常');
  let meta = { items: {} };
  try {
    meta = JSON.parse(await readFile(join(root, 'data/private/chats.ceobe.json'), 'utf8'));
    if (meta.kind !== 'ceobe.chat-metadata' || !meta.items) throw Error('聊天元数据异常');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return d.conversations.map((c) => ({ ...c, ...meta.items[c.id] }));
}
async function targets(root, entry) {
  const base = resolve(root, 'archive'),
    path = resolve(root, entry.conversation_path || '');
  const rel = relative(base, path);
  if (rel.startsWith('..') || !rel || rel.split(sep).some((p) => !p)) throw Error('归档路径异常');
  let current = base;
  if ((await lstat(current)).isSymbolicLink()) throw Error('归档路径不可用');
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw Error('归档路径不可用');
  }
  return bookmarkTargets(JSON.parse(await readFile(path, 'utf8')));
}
export function createBookmarkStore(root) {
  root = resolve(root);
  return {
    async list() {
      const d = await readBookmarkDocument(root),
        chats = await catalog(root),
        cache = new Map();
      for (const id of new Set(d.items.map((b) => b.chat_id))) {
        const c = chats.find((c) => c.id === id);
        if (c)
          try {
            cache.set(id, await targets(root, c));
          } catch {
            cache.set(id, null);
          }
      }
      return d.items.map((b) => {
        const chat = chats.find((c) => c.id === b.chat_id),
          list = cache.get(b.chat_id),
          target = list?.find((t) => t.message_ids.includes(b.message_id));
        return {
          ...b,
          chat_title: chat?.title || '已不存在的聊天',
          target_state: !chat
            ? 'chat_missing'
            : list === null
              ? 'unavailable'
              : target
                ? 'available'
                : 'message_missing',
          order: target?.order ?? null,
          content_changed: !!target && target.excerpt !== b.excerpt,
        };
      });
    },
    async mutate(body) {
      const release = await acquireMutation(root);
      try {
        const d = await readBookmarkDocument(root);
        if (body?.action === 'delete') {
          if (!idOK(body.id) || !Number.isSafeInteger(body.expectedVersion))
            throw bad('缺少书签版本');
          const i = d.items.findIndex((b) => b.id === body.id);
          if (i < 0) throw bad('书签已不存在', 404);
          if (d.items[i].version !== body.expectedVersion)
            throw bad('书签已在其他窗口修改，请重新打开后再操作', 409);
          d.items.splice(i, 1);
          await writeDocument(root, d);
          return { deleted: body.id };
        }
        if (body?.action !== 'save' || !idOK(body.chatId) || !idOK(body.messageId))
          throw bad('无效书签目标');
        if (
          typeof body.title !== 'string' ||
          !body.title.trim() ||
          body.title.trim().length > 160 ||
          /[\x00-\x1f\x7f]/.test(body.title)
        )
          throw bad('书签标题须为 1–160 个字符');
        if (typeof body.note !== 'string' || body.note.length > 20000 || controls.test(body.note))
          throw bad('备注须为不超过 20000 个字符的纯文本');
        if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0)
          throw bad('缺少书签版本');
        const old = d.items.find(
          (b) => b.chat_id === body.chatId && b.message_id === body.messageId,
        );
        if (
          (old?.version || 0) !== body.expectedVersion ||
          (old?.id || null) !== (body.expectedId || null)
        )
          throw bad('书签已在其他窗口修改或删除，请保留草稿并重新打开', 409);
        let target;
        if (!old) {
          const entry = (await catalog(root)).find((c) => c.id === body.chatId);
          if (!entry) throw bad('聊天不存在', 404);
          target = (await targets(root, entry)).find((t) => t.message_id === body.messageId);
          if (!target) throw bad('目标消息不在当前可见归档中，请刷新后重试', 404);
          if (d.items.length >= 10000) throw bad('书签数量已达到 10000 个上限');
        }
        const now = new Date().toISOString(),
          b = {
            ...(old || {
              id: randomUUID(),
              chat_id: body.chatId,
              message_id: body.messageId,
              excerpt: target.excerpt,
              role: target.role,
              created_at: now,
            }),
            title: body.title.trim(),
            note: body.note.replace(/\r\n?/g, '\n'),
            version: (old?.version || 0) + 1,
            updated_at: now,
          };
        if (old) d.items[d.items.indexOf(old)] = b;
        else d.items.push(b);
        await writeDocument(root, d);
        return { bookmark: b };
      } finally {
        await release();
      }
    },
  };
}
export function bookmarksMiddleware(root) {
  const store = createBookmarkStore(root);
  return async (req, res, next) => {
    if (req.url.split('?')[0] !== '/api/bookmarks') return next();
    const send = (status, data) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(data));
    };
    try {
      if (req.method === 'GET') return send(200, { bookmarks: await store.list(), writable: true });
      if (req.method !== 'POST') throw bad('仅支持 GET/POST', 405);
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))
        throw bad('需要 JSON 请求', 415);
      if (
        req.headers['sec-fetch-site'] === 'cross-site' ||
        (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
      )
        throw bad('不允许跨站修改书签', 403);
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 131072) throw bad('请求过大', 413);
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw bad('无效 JSON');
      }
      send(200, await store.mutate(body));
    } catch (e) {
      send(e.status || 500, {
        error: e.status ? e.message : '无法确认书签读取或保存结果；请保留草稿并刷新检查，不要直接覆盖原数据',
      });
    }
  };
}
