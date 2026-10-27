import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { exportJson, attachmentName } from './export-json-cli.mjs';
import { conversationToOfficial, OFFICIAL_EXPORT_FORMAT, OFFICIAL_EXPORT_VERSION } from './export-conversation-json.mjs';

// 官方格式 JSON 导出：隔离工作区里构造两份快照（正常带分支 / 缺 nodes 的降级样本），
// 验证 mapping 与 linear 的顺序、content.raw 原样透传、current_node 可达、附件内容寻址、
// manifest 计数，以及同一输入两次导出逐字节一致。全程不碰真实档案。

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const root = await mkdtemp(join('data/private', 'json-export-'));
const bytesOf = value => Buffer.from(value);

const message = (id, role, content, { visible = true, metadata = {}, attachments = [] } = {}) => ({
  id, role, author: { role, metadata: {} },
  created_at: 1767225600.25, updated_at: null,
  status: 'finished_successfully', end_turn: role === 'assistant' ? true : null,
  recipient: 'all', channel: null,
  content: { type: content.content_type, blocks: [], raw: content },
  attachments, citations: [], content_references: [],
  metadata: { ...metadata }, visible,
  raw: { id, author: { role }, create_time: 1767225600.25, content, status: 'finished_successfully', weight: 1, metadata: { ...metadata } },
});
const node = (id, parent, children, messageId = null) => ({
  id, parent_id: parent, children, message_id: messageId,
  raw: { id, parent, children, ...(messageId ? { message: { id: messageId } } : {}) },
});

const conversationA = {
  schema_version: '1.0.0', kind: 'ceobe.conversation', id: 'conv-a', title: '原始标题 A',
  created_at: 1767225600.5, updated_at: 1767225700.5, current_node_id: 'n-hid',
  source: { type: 'chatgpt_share', share_id: 'conv-a', url: 'https://chatgpt.com/share/conv-a', captured_at: '2026-01-01T00:00:00Z', sha256: 'a'.repeat(64), format: 'chatgpt_react_flight_html' },
  linear_node_ids: ['n-root', 'n-u1', 'n-a2', 'n-u2', 'n-hid'],
  linear_message_ids: ['u1', 'a2', 'u2', 'hid'],
  nodes: {
    'n-root': node('n-root', null, ['n-u1']),
    'n-u1': node('n-u1', 'n-root', ['n-a1', 'n-a2'], 'u1'),
    'n-a1': node('n-a1', 'n-u1', [], 'a1'),
    'n-a2': node('n-a2', 'n-u1', ['n-u2'], 'a2'),
    'n-u2': node('n-u2', 'n-a2', ['n-hid'], 'u2'),
    'n-hid': node('n-hid', 'n-u2', [], 'hid'),
  },
  messages: {
    u1: message('u1', 'user', { content_type: 'text', parts: ['第一段 ✓  带两个空格'], metadata: { citations: [] } }, { metadata: { turn_exchange_id: 't1' } }),
    a1: message('a1', 'assistant', { content_type: 'text', parts: ['分支上的旧回答'] }),
    a2: message('a2', 'assistant', { content_type: 'text', parts: ['当前回答 \\(x^2\\)'], name: null }),
    u2: message('u2', 'user', { content_type: 'multimodal_text', parts: ['看图', { content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-1' }] }),
    hid: message('hid', 'assistant', { content_type: 'text', parts: ['隐藏的收尾'] }, { visible: false, metadata: { is_visually_hidden_from_conversation: true } }),
  },
  resources: [
    { key: 'pic-1', name: '图片.PNG', mime_type: 'image/png', size_bytes: 11, status: 'downloaded', local_path: 'assets/pic.png', message_ids: ['u1'], pointers: ['sediment://file-1'] },
    { key: 'missing', name: '缺失.pdf', mime_type: 'application/pdf', status: 'unresolved', local_path: null, message_ids: ['u2'], pointers: [] },
    { key: 'gone', name: 'gone.bin', mime_type: 'application/octet-stream', status: 'downloaded', local_path: 'assets/gone.bin', message_ids: ['u2'], pointers: [] },
    { key: 'pic-2', name: '图片.PNG', mime_type: 'image/png', size_bytes: 11, status: 'downloaded', local_path: 'assets/pic.png', message_ids: ['u2'], pointers: [] },
  ],
  import_report: { scope: 'captured_public_share', status: 'structure_checked', resource_counts: { downloaded: 3, unresolved: 1, failed: 0 } },
  raw_payload: { loader_chunks: ['SECRET_RAW_PAYLOAD'], decoded_root: {} },
};

const conversationDegraded = {
  schema_version: '1.0.0', kind: 'ceobe.conversation', id: 'conv-degraded', title: '降级标题',
  created_at: 1767225600, updated_at: null, current_node_id: null,
  source: { type: 'chatgpt_share', share_id: 'conv-degraded', url: 'https://chatgpt.com/share/conv-degraded', captured_at: '2026-01-02T00:00:00Z', sha256: 'b'.repeat(64) },
  linear_message_ids: ['m1', 'm2'],
  messages: {
    m1: message('m1', 'user', { content_type: 'text', parts: ['降级的第一条'] }),
    m2: message('m2', 'assistant', { content_type: 'code', language: 'js', text: 'const x = 1;' }, { metadata: { is_visually_hidden_from_conversation: false } }),
  },
  resources: [],
  import_report: { status: 'structure_checked', resource_counts: {} },
};

const snapshot = entry => join(root, 'archive/chatgpt-share', entry, '2026-01-01T00-00-00.000Z');
try {
  for (const [id, conversation] of [['conv-a', conversationA], ['conv-degraded', conversationDegraded]]) {
    const folder = snapshot(id);
    await mkdir(join(folder, 'assets'), { recursive: true });
    await writeFile(join(folder, 'conversation.ceobe.json'), JSON.stringify(conversation, null, 2));
  }
  await writeFile(join(snapshot('conv-a'), 'assets/pic.png'), bytesOf('PNG-BYTES-1'));
  await writeFile(join(root, 'archive/library.ceobe.json'), JSON.stringify({
    schema_version: '1.0.0', kind: 'ceobe.library',
    conversations: [
      { id: 'conv-a', title: '显示标题 A', conversation_path: 'archive/chatgpt-share/conv-a/2026-01-01T00-00-00.000Z/conversation.ceobe.json' },
      { id: 'conv-degraded', title: '降级标题', conversation_path: 'archive/chatgpt-share/conv-degraded/2026-01-01T00-00-00.000Z/conversation.ceobe.json' },
    ],
  }, null, 2));

  const out = join(root, 'out');
  const result = await exportJson({ root, outDir: out, all: true });
  assert.equal(result.manifest.format, OFFICIAL_EXPORT_FORMAT);
  assert.equal(result.manifest.version, OFFICIAL_EXPORT_VERSION);
  assert.equal(result.manifest.conversation_ids.length, 2);
  assert.ok(Array.isArray(result.payload), '--all exports an array');

  const text = await readFile(join(out, 'conversations.json'), 'utf8');
  assert.equal(text.includes('"raw_payload"'), false, 'raw_payload is never exported');
  assert.equal(text.includes('SECRET_RAW_PAYLOAD'), false);
  const exported = JSON.parse(text);
  assert.equal(exported.length, 2);

  const a = exported.find(item => item.conversation_id === 'conv-a');
  assert.ok(a, 'conv-a is exported');
  assert.equal(a.title, '显示标题 A', 'the current display title wins');
  assert.equal(a.ceobe.original_title, '原始标题 A', 'the archived title is kept for traceability');
  assert.equal(a.create_time, 1767225600.5);
  assert.equal(a.update_time, 1767225700.5);
  assert.equal(a.current_node, 'n-hid');
  assert.deepEqual(a.moderation_results, []);
  assert.equal(a.plugin_ids, null);
  assert.deepEqual(Object.keys(a.mapping), ['n-root', 'n-u1', 'n-a1', 'n-a2', 'n-u2', 'n-hid'], 'mapping keeps the archived node order');
  assert.equal(a.mapping['n-root'].message, null);
  assert.deepEqual([a.mapping['n-u1'].parent, a.mapping['n-u1'].children], ['n-root', ['n-a1', 'n-a2']], 'branches survive');
  assert.equal(a.mapping['n-a1'].message.id, 'a1', 'the off-path branch keeps its message');
  assert.deepEqual(a.ceobe.linear_message_ids, ['u1', 'a2', 'u2', 'hid']);
  assert.deepEqual(a.ceobe.hidden_message_ids, ['hid']);
  assert.equal(a.ceobe.degraded, false);

  // content.raw 原样透传：逐字段深比较，再按 JSON 字节确认没有改名/改写。
  for (const [nodeId, sourceNode] of Object.entries(conversationA.nodes)) {
    if (!sourceNode.message_id) continue;
    const source = conversationA.messages[sourceNode.message_id];
    const target = a.mapping[nodeId].message;
    assert.deepEqual(target.content, source.content.raw, nodeId + ' keeps content.raw untouched');
    assert.equal(JSON.stringify(target.content), JSON.stringify(source.content.raw));
    assert.deepEqual(target.author, source.author);
    assert.deepEqual(target.metadata, source.metadata);
    assert.equal(target.create_time, source.created_at);
    assert.equal(target.status, source.status);
    assert.equal(target.end_turn, source.end_turn);
    assert.equal(target.recipient, source.recipient);
    assert.equal(target.weight, 1, 'weight is carried when the archive has it');
  }

  // current_node 可达，且回溯顺序 == linear_message_ids（分支不影响当前路径）。
  const walk = () => {
    const ids = [];
    let cursor = a.current_node;
    const seen = new Set();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const item = a.mapping[cursor];
      assert.ok(item, 'current_node chain stays inside mapping: ' + cursor);
      if (item.message) ids.push(item.message.id);
      cursor = item.parent;
    }
    return ids.reverse();
  };
  assert.deepEqual(walk(), ['u1', 'a2', 'u2', 'hid'], 'the current path equals linear_message_ids');

  const resources = Object.fromEntries(a.ceobe.resources.map(resource => [resource.key, resource]));
  assert.match(resources['pic-1'].local_path, /^attachments\/[0-9a-f]{64}\.png$/, 'attachments are content addressed');
  assert.equal(resources['pic-1'].local_path, resources['pic-2'].local_path, 'identical bytes share one file');
  assert.equal(resources.missing.local_path, null, 'unresolved resources have no local path');
  assert.equal(resources.gone.local_path, null, 'a downloaded record with missing bytes becomes null');
  const attachmentFile = resolve(out, resources['pic-1'].local_path);
  assert.equal(sha256(await readFile(attachmentFile)), resources['pic-1'].local_path.split('/')[1].split('.')[0], 'the file name is the content sha256');
  assert.equal((await stat(attachmentFile)).size, 11);

  assert.equal(result.manifest.counts.conversations, 2);
  assert.equal(result.manifest.counts.nodes, 9);
  assert.equal(result.manifest.counts.messages, 7);
  assert.equal(result.manifest.counts.hidden_messages, 1);
  assert.deepEqual(result.manifest.attachments, { copied: 2, missing: 2, skipped: 0, files: 1, bytes: 11 });
  const conversationBytes = await readFile(join(out, 'conversations.json'));
  assert.equal(result.manifest.files[0].sha256, sha256(conversationBytes), 'manifest hashes the payload');
  assert.equal(result.manifest.files[0].bytes, conversationBytes.length);
  assert.deepEqual((await readdir(out)).sort(), ['attachments', 'conversations.json', 'manifest.json']);

  // 缺 nodes：线性 mapping + degraded，current_node 是最后的消息节点。
  const degraded = exported.find(item => item.conversation_id === 'conv-degraded');
  assert.equal(degraded.title, '降级标题');
  assert.equal(degraded.ceobe.degraded, true);
  assert.deepEqual(Object.keys(degraded.mapping), ['client-created-root', 'm1', 'm2']);
  assert.deepEqual(degraded.mapping['client-created-root'].children, ['m1']);
  assert.deepEqual([degraded.mapping.m1.parent, degraded.mapping.m1.children], ['client-created-root', ['m2']]);
  assert.equal(degraded.mapping.m2.parent, 'm1');
  assert.equal(degraded.current_node, 'm2');
  assert.deepEqual(degraded.mapping.m2.message.content, conversationDegraded.messages.m2.content.raw);
  const degradedWalk = [];
  for (let cursor = degraded.current_node; cursor;) {
    const item = degraded.mapping[cursor];
    if (item.message) degradedWalk.push(item.message.id);
    cursor = item.parent;
  }
  assert.deepEqual(degradedWalk.reverse(), ['m1', 'm2']);

  // 同一输入导出两次逐字节一致（含清单与附件）。
  const out2 = join(root, 'out-again');
  await exportJson({ root, outDir: out2, all: true });
  for (const name of ['conversations.json', 'manifest.json']) {
    assert.equal(await readFile(join(out, name), 'utf8'), await readFile(join(out2, name), 'utf8'), name + ' is deterministic');
  }
  assert.deepEqual(await readdir(join(out2, 'attachments')), await readdir(join(out, 'attachments')));

  // --no-assets：不建目录、不写字节，资源 local_path 全为 null。
  const out3 = join(root, 'out-no-assets');
  const noAssets = await exportJson({ root, outDir: out3, all: true, copyAssets: false });
  assert.deepEqual((await readdir(out3)).sort(), ['conversations.json', 'manifest.json']);
  assert.equal(noAssets.manifest.attachments.files, 0);
  assert.deepEqual({ copied: noAssets.manifest.attachments.copied, missing: noAssets.manifest.attachments.missing, skipped: noAssets.manifest.attachments.skipped },
    { copied: 0, missing: 1, skipped: 3 });
  const noAssetsText = JSON.parse(await readFile(join(out3, 'conversations.json'), 'utf8'));
  assert.equal(noAssetsText[0].ceobe.resources.every(resource => resource.local_path === null), true);

  // 单条 --id 输出对象；多条保持数组；--compact 单行。
  const single = await exportJson({ root, outDir: join(root, 'out-single'), ids: ['conv-a'] });
  assert.equal(Array.isArray(single.payload), false, 'a single --id exports an object');
  assert.equal(single.payload.conversation_id, 'conv-a');
  assert.deepEqual(single.manifest.conversation_ids, ['conv-a']);
  const compact = await exportJson({ root, outDir: join(root, 'out-compact'), ids: ['conv-a', 'conv-degraded'], compact: true });
  assert.equal(Array.isArray(compact.payload), true);
  const compactText = await readFile(join(root, 'out-compact/conversations.json'), 'utf8');
  assert.equal(compactText.includes('\n  "'), false, '--compact writes single-line JSON');

  // 参数校验与错误信息。
  await assert.rejects(() => exportJson({ root, outDir: join(root, 'x') }), /需要 --all 或 --id/);
  await assert.rejects(() => exportJson({ root, outDir: join(root, 'x'), all: true, ids: ['conv-a'] }), /不能同时使用/);
  await assert.rejects(() => exportJson({ root, outDir: join(root, 'x'), ids: ['nope'] }), /聊天不存在：nope/);
  assert.equal(attachmentName({ name: 'photo.PNG' }, 'abc'), 'abc.png');
  assert.equal(attachmentName({ name: 'no-extension' }, 'abc'), 'abc');
  assert.equal(attachmentName({ name: 'x.verylongextensionname' }, 'abc'), 'abc', 'odd extensions are dropped rather than trusted');

  // CLI 全流程（真实进程、CEOBE_ROOT 隔离）。
  const cliOut = join(root, 'out-cli');
  const run = spawnSync(process.execPath, ['scripts/export-json-cli.mjs', '--all', '--out', cliOut], {
    encoding: 'utf8', env: { ...process.env, CEOBE_ROOT: root }, cwd: process.cwd(),
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /已导出 2 个会话/);
  assert.equal(JSON.parse(await readFile(join(cliOut, 'manifest.json'), 'utf8')).counts.conversations, 2);

  // 直接调用纯函数：title 覆盖与 mapping 结构。
  const direct = conversationToOfficial(conversationA, { title: '另一标题', attachmentPath: () => null });
  assert.equal(direct.title, '另一标题');
  assert.equal(direct.ceobe.original_title, '原始标题 A');
  assert.equal(direct.ceobe.resources.every(resource => resource.local_path === null), true);

  console.log('PASS export JSON: official mapping order/branches, content.raw passthrough, current_node reachable, hidden flags, degraded fallback, content-addressed attachments, manifest counts, deterministic bytes, --no-assets/--compact/--id, CLI');
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
}
