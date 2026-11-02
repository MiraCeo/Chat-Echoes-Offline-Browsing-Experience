#!/usr/bin/env node
/**
 * Normalize the full memory-kernel handover into the read-only view consumed
 * by CEOBE. It reads the handover repository, never the raw corpus contents,
 * and writes only a derived private view.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { marked } from 'marked';
import { bookmarkTargets } from './bookmark-targets.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const option = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const source = resolve(option('--source') || process.env.CEOBE_MEMORY_SOURCE || join(projectRoot, 'data/private/memory-kernel/source'));
const target = join(projectRoot, 'data/private/memory-kernel/memory-view.json');
const groupIds = ['gq', 'g1', 'g-early', 'g-oct'];
const groupLabels = {
  gq: '国庆组',
  g1: '01–07 序列',
  'g-early': '早期账号',
  'g-oct': '十月账号',
};
const blockOrder = ['who', 'doing', 'waiting', 'changes'];
const blockLabels = { who: '我是谁', doing: '在手的事', waiting: '等着的事', changes: '近期变化' };

const readJson = async path => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`读取失败：${path}（${error.message}）`); }
};
const requireFile = path => {
  if (!existsSync(path)) throw new Error(`缺少文件：${path}`);
  return path;
};
const sections = text => [...text.matchAll(/^##\s+(.+)$/gm)].map(match => match[1].trim());
const chars = text => text.replace(/\s/g, '').length;
const stripFrontmatter = text => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
const renderMarkdown = text => marked.parse(stripFrontmatter(text), { async: false });

const archive = await readJson(join(projectRoot, 'archive/library.ceobe.json'));
const currentIds = new Set((archive.conversations || []).map(item => item.id));
const map = await readJson(await requireFile(join(source, 'overlay/archive-map.json')));
const sessions = map.sessions || [];
if (sessions.length !== currentIds.size) throw new Error(`archive-map 会话数 ${sessions.length} 与 archive ${currentIds.size} 不一致`);
const mapIds = new Set(sessions.map(item => item.id));
if (mapIds.size !== currentIds.size || [...currentIds].some(id => !mapIds.has(id))) throw new Error('archive-map 与当前 archive 的会话 ID 不一致');
const groupCounts = Object.fromEntries(groupIds.map(id => [id, 0]));
for (const session of sessions) {
  if (!groupIds.includes(session.group)) throw new Error(`未知分组：${session.id} -> ${session.group}`);
  groupCounts[session.group] += 1;
}
const ungrouped = await readJson(await requireFile(join(source, 'overlay/ungrouped.json')));
if (Number(ungrouped.count) !== 0) throw new Error(`当前接入假定 0 个未分组，实际 ${ungrouped.count}`);

const l3Global = await readJson(await requireFile(join(source, 'overlay/l3-global.v2.json')));
if (l3Global.scope?.id !== 'global') throw new Error('l3-global 的 scope 不是 global');
const globalMainlines = (l3Global.threads || []).filter(thread => thread.mainline)
  .map(thread => ({ id: thread.id, label: thread.label, kind: thread.kind, scope_refs: thread.scope_refs || [] }));
const globalThreads = (l3Global.threads || []).map(thread => ({
  id: thread.id, label: thread.label, kind: thread.kind, mainline: Boolean(thread.mainline),
  scope_refs: thread.scope_refs || [], status: thread.status || null,
}));

const overviewText = await readFile(requireFile(join(source, 'global/overview-v2.md')), 'utf8');
const threadDir = join(source, 'global/threads');
const threadDocs = [];
for (const name of (await readdir(threadDir)).filter(name => name.endsWith('.md')).sort()) {
  const text = await readFile(join(threadDir, name), 'utf8');
  threadDocs.push({
    name: name.slice(0, -3), path: `global/threads/${name}`, chars: chars(text),
    sections: sections(text), html: renderMarkdown(text),
  });
}
const tree = await readJson(await requireFile(join(source, 'global/tree.json')));
const treeStats = { path: 'global/tree.json', nodes: tree.nodes?.length || 0, edges: tree.edges?.length || 0, sessions: l3Global.coverage?.sessions || 0 };
const threadMap = await readJson(await requireFile(join(source, 'overlay/thread-map.json')));

const groups = [];
for (const group of groupIds) {
  const l3 = await readJson(await requireFile(join(source, `overlay/l3-${group}.v2.json`)));
  const bank = await readJson(await requireFile(join(source, `overlay/l3.1-${group}.v2.json`)));
  if (l3.scope?.id !== group || bank.group !== group) throw new Error(`${group} 的 L3/bank 分组不一致`);
  const coverageIds = new Set(l3.coverage?.session_ids || []);
  if (coverageIds.size !== groupCounts[group]) throw new Error(`${group} coverage 会话数与 archive-map 不一致`);
  const mainlines = (l3.threads || []).filter(thread => thread.mainline).map(thread => ({
    id: thread.id, label: thread.label, kind: thread.kind, scope_refs: thread.scope_refs || [], status: thread.status || null,
  }));
  const mainlineIds = new Set(mainlines.map(item => item.id));
  if ((bank.mainline_threads || []).some(id => !mainlineIds.has(id))) throw new Error(`${group} bank mainline 引用不存在的 thread`);
  groups.push({
    group,
    name: groupLabels[group] || l3.scope?.label || group,
    confirmed: true,
    as_of: l3.as_of,
    coverage: bank.coverage || l3.coverage,
    mainlines,
    themes: (l3.themes || []).map(theme => ({ id: theme.id, label: theme.label, kind: theme.kind })),
    blocks: Object.fromEntries(blockOrder.map(key => [key, bank.blocks?.[key] || []])),
    block_order: blockOrder,
    block_labels: blockLabels,
    delta_from_previous: bank.delta_from_previous,
    flags: bank.flags || [],
    coverage_gaps: l3.coverage_gaps || [],
    external_session_ids: l3.coverage?.external_session_ids || [],
  });
}

const sessionView = [];
for (const session of sessions) {
  const l1Path = join(source, session.l1?.path || '');
  const l2Path = join(source, session.l2?.path || '');
  const l4Path = join(source, session.l4?.path || '');
  if (!session.l1?.path || !existsSync(l1Path)) throw new Error(`缺少 L1：${session.id}`);
  if (!session.l2?.path || !existsSync(l2Path)) throw new Error(`缺少 L2：${session.id}`);
  if (!session.l4?.path || !existsSync(l4Path)) throw new Error(`缺少 L4：${session.id}`);
  const l1 = await readJson(l1Path);
  const l2Text = await readFile(requireFile(l2Path), 'utf8');
  const l4 = await readJson(requireFile(l4Path));
  const libraryEntry = archive.conversations.find(item => item.id === session.id);
  const roundMap = libraryEntry?.conversation_path && existsSync(join(projectRoot, libraryEntry.conversation_path))
    ? bookmarkTargets(await readJson(join(projectRoot, libraryEntry.conversation_path)))
      .map((target, index) => ({ round: index + 1, role: target.role, message_id: target.message_id }))
    : [];
  sessionView.push({
    id: session.id,
    short: session.short || session.id.slice(0, 8),
    title: session.title,
    group: session.group,
    project_label: session.project_label || null,
    rounds: session.rounds,
    page: libraryEntry?.page || null,
    round_map: roundMap,
    staging: Boolean(session.l1?.staging || session.l2?.staging || session.l4?.staging),
    l1: { path: session.l1.path, summary: l1.summary || '', tags: l1.tags || [] },
    l2: { path: session.l2.path, html: renderMarkdown(l2Text) },
    l4: {
      path: session.l4.path,
      ents: l4.ents || [],
      nodes: (l4.nodes || []).map(node => ({ n: node.n, t: node.t, s: node.s, r: node.r, x: node.x })),
      edges: l4.edges || [],
      open: l4.open || [],
    },
  });
}

const view = {
  schema: 'ceobe.memory-view/2',
  generated_at: new Date().toISOString(),
  source: {
    root: source.replaceAll('\\', '/'),
    archive_map: 'overlay/archive-map.json',
    archive: 'archive/library.ceobe.json',
    handover: 'HANDOVER.md',
  },
  archive: {
    total: sessions.length,
    groups: groupCounts,
    ungrouped: 0,
    rounds: l3Global.coverage?.rounds ?? null,
  },
  groups,
  global: {
    scope: l3Global.scope,
    as_of: l3Global.as_of,
    coverage: l3Global.coverage,
    mainlines: globalMainlines,
    threads: globalThreads,
    projects: (l3Global.projects || []).map(project => ({ id: project.id, label: project.label, kind: project.kind })),
    themes: (l3Global.themes || []).map(theme => ({ id: theme.id, label: theme.label, kind: theme.kind })),
    conflicts: (l3Global.conflicts || []).map(conflict => ({
      id: conflict.id, topic: conflict.topic, status: conflict.status,
      kind: conflict.kind || conflict.type, preferred: conflict.preferred,
    })),
    overview: {
      path: 'global/overview-v2.md', chars: chars(overviewText),
      sections: sections(overviewText), html: renderMarkdown(overviewText),
    },
    thread_docs: threadDocs,
    tree: treeStats,
    tree_data: {
      nodes: tree.nodes || [],
      edges: tree.edges || [],
      open: tree.open || [],
      pruned: tree.pruned || [],
    },
    thread_map_counts: threadMap.counts || null,
  },
  sessions: sessionView,
  ungrouped: { count: 0, sessions: [] },
};

await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(view, null, 2) + '\n', 'utf8');
console.log(`Memory view built: ${target}`);
console.log(`Groups: ${groupIds.map(id => `${id}=${groupCounts[id]}`).join(', ')}; sessions ${sessions.length}; global mainlines ${globalMainlines.length}; thread docs ${threadDocs.length}; tree ${treeStats.nodes}/${treeStats.edges}.`);
