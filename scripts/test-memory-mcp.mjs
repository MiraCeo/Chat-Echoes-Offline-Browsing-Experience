import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBundleReader, handleMessage, TOOLS } from './memory-mcp.mjs';

const root = await mkdtemp(join(tmpdir(), 'ceobe-memory-mcp-'));
const write = async (path, value) => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
};

try {
  await write(join(root, 'manifest.json'), { schema: 'ceobe.memory-bundle/1', layers: [] });
  await write(join(root, 'profile.md'), '# 记忆档案\n\n## 我是谁\n- 甲\n');
  await write(join(root, 'l5.json'), {
    nodes: [{ n: 1, x: '甲', src: [{ s: 'aaaaaaaa', n: 1 }] }, { n: 2, x: '乙', src: [] }],
    edges: [[1, 2, 'precedes']],
  });
  await write(join(root, 'communities.json'), { reports: [{ community: 'tourgrid-01', title: '标题', rank: 0.9 }] });
  await write(join(root, 'entities.json'), { entities: [{ canonical: 'TourGrid', kind: 'project', tier: 1, thread: 'tourgrid' }] });
  await write(join(root, 'search.json'), {
    docs: [{ id: 0, kind: 'L5', title: 'L5 #1', text: '甲', source: 'memory', target: { type: 'global' }, length: 1 }],
    postings: { 甲: [[0, 1]] },
    df: { 甲: 1 },
    avgdl: 1,
    entities: {},
  });
  await write(join(root, 'images.json'), { images: { abc: { summary: '一张图' } } });

  const reader = createBundleReader(root);
  const init = await handleMessage(reader, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(init.result.serverInfo.name, 'ceobe-memory');
  assert.equal(init.result.protocolVersion, '2024-11-05');

  const list = await handleMessage(reader, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map(tool => tool.name), ['search', 'get', 'list', 'dump']);
  assert.equal(TOOLS.length, 4);

  const search = await handleMessage(reader, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search', arguments: { query: '甲' } } });
  const hits = JSON.parse(search.result.content[0].text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, 'L5 #1');

  const get = await handleMessage(reader, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get', arguments: { id: 'l5:1' } } });
  const node = JSON.parse(get.result.content[0].text);
  assert.equal(node.node.x, '甲');
  assert.deepEqual(node.edges, [[1, 2, 'precedes']]);

  const image = await handleMessage(reader, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get', arguments: { id: 'abc' } } });
  assert.equal(JSON.parse(image.result.content[0].text).summary, '一张图');

  const communities = await handleMessage(reader, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list', arguments: { kind: 'communities' } } });
  assert.equal(JSON.parse(communities.result.content[0].text)[0].community, 'tourgrid-01');

  const dump = await handleMessage(reader, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'dump', arguments: { layer: 'profile' } } });
  assert.match(dump.result.content[0].text, /记忆档案/);

  const missing = await handleMessage(reader, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get', arguments: { id: 'l5:99' } } });
  assert.equal(missing.result.isError, true);

  const unknown = await handleMessage(reader, { jsonrpc: '2.0', id: 9, method: 'nope' });
  assert.equal(unknown.error.code, -32601);

  const notification = await handleMessage(reader, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notification, null);

  console.log('PASS memory mcp: initialize, tools/list, search/get/list/dump, errors, notifications');
} finally {
  await rm(root, { recursive: true, force: true });
}
