/**
 * Memory freshness: compare archive → kernel source → derived view → published page.
 *
 * Shared by `npm run memory:status`, `npm run memory:checklist` and the memory
 * page builder, so the CLI and the page can never disagree about what "stale"
 * means. Everything here is read-only; the only writer is the checklist's
 * optional `--stage` (and that writes outside the kernel source).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

export const GROUP_IDS = ['gq', 'g1', 'g-early', 'g-oct'];
export const GROUP_LABELS = {
  gq: '国庆组',
  g1: '01–07 序列',
  'g-early': '早期账号',
  'g-oct': '十月账号',
};

/** Files whose hash the import manifest records; a change here means the view is stale. */
export const KEY_FILES = [
  'overlay/archive-map.json',
  'overlay/l3-global.v2.json',
  'overlay/l3-gq.v2.json',
  'overlay/l3-g1.v2.json',
  'overlay/l3-g-early.v2.json',
  'overlay/l3-g-oct.v2.json',
  'global/overview-v2.md',
  'global/tree.json',
];

const SKIP_DIRS = new Set(['.git', '_package', 'node_modules', '__pycache__']);
const MTIME_SLACK_MS = 2000;

const pad = value => String(value).padStart(2, '0');

export function formatTime(value) {
  if (value === null || value === undefined || value === '') return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const memoryPaths = projectRoot => ({
  archive: join(projectRoot, 'archive/library.ceobe.json'),
  source: join(projectRoot, 'data/private/memory-kernel/source'),
  view: join(projectRoot, 'data/private/memory-kernel/memory-view.json'),
  manifest: join(projectRoot, 'data/private/memory-kernel/source-manifest.json'),
  published: join(projectRoot, 'replay/public/memory-data.json'),
  staging: join(projectRoot, 'data/private/memory-kernel/inbox-staging.json'),
});

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
}

async function mtimeOf(path) {
  try { return (await stat(path)).mtimeMs; }
  catch { return null; }
}

const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');

async function walkFiles(dir, base = dir, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles(full, base, out);
    else if (entry.isFile()) out.push(relative(base, full).replaceAll('\\', '/'));
  }
  return out;
}

const shortOf = session => session.short || String(session.id || '').slice(0, 8);

/**
 * Full archive → source → view → page comparison.
 * `reasons` is the single source of truth for "stale"; each entry carries a
 * stable `code` so the page can drop the page-only reason.
 */
export async function collectMemoryStatus(projectRoot = resolve(import.meta.dirname, '..')) {
  const paths = memoryPaths(projectRoot);
  const archive = await readJson(paths.archive, { conversations: [] });
  const map = await readJson(join(paths.source, 'overlay/archive-map.json'), { sessions: [] });
  const view = await readJson(paths.view);
  const manifest = await readJson(paths.manifest);
  const published = await readJson(paths.published);

  const archiveSessions = Array.isArray(archive?.conversations) ? archive.conversations : [];
  const mapSessions = Array.isArray(map?.sessions) ? map.sessions : [];
  const archiveIds = new Set(archiveSessions.map(item => item.id));
  const mapIds = new Set(mapSessions.map(item => item.id));

  const newSessions = archiveSessions
    .filter(item => !mapIds.has(item.id))
    .map(item => ({ id: item.id, short: shortOf(item), title: item.title || '' }));
  const retiredSessions = mapSessions
    .filter(item => !archiveIds.has(item.id))
    .map(item => ({ id: item.id, short: shortOf(item), title: item.title || '' }));

  const viewMtime = await mtimeOf(paths.view);
  const publishedMtime = await mtimeOf(paths.published);

  const changedFiles = [];
  for (const [file, expected] of Object.entries(manifest?.hashes || {})) {
    const path = join(paths.source, file);
    if (!existsSync(path)) { changedFiles.push({ file, reason: 'missing' }); continue; }
    if (await sha256(path) !== expected) changedFiles.push({ file, reason: 'changed' });
  }

  // Hash coverage is only the eight key files; a newer file anywhere in the
  // source tree (a fresh L2, a new inbox event) also means the view is behind.
  const newerSourceFiles = [];
  if (viewMtime) {
    for (const file of await walkFiles(paths.source)) {
      const mtime = await mtimeOf(join(paths.source, file));
      if (mtime && mtime > viewMtime + MTIME_SLACK_MS) newerSourceFiles.push(file);
    }
  }

  const sourceChanged = changedFiles.length > 0 || newerSourceFiles.length > 0;
  const viewSessions = Number(view?.archive?.total ?? view?.sessions?.length ?? 0);
  const publishedSessions = Number(published?.archive?.total ?? published?.sessions?.length ?? 0);
  const pageStale = Boolean(viewMtime && publishedMtime && viewMtime > publishedMtime + MTIME_SLACK_MS);

  const reasons = [];
  if (!view) reasons.push({ code: 'view_missing', text: '缺少 memory-view.json，先运行 npm run memory:import' });
  if (newSessions.length) {
    reasons.push({ code: 'new_sessions', text: `archive 有 ${newSessions.length} 个新会话未进入内核 source` });
  }
  if (retiredSessions.length) {
    reasons.push({ code: 'retired_sessions', text: `内核 source 有 ${retiredSessions.length} 个会话已不在 archive` });
  }
  if (sourceChanged) {
    const detail = changedFiles.length
      ? `${changedFiles.length} 个关键文件哈希不匹配`
      : `${newerSourceFiles.length} 个文件比 view 新`;
    reasons.push({ code: 'source_changed', text: `内核 source 在 view 之后有更新（${detail}）` });
  }
  if (pageStale) {
    reasons.push({ code: 'page_stale', text: '页面数据比 view 旧，运行 npm run library 重新发布' });
  }

  return {
    schema: 'ceobe.memory-status/1',
    generated_at: new Date().toISOString(),
    paths,
    archive_sessions: archiveSessions.length,
    source_sessions: mapSessions.length,
    view_sessions: viewSessions,
    published_sessions: publishedSessions,
    view_generated_at: view?.generated_at || (viewMtime ? new Date(viewMtime).toISOString() : null),
    imported_at: manifest?.imported_at || null,
    published_at: publishedMtime ? new Date(publishedMtime).toISOString() : null,
    manifest_hashes: Object.keys(manifest?.hashes || {}).length,
    new_sessions: newSessions,
    retired_sessions: retiredSessions,
    source_changed: sourceChanged,
    changed_files: changedFiles,
    newer_source_files: newerSourceFiles,
    page_stale: pageStale,
    reasons,
    stale: reasons.length > 0,
  };
}

/**
 * What the page itself may claim. The page is the publication, so it never
 * reports "page data is older than the view" — only that the view is behind
 * the kernel source.
 */
export function freshnessForPage(status, builtAt = new Date()) {
  const reasons = status.reasons.filter(reason => reason.code !== 'page_stale');
  return {
    view_generated_at: status.view_generated_at,
    built_at: new Date(builtAt).toISOString(),
    stale: reasons.length > 0,
    reasons: reasons.map(reason => reason.text),
    new_sessions: status.new_sessions.length,
    source_changed: status.source_changed,
  };
}

/**
 * Per-session and per-layer work list. Mirrors RUNBOOK steps 1–5: a new session
 * needs L1/L2/L4 in inbox, then L3/L3.1, L5, the index and the thread docs.
 */
export async function collectMemoryChecklist(projectRoot = resolve(import.meta.dirname, '..')) {
  const status = await collectMemoryStatus(projectRoot);
  const paths = status.paths;
  const source = paths.source;

  const archive = await readJson(paths.archive, { conversations: [] });
  const map = await readJson(join(source, 'overlay/archive-map.json'), { sessions: [] });
  const archiveSessions = Array.isArray(archive?.conversations) ? archive.conversations : [];
  const mapSessions = Array.isArray(map?.sessions) ? map.sessions : [];
  const archiveById = new Map(archiveSessions.map(item => [item.id, item]));

  const missingLayers = [];
  for (const session of mapSessions) {
    const layers = ['l1', 'l2', 'l4'].filter(layer => {
      const path = session[layer]?.path;
      return !path || !existsSync(join(source, path));
    });
    if (layers.length) {
      missingLayers.push({ id: session.id, short: shortOf(session), title: session.title || '', layers });
    }
  }

  const roundMismatch = [];
  for (const session of mapSessions) {
    const entry = archiveById.get(session.id);
    if (!entry) continue;
    const archiveRounds = Number(entry.user_turn_count);
    const kernelRounds = Number(session.rounds);
    if (Number.isFinite(archiveRounds) && Number.isFinite(kernelRounds) && archiveRounds !== kernelRounds) {
      roundMismatch.push({
        id: session.id, short: shortOf(session), title: session.title || '',
        archive_rounds: archiveRounds, kernel_rounds: kernelRounds,
      });
    }
  }

  const groups = [];
  for (const group of GROUP_IDS) {
    const l3 = await readJson(join(source, `overlay/l3-${group}.v2.json`));
    const kernelIds = mapSessions.filter(session => session.group === group).map(session => session.id);
    const coverageIds = new Set(l3?.coverage?.session_ids || []);
    const missing = kernelIds.filter(id => !coverageIds.has(id));
    const extra = [...coverageIds].filter(id => !kernelIds.includes(id));
    const coverageSessions = Number(l3?.coverage?.sessions ?? NaN);
    groups.push({
      group,
      name: GROUP_LABELS[group] || group,
      as_of: l3?.as_of || null,
      kernel_sessions: kernelIds.length,
      coverage_sessions: Number.isFinite(coverageSessions) ? coverageSessions : null,
      missing,
      extra,
      needs_update: missing.length > 0 || extra.length > 0 || coverageSessions !== kernelIds.length,
    });
  }

  const tree = await readJson(join(source, 'global/tree.json'), { nodes: [] });
  const treeSessions = new Set();
  for (const node of tree?.nodes || []) {
    for (const src of node.src || []) if (src?.s) treeSessions.add(src.s);
  }
  const sessionsWithoutTree = mapSessions
    .filter(session => !treeSessions.has(shortOf(session)))
    .map(session => ({ id: session.id, short: shortOf(session), title: session.title || '' }));

  const index = await readJson(join(source, 'ceobe-index.json'));
  const indexIssues = [];
  if (index?.counts) {
    if (Number(index.counts.sessions) !== archiveSessions.length) {
      indexIssues.push(`sessions ${index.counts.sessions} → ${archiveSessions.length}`);
    }
    const rounds = archiveSessions.reduce((sum, item) => sum + (Number(item.user_turn_count) || 0), 0);
    if (Number(index.counts.rounds) !== rounds) indexIssues.push(`rounds ${index.counts.rounds} → ${rounds}`);
    for (const group of GROUP_IDS) {
      const expected = mapSessions.filter(session => session.group === group).length;
      if (Number(index.counts[group]) !== expected) indexIssues.push(`${group} ${index.counts[group] ?? '—'} → ${expected}`);
    }
  }

  const docDir = join(source, 'global/threads');
  const docFiles = (await readdir(docDir).catch(() => [])).filter(name => name.endsWith('.md'));
  const thinDocs = [];
  for (const name of docFiles) {
    const text = await readFile(join(docDir, name), 'utf8').catch(() => '');
    if (text.trim().length < 200) thinDocs.push(name);
  }

  const actions = [];
  for (const session of status.new_sessions) {
    actions.push(`补 L1/L2/L4：${session.short} ${session.title}（新会话，走 inbox/ staging）`);
  }
  for (const session of missingLayers) {
    actions.push(`补 ${session.layers.map(layer => layer.toUpperCase()).join('/')}：${session.short} ${session.title}`);
  }
  for (const session of roundMismatch) {
    actions.push(`重跑 L2/L4：${session.short} 轮次 ${session.kernel_rounds} → ${session.archive_rounds}`);
  }
  for (const group of groups.filter(item => item.needs_update)) {
    const detail = group.missing.length || group.extra.length
      ? `缺 ${group.missing.length} / 多 ${group.extra.length} 个会话`
      : `覆盖 ${group.coverage_sessions} → ${group.kernel_sessions}`;
    actions.push(`更新 L3/L3.1：${group.name}（${detail}）`);
  }
  for (const session of sessionsWithoutTree) {
    actions.push(`补 L5 节点：${session.short} ${session.title}`);
  }
  for (const issue of indexIssues) actions.push(`更新 ceobe-index：${issue}`);
  for (const name of thinDocs) actions.push(`补分册正文：${name}`);
  if (actions.length) actions.push('复核分册：新增/变更会话需在 global/threads 补时间轴条目');

  return {
    schema: 'ceobe.memory-checklist/1',
    generated_at: new Date().toISOString(),
    status,
    sessions: {
      new: status.new_sessions,
      retired: status.retired_sessions,
      missing_layers: missingLayers,
      round_mismatch: roundMismatch,
    },
    groups,
    l5: { sessions_without_nodes: sessionsWithoutTree },
    index: { issues: indexIssues },
    docs: { files: docFiles.length, thin: thinDocs },
    actions,
    needs_update: actions.length > 0,
  };
}

/** Staging candidates for new archive sessions. Todo only — never content. */
export function stagingCandidates(checklist) {
  return checklist.sessions.new.map(session => ({
    id: session.id,
    short: session.short,
    title: session.title,
    group: null,
    suggested_paths: {
      l1: `inbox/output/${session.id}.json`,
      l2: `inbox/memory/${session.id}.md`,
      l4: `inbox/events/${session.id}.json`,
    },
    steps: [
      '把会话原文放进 inbox/conversations/',
      '生成 L1 → L2 → L4（顺序不能反）',
      '在 overlay/archive-map.json 加条目并更新 counts',
      '按 RUNBOOK 更新 L3/L3.1、L5、ceobe-index 和分册',
    ],
  }));
}

const mark = ok => (ok ? '✓' : '✗');

export function formatStatus(status) {
  const lines = [];
  lines.push(`CEOBE 记忆状态 · ${formatTime(status.generated_at)}`);
  lines.push('');
  lines.push(`  归档 archive      ${status.archive_sessions} 会话`);
  lines.push(`  内核 source       ${status.source_sessions} 会话（overlay/archive-map.json）`);
  lines.push(`  派生 view         ${status.view_sessions} 会话（生成于 ${formatTime(status.view_generated_at)}）`);
  lines.push(`  已发布页面        ${status.published_sessions} 会话（${formatTime(status.published_at)}）`);
  lines.push('');
  lines.push('  检查');
  lines.push(`    ${mark(!status.new_sessions.length && !status.retired_sessions.length)} archive 与 source 一致`);
  lines.push(`    ${mark(!status.source_changed)} source 与 view 一致（${status.manifest_hashes} 个关键文件哈希）`);
  lines.push(`    ${mark(!status.page_stale)} view 已发布到页面`);
  if (status.new_sessions.length) {
    lines.push('');
    lines.push(`  新会话（${status.new_sessions.length}）`);
    for (const session of status.new_sessions) lines.push(`    + ${session.short} ${session.title}`);
  }
  if (status.retired_sessions.length) {
    lines.push('');
    lines.push(`  已不在 archive（${status.retired_sessions.length}）`);
    for (const session of status.retired_sessions) lines.push(`    - ${session.short} ${session.title}`);
  }
  if (status.source_changed) {
    lines.push('');
    lines.push('  source 变化');
    for (const file of status.changed_files.slice(0, 8)) lines.push(`    ~ ${file.file}（${file.reason === 'missing' ? '缺失' : '已修改'}）`);
    if (status.changed_files.length > 8) lines.push(`    … 另有 ${status.changed_files.length - 8} 个`);
    if (!status.changed_files.length) {
      for (const file of status.newer_source_files.slice(0, 8)) lines.push(`    ~ ${file}（比 view 新）`);
      if (status.newer_source_files.length > 8) lines.push(`    … 另有 ${status.newer_source_files.length - 8} 个`);
    }
  }
  lines.push('');
  if (status.stale) {
    lines.push('  结论：记忆可能过期。');
    for (const reason of status.reasons) lines.push(`    · ${reason.text}`);
    lines.push('    更新：npm run memory:import && npm run library');
  } else {
    lines.push('  结论：记忆是最新的。');
  }
  return lines.join('\n');
}

export function formatChecklist(checklist) {
  const lines = [];
  lines.push(`CEOBE 记忆更新清单 · ${formatTime(checklist.generated_at)}`);
  lines.push('');
  const section = (title, items) => {
    lines.push(`  ${title}`);
    if (!items.length) lines.push('    ✓ 无');
    else for (const item of items) lines.push(`    · ${item}`);
    lines.push('');
  };
  const sessionItems = [
    ...checklist.sessions.new.map(session => `新会话 ${session.short} ${session.title}：补 L1/L2/L4（inbox staging）`),
    ...checklist.sessions.missing_layers.map(session => `${session.short} 缺 ${session.layers.map(layer => layer.toUpperCase()).join('/')}`),
    ...checklist.sessions.round_mismatch.map(session => `${session.short} 轮次 ${session.kernel_rounds} → ${session.archive_rounds}：重跑 L2/L4`),
    ...checklist.sessions.retired.map(session => `${session.short} 已不在 archive：在 archive-map 标 retired`),
  ];
  const groupItems = checklist.groups
    .filter(group => group.needs_update)
    .map(group => `${group.name}：覆盖 ${group.coverage_sessions ?? '—'} → ${group.kernel_sessions} 个会话`);
  const l5Items = checklist.l5.sessions_without_nodes.map(session => `${session.short} ${session.title}：补 L5 节点`);
  const indexItems = [
    ...checklist.index.issues.map(issue => `ceobe-index ${issue}`),
    ...checklist.docs.thin.map(name => `分册正文过短：${name}`),
  ];
  section('会话层（L1/L2/L4）', sessionItems);
  section('L3 / L3.1', groupItems);
  section('L5 跨会话树', l5Items);
  section('索引与分册', indexItems);
  if (checklist.needs_update) {
    lines.push(`  结论：${checklist.actions.length} 项待更新。`);
    for (const action of checklist.actions) lines.push(`    · ${action}`);
  } else {
    lines.push('  结论：无需更新。');
  }
  return lines.join('\n');
}
