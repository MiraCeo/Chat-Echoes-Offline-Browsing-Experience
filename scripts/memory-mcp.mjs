#!/usr/bin/env node
/**
 * Read-only MCP server over a memory bundle.
 *
 * Exposes four tools — search / get / list / dump — and never writes, never
 * touches the network. Speaks newline-delimited JSON-RPC on stdio.
 *
 *   npm run memory:mcp -- --bundle data/private/memory-kernel/bundle
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { search as searchIndex } from './memory-search-core.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const SERVER = { name: 'ceobe-memory', version: '1.0.0' };
const PROTOCOL = '2024-11-05';

const readJson = async (path, fallback = null) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
};

export const TOOLS = [
  {
    name: 'search',
    description: '在记忆、文件与图片里检索（BM25 + 实体 + 时间）。返回标题、摘要和出处。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词或短语' },
        limit: { type: 'number', description: '最多返回几条，默认 10' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get',
    description: '按 id 取一条记忆节点或一张图片描述。节点 id 形如 "l5:12"，图片 id 是 sha256。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'list',
    description: '列出主线、社区报告或实体。kind 取 mainlines / communities / entities。',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['mainlines', 'communities', 'entities'] } },
      required: ['kind'],
    },
  },
  {
    name: 'entity',
    description: '按实体查它关联的事件（「关于 TourGrid 我知道什么」）。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: '实体名或别名' } },
      required: ['name'],
    },
  },
  {
    name: 'dump',
    description: '取整层原始数据。layer 取 profile / l5 / communities / entities / search / images。',
    inputSchema: {
      type: 'object',
      properties: { layer: { type: 'string' } },
      required: ['layer'],
    },
  },
];

/** Lazy layer loader over the bundle directory. */
export function createBundleReader(bundleDir) {
  const cache = new Map();
  const load = async name => {
    if (cache.has(name)) return cache.get(name);
    const value = await readJson(join(bundleDir, name));
    cache.set(name, value);
    return value;
  };
  return {
    manifest: () => load('manifest.json'),
    profile: async () => {
      try { return await readFile(join(bundleDir, 'profile.md'), 'utf8'); }
      catch { return null; }
    },
    l5: () => load('l5.json'),
    communities: () => load('communities.json'),
    entities: () => load('entities.json'),
    entityIndex: () => load('entity-index.json'),
    search: () => load('search.json'),
    images: () => load('images.json'),
  };
}

const text = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

/** Dispatch one tools/call. */
export async function callTool(reader, name, args = {}) {
  if (name === 'search') {
    const index = await reader.search();
    if (!index) return { content: [{ type: 'text', text: '这个记忆包没有导出 search 层。' }], isError: true };
    const hits = searchIndex(index, String(args.query || ''), { limit: Math.min(Number(args.limit) || 10, 50) });
    return text(hits.map(hit => ({
      kind: hit.kind,
      title: hit.title,
      text: hit.text,
      source: hit.source,
      target: hit.target,
      score: hit.score,
    })));
  }
  if (name === 'get') {
    const id = String(args.id || '');
    if (id.startsWith('l5:')) {
      const tree = await reader.l5();
      const node = tree?.nodes?.find(item => item.n === Number(id.slice(3)));
      if (!node) return { content: [{ type: 'text', text: `找不到节点 ${id}` }], isError: true };
      const edges = (tree.edges || []).filter(([from, to]) => from === node.n || to === node.n);
      return text({ node, edges });
    }
    const images = await reader.images();
    const entry = images?.images?.[id];
    if (!entry) return { content: [{ type: 'text', text: `找不到 ${id}` }], isError: true };
    return text(entry);
  }
  if (name === 'list') {
    const kind = String(args.kind || '');
    if (kind === 'communities') {
      const reports = (await reader.communities())?.reports || [];
      return text(reports.map(report => ({ community: report.community, title: report.title, rank: report.rank })));
    }
    if (kind === 'entities') {
      const registry = await reader.entities();
      return text((registry?.entities || []).map(entity => ({ canonical: entity.canonical, kind: entity.kind, tier: entity.tier, thread: entity.thread })));
    }
    if (kind === 'mainlines') {
      const reports = (await reader.communities())?.reports || [];
      const threads = new Map();
      for (const report of reports) {
        const key = String(report.community || '').replace(/-\d+$/, '');
        threads.set(key, (threads.get(key) || 0) + 1);
      }
      return text([...threads.entries()].map(([thread, count]) => ({ thread, communities: count })));
    }
    return { content: [{ type: 'text', text: `未知 kind：${kind}` }], isError: true };
  }
  if (name === 'entity') {
    const index = await reader.entityIndex();
    if (!index) return { content: [{ type: 'text', text: '这个记忆包没有导出 entity-index 层。' }], isError: true };
    const wanted = String(args.name || '').trim();
    const entry = (index.entities || []).find(item => item.canonical === wanted)
      || (index.entities || []).find(item => item.canonical.includes(wanted) || wanted.includes(item.canonical));
    if (!entry) return { content: [{ type: 'text', text: `找不到实体：${wanted}` }], isError: true };
    return text(entry);
  }
  if (name === 'dump') {
    const layer = String(args.layer || '');
    if (layer === 'profile') {
      const profile = await reader.profile();
      return profile ? text(profile) : { content: [{ type: 'text', text: '这个记忆包没有 profile。' }], isError: true };
    }
    const loaders = { l5: reader.l5, communities: reader.communities, entities: reader.entities, search: reader.search, images: reader.images };
    const loader = loaders[layer];
    if (!loader) return { content: [{ type: 'text', text: `未知 layer：${layer}` }], isError: true };
    const value = await loader();
    return value ? text(value) : { content: [{ type: 'text', text: `这个记忆包没有 ${layer} 层。` }], isError: true };
  }
  return { content: [{ type: 'text', text: `未知工具：${name}` }], isError: true };
}

/** Handle one JSON-RPC message; returns the response object or null. */
export async function handleMessage(reader, message) {
  const { id, method, params } = message || {};
  if (method === 'initialize') {
    return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER } };
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  if (method === 'tools/call') {
    const result = await callTool(reader, params?.name, params?.arguments || {});
    return { jsonrpc: '2.0', id, result };
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const option = name => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const bundleDir = resolve(option('--bundle') || join(projectRoot, 'data/private/memory-kernel/bundle'));
  if (!existsSync(join(bundleDir, 'manifest.json'))) {
    console.error(`找不到记忆包：${bundleDir}（先跑 npm run memory:export）`);
    process.exit(1);
  }
  const reader = createBundleReader(bundleDir);
  let buffer = '';
  let pending = 0;
  let ended = false;
  const maybeExit = () => { if (ended && pending === 0) process.exit(0); };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      pending += 1;
      handleMessage(reader, message)
        .then(response => { if (response) process.stdout.write(JSON.stringify(response) + '\n'); })
        .catch(error => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } }) + '\n'))
        .finally(() => { pending -= 1; maybeExit(); });
    }
  });
  process.stdin.on('end', () => { ended = true; maybeExit(); });
}
