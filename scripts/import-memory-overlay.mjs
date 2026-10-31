#!/usr/bin/env node
/**
 * Normalize the memory-kernel L3/L3.1 overlay into the one JSON the read-only
 * CEOBE memory page consumes. Read-only with respect to the overlay; it only
 * writes the derived private view.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const arg = name => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const source = resolve(arg('--source') || 'D:/ai-memory/overlay');
const base = dirname(source);
const target = join(projectRoot, 'data/private/memory-kernel/memory-view.json');

const labels = {
  gq: '国庆组',
  g1: '01–05 序列',
};
const blockOrder = ['who', 'doing', 'waiting', 'changes'];
const blockLabels = { who: '我是谁', doing: '在手的事', waiting: '等着的事', changes: '近期变化' };
const preferredValues = new Set(['left', 'right', null]);
const outcomes = new Set(['updated', 'no_information', 'worse', 'unknown']);

const readJson = async path => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`读取失败：${path}（${error.message}）`); }
};
const requireFile = async path => {
  if (!existsSync(path)) throw new Error(`缺少文件：${path}`);
  return path;
};
const checkPath = async (path, label) => {
  if (!path) return null;
  const full = join(base, path);
  const info = await stat(full).catch(() => null);
  if (!info?.isFile() || info.size === 0) throw new Error(`${label} 路径不存在或为空：${path}`);
  return path;
};
const sameSet = (left, right) => left.size === right.size && [...left].every(value => right.has(value));

const archive = await readJson(join(projectRoot, 'archive/library.ceobe.json'));
const currentIds = new Set((archive.conversations || []).map(item => item.id));
const map = await readJson(await requireFile(join(source, 'archive-map.json')));
const ungroupedDoc = await readJson(await requireFile(join(source, 'ungrouped.json')));
const gqL3 = await readJson(await requireFile(join(source, 'l3-gq.v2.json')));
const g1L3 = await readJson(await requireFile(join(source, 'l3-g1.v2.json')));
const gqBank = await readJson(await requireFile(join(source, 'l3.1-gq.v2.json')));
const g1Bank = await readJson(await requireFile(join(source, 'l3.1-g1.v2.json')));

const sessions = map.sessions || [];
if (sessions.length !== currentIds.size) throw new Error(`archive-map 会话数 ${sessions.length} 与当前 archive ${currentIds.size} 不一致`);
const mapIds = new Set(sessions.map(item => item.id));
if (!sameSet(mapIds, currentIds)) throw new Error('archive-map 的 id 与当前 archive 不一致');
const grouped = sessions.filter(item => item.group === 'gq' || item.group === 'g1');
const ungrouped = sessions.filter(item => !item.group);
if (grouped.length !== gqL3.coverage.sessions + g1L3.coverage.sessions) throw new Error('分组会话数与 L3 coverage 不一致');
if (ungrouped.length !== (ungroupedDoc.count ?? ungroupedDoc.sessions?.length)) throw new Error('ungrouped 会话数与 archive-map 不一致');
if (ungrouped.some(item => item.group)) throw new Error('ungrouped 中混入已分组会话');

for (const item of sessions) {
  await checkPath(item.l1?.path, `${item.id} L1`);
  await checkPath(item.l2?.path, `${item.id} L2`);
  await checkPath(item.l4?.path, `${item.id} L4`);
}
for (const item of ungroupedDoc.sessions || []) {
  await checkPath(item.l1?.path, `${item.id} ungrouped L1`);
  await checkPath(item.l2?.path, `${item.id} ungrouped L2`);
  await checkPath(item.l4?.path, `${item.id} ungrouped L4`);
}

function normalizeGroup(group, l3, bank) {
  if (l3.scope?.id !== group || bank.group !== group) throw new Error(`${group} 的 scope/bank 不一致`);
  const coverage = new Set(l3.coverage?.session_ids || []);
  if (!sameSet(coverage, new Set(grouped.filter(item => item.group === group).map(item => item.id)))) {
    throw new Error(`${group} 的 coverage 与 archive-map 不一致`);
  }
  const mainlines = (l3.threads || []).filter(thread => thread.mainline).map(thread => ({
    id: thread.id,
    label: thread.label,
    kind: thread.kind,
    status: thread.status,
    as_of: thread.as_of,
    scope_refs: thread.scope_refs || [],
  }));
  const mainlineIds = new Set(mainlines.map(item => item.id));
  if (mainlines.length !== (bank.mainline_threads || []).length
    || bank.mainline_threads.some(id => !mainlineIds.has(id))) {
    throw new Error(`${group} 的 mainline_threads 与 L3 threads 不一致`);
  }
  for (const conflict of l3.conflicts || []) {
    if (!preferredValues.has(conflict.preferred)) throw new Error(`${group}/${conflict.id} 的 preferred 非法`);
    if (conflict.kind === 'same_event_two_observers' && conflict.preferred !== null) {
      throw new Error(`${group}/${conflict.id} 是 same_event，preferred 必须为 null`);
    }
    if (conflict.kind === 'within_thread_revision' && !outcomes.has(conflict.outcome)) {
      throw new Error(`${group}/${conflict.id} 的 within_thread_revision 缺少合法 outcome`);
    }
    if (conflict.outcome !== undefined && !outcomes.has(conflict.outcome)) {
      throw new Error(`${group}/${conflict.id} 的 outcome 非法`);
    }
  }
  if (!bank.delta_from_previous
    || typeof bank.delta_from_previous.previous_bank !== 'string'
    || typeof bank.delta_from_previous.previous_as_of !== 'string'
    || !Array.isArray(bank.delta_from_previous.changes)
    || bank.delta_from_previous.changes.some(change => !change.kind)) {
    throw new Error(`${group} 的 delta_from_previous 结构不符合契约`);
  }
  const blocks = {};
  for (const key of blockOrder) blocks[key] = bank.blocks?.[key] || [];
  return {
    group,
    name: labels[group] || l3.scope?.label || group,
    as_of: bank.as_of,
    snapshot: bank.snapshot !== false,
    coverage: bank.coverage || l3.coverage,
    mainline_threads: bank.mainline_threads || [],
    mainlines,
    themes: (l3.themes || []).map(theme => ({ id: theme.id, label: theme.label, kind: theme.kind })),
    blocks,
    block_order: blockOrder,
    block_labels: blockLabels,
    delta_from_previous: bank.delta_from_previous,
    flags: bank.flags || [],
    provenance_gaps: l3.provenance_gaps || [],
  };
}

const view = {
  schema: 'ceobe.memory-view/1',
  generated_at: new Date().toISOString(),
  source: {
    overlay: source.replaceAll('\\', '/'),
    archive_map: 'archive-map.json',
    archive: 'archive/library.ceobe.json',
  },
  archive: {
    total: sessions.length,
    gq: grouped.filter(item => item.group === 'gq').length,
    g1: grouped.filter(item => item.group === 'g1').length,
    ungrouped: ungrouped.length,
  },
  groups: [
    normalizeGroup('gq', gqL3, gqBank),
    normalizeGroup('g1', g1L3, g1Bank),
  ],
  ungrouped: {
    count: ungrouped.length,
    note: ungroupedDoc.note || '未分组会话只有 L1/L2/L4，没有 L3/L3.1。',
    available_layers: ['l1', 'l2', 'l4'],
    sessions: await Promise.all((ungroupedDoc.sessions || []).map(async item => {
      const l1 = item.l1?.path ? await readJson(join(base, item.l1.path)).catch(() => null) : null;
      return {
        id: item.id,
        title: item.title,
        rounds: item.rounds,
        summary: typeof l1?.summary === 'string' ? l1.summary : '',
        tags: Array.isArray(l1?.tags) ? l1.tags : [],
        l1: item.l1?.path || null,
        l2: item.l2?.path || null,
        l4: item.l4?.path || null,
      };
    })),
  },
};

await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(view, null, 2) + '\n', 'utf8');
console.log(`Memory overlay adapted: ${target}`);
console.log(`Groups: gq ${view.archive.gq}, g1 ${view.archive.g1}; ungrouped ${view.archive.ungrouped}; mainlines ${view.groups.map(group => `${group.group}=${group.mainlines.length}`).join(', ')}.`);
