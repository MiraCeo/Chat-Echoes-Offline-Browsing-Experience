import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  KEY_FILES, collectMemoryChecklist, collectMemoryStatus, freshnessForPage, stagingCandidates,
} from './memory-freshness.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const write = async (path, text) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
};
const walk = async (dir, out = []) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
};
const ago = seconds => new Date(Date.now() - seconds * 1000);

const SESSIONS = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', short: 'aaaaaaaa', title: '会话一', group: 'gq', rounds: 3 },
  { id: 'bbbbbbbb-0000-0000-0000-000000000002', short: 'bbbbbbbb', title: '会话二', group: 'g1', rounds: 5 },
];

/**
 * Isolated fixture: archive + kernel source + view + published page, with
 * mtimes ordered source < view < page so the baseline is "in sync".
 */
async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ceobe-memory-status-'));
  const source = join(root, 'data/private/memory-kernel/source');
  const sessions = options.sessions || SESSIONS;
  const archiveSessions = sessions.map(session => ({
    id: session.id, title: session.title, user_turn_count: session.rounds,
  }));
  if (options.extraArchive) archiveSessions.push(...options.extraArchive);
  await write(join(root, 'archive/library.ceobe.json'), JSON.stringify({ conversations: archiveSessions }));

  const mapSessions = sessions.map(session => ({
    id: session.id, short: session.short, title: session.title, group: session.group, rounds: session.rounds,
    l1: { path: `output/${session.id}.json` },
    l2: { path: `memory/${session.id}.md` },
    l4: { path: `events/${session.id}.json` },
  }));
  await write(join(source, 'overlay/archive-map.json'), JSON.stringify({ sessions: mapSessions }));
  for (const session of sessions) {
    await write(join(source, `output/${session.id}.json`), '{"summary":"x"}');
    await write(join(source, `memory/${session.id}.md`), '# L2\n\n内容');
    await write(join(source, `events/${session.id}.json`), '{"nodes":[]}');
  }
  for (const group of ['gq', 'g1', 'g-early', 'g-oct']) {
    const ids = sessions.filter(session => session.group === group).map(session => session.id);
    await write(join(source, `overlay/l3-${group}.v2.json`), JSON.stringify({
      scope: { id: group }, as_of: '2026-10-13',
      coverage: { sessions: ids.length, session_ids: ids },
    }));
  }
  await write(join(source, 'overlay/l3-global.v2.json'), JSON.stringify({
    scope: { id: 'global' }, as_of: '2026-10-13', coverage: { sessions: sessions.length },
  }));
  await write(join(source, 'global/overview-v2.md'), '# 总览\n\n正文');
  await write(join(source, 'global/tree.json'), JSON.stringify({
    nodes: sessions.map((session, index) => ({ n: index + 1, src: [{ s: session.short, r: [1, 1] }] })),
    edges: [],
  }));
  await write(join(source, 'global/threads/线一.md'), '# 线一\n\n' + '内容'.repeat(200));
  const groupCounts = Object.fromEntries(['gq', 'g1', 'g-early', 'g-oct']
    .map(group => [group, sessions.filter(session => session.group === group).length]));
  await write(join(source, 'ceobe-index.json'), JSON.stringify({
    counts: {
      sessions: sessions.length,
      rounds: sessions.reduce((sum, session) => sum + session.rounds, 0),
      ...groupCounts,
    },
  }));

  const hashes = {};
  for (const file of KEY_FILES) hashes[file] = sha(await readFile(join(source, file), 'utf8'));
  await write(join(root, 'data/private/memory-kernel/source-manifest.json'), JSON.stringify({
    schema: 'ceobe.memory-kernel-source/1',
    imported_at: ago(60).toISOString(),
    archive_sessions: sessions.length,
    hashes,
  }));

  const viewPath = join(root, 'data/private/memory-kernel/memory-view.json');
  await write(viewPath, JSON.stringify({
    schema: 'ceobe.memory-view/2',
    generated_at: ago(60).toISOString(),
    archive: { total: sessions.length, groups: groupCounts },
    groups: [], sessions: [],
  }));
  const publishedPath = join(root, 'replay/public/memory-data.json');
  await write(publishedPath, JSON.stringify({ archive: { total: sessions.length } }));

  for (const file of await walk(source)) await utimes(file, ago(120), ago(120));
  await utimes(viewPath, ago(60), ago(60));
  await utimes(publishedPath, ago(30), ago(30));

  return { root, source, viewPath, publishedPath };
}

async function withFixture(options, run) {
  const built = await fixture(options);
  try { await run(built); }
  finally { await rm(built.root, { recursive: true, force: true }); }
}

// A. Baseline: everything in sync.
await withFixture({}, async ({ root }) => {
  const status = await collectMemoryStatus(root);
  assert.equal(status.archive_sessions, 2);
  assert.equal(status.source_sessions, 2);
  assert.equal(status.view_sessions, 2);
  assert.equal(status.published_sessions, 2);
  assert.equal(status.new_sessions.length, 0);
  assert.equal(status.retired_sessions.length, 0);
  assert.equal(status.source_changed, false);
  assert.equal(status.page_stale, false);
  assert.equal(status.stale, false, 'baseline fixture should be in sync');
  assert.equal(status.manifest_hashes, KEY_FILES.length);

  const checklist = await collectMemoryChecklist(root);
  assert.equal(checklist.needs_update, false);
  assert.deepEqual(checklist.actions, []);
  assert.equal(checklist.docs.files, 1);
  assert.equal(freshnessForPage(status).stale, false);
});

// B. A new archive session is not in the kernel yet.
await withFixture({ extraArchive: [{ id: 'cccccccc-0000-0000-0000-000000000003', title: '新会话', user_turn_count: 7 }] }, async ({ root }) => {
  const status = await collectMemoryStatus(root);
  assert.equal(status.archive_sessions, 3);
  assert.equal(status.source_sessions, 2);
  assert.equal(status.new_sessions.length, 1);
  assert.equal(status.new_sessions[0].short, 'cccccccc');
  assert.equal(status.stale, true);
  assert.ok(status.reasons.some(reason => reason.code === 'new_sessions'));

  const checklist = await collectMemoryChecklist(root);
  assert.equal(checklist.needs_update, true);
  assert.equal(checklist.sessions.new.length, 1);
  assert.ok(checklist.actions.some(action => action.includes('补 L1/L2/L4') && action.includes('cccccccc')));
  assert.ok(checklist.actions.some(action => action.includes('ceobe-index')), 'index counts must be flagged');
  const candidates = stagingCandidates(checklist);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].suggested_paths.l2, 'inbox/memory/cccccccc-0000-0000-0000-000000000003.md');
  assert.ok(candidates[0].steps.length >= 3);
});

// C. Kernel source edited after the view was generated.
await withFixture({}, async ({ root, source }) => {
  await write(join(source, 'global/overview-v2.md'), '# 总览\n\n改过的正文');
  const status = await collectMemoryStatus(root);
  assert.equal(status.source_changed, true);
  assert.equal(status.stale, true);
  assert.ok(status.changed_files.some(file => file.file === 'global/overview-v2.md' && file.reason === 'changed'));
  assert.ok(status.reasons.some(reason => reason.code === 'source_changed'));
  const page = freshnessForPage(status);
  assert.equal(page.stale, true);
  assert.ok(page.reasons.some(text => text.includes('source')));
});

// D. A session is missing one of its layers.
await withFixture({}, async ({ root, source }) => {
  await rm(join(source, 'memory/aaaaaaaa-0000-0000-0000-000000000001.md'));
  const checklist = await collectMemoryChecklist(root);
  assert.equal(checklist.sessions.missing_layers.length, 1);
  assert.deepEqual(checklist.sessions.missing_layers[0].layers, ['l2']);
  assert.ok(checklist.actions.some(action => action.includes('补 L2') && action.includes('aaaaaaaa')));
});

// E. Archive rounds moved on; L2/L4 must be rerun.
await withFixture({}, async ({ root }) => {
  await write(join(root, 'archive/library.ceobe.json'), JSON.stringify({
    conversations: [
      { id: SESSIONS[0].id, title: SESSIONS[0].title, user_turn_count: 9 },
      { id: SESSIONS[1].id, title: SESSIONS[1].title, user_turn_count: 5 },
    ],
  }));
  const checklist = await collectMemoryChecklist(root);
  assert.equal(checklist.sessions.round_mismatch.length, 1);
  assert.equal(checklist.sessions.round_mismatch[0].archive_rounds, 9);
  assert.equal(checklist.sessions.round_mismatch[0].kernel_rounds, 3);
  assert.ok(checklist.actions.some(action => action.includes('重跑 L2/L4')));
});

// F. L3 coverage no longer matches the archive map.
await withFixture({}, async ({ root, source }) => {
  await write(join(source, 'overlay/l3-gq.v2.json'), JSON.stringify({
    scope: { id: 'gq' }, as_of: '2026-10-13', coverage: { sessions: 0, session_ids: [] },
  }));
  const checklist = await collectMemoryChecklist(root);
  const gq = checklist.groups.find(group => group.group === 'gq');
  assert.equal(gq.needs_update, true);
  assert.equal(gq.missing.length, 1);
  assert.ok(checklist.actions.some(action => action.includes('更新 L3/L3.1') && action.includes('国庆组')));
});

// G. View is newer than the published page: page-only staleness.
await withFixture({}, async ({ root, viewPath }) => {
  await utimes(viewPath, new Date(), new Date());
  const status = await collectMemoryStatus(root);
  assert.equal(status.page_stale, true);
  assert.equal(status.source_changed, false);
  assert.ok(status.reasons.some(reason => reason.code === 'page_stale'));
  const page = freshnessForPage(status);
  assert.equal(page.stale, false, 'the page must not report its own publication lag');
  assert.deepEqual(page.reasons, []);
});

// H. The real repository is in sync (npm test runs `npm run library` first).
// 新导入的会话要补 L1/L2/L4 才会进内核；有这种待办时跳过「完全同步」的断言，
// 但仍然校验状态本身把这些差异报了出来。
const real = await collectMemoryStatus(process.cwd());
if (real.new_sessions.length || real.retired_sessions.length) {
  console.log(`SKIP memory status in-sync check: ${real.new_sessions.length} 个新会话 / ${real.retired_sessions.length} 个退役会话待补 L1/L2/L4`);
  assert.equal(real.stale, true, '有新会话时记忆应报 stale');
  assert.ok(real.reasons.some(reason => reason.code === 'new_sessions' || reason.code === 'retired_sessions'));
} else {
  assert.equal(real.archive_sessions, real.source_sessions);
  assert.equal(real.source_sessions, real.view_sessions);
  assert.equal(real.new_sessions.length, 0);
  assert.equal(real.retired_sessions.length, 0);
  assert.equal(real.source_changed, false, 'kernel source changed since the last import; run npm run memory:import');
  assert.equal(real.stale, false, 'memory is stale; run npm run memory:import && npm run library');
  const realChecklist = await collectMemoryChecklist(process.cwd());
  assert.equal(realChecklist.needs_update, false, `unexpected memory work: ${realChecklist.actions.join('; ')}`);
}

console.log('PASS memory status: archive/source/view/page freshness, new sessions, layer gaps, L3 coverage, checklist and staging');
