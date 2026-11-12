#!/usr/bin/env node
/**
 * 更新队列：把「加一个会话」拆成机械步骤和判断步骤。
 *
 *   npm run memory:queue               # 检测 + 生成工单（只读，不写内核）
 *   npm run memory:queue -- --apply    # 执行机械步骤（stage + register）
 *   npm run memory:queue -- --finalize # 判断步骤完成后收尾（import + library）
 *
 * 机械步骤（脚本能做）：复制会话、写 manifest / archive-map / ceobe-index、
 * 更新 L3/L3.1/global 的 coverage、导入、构建。
 *
 * 判断步骤（要 LLM）：L1 / L2 / L4 抽取、L5 归并、分册、profile。
 * 这些只生成工单，不自动执行——工单里写清输入、输出、提示词和校验器。
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectMemoryStatus, collectMemoryChecklist, memoryPaths } from './memory-freshness.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const paths = memoryPaths(projectRoot);
const option = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const has = name => process.argv.includes(name);
const group = option('--group') || 'g1';
const queuePath = join(projectRoot, 'data/private/memory-kernel/queue.json');

const readJson = async (path, fallback = null) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
};
const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
};
const sha256 = async path => 'sha256:' + createHash('sha256').update(await readFile(path)).digest('hex');

/** 判断步骤：每个会话三层 + 归并 + 文档。 */
function judgmentTasks(session) {
  const base = `inbox/conversations/${session.id}.md`;
  return [
    { id: 'l1', kind: 'judgment', input: base, output: `inbox/output/${session.id}.json`, prompt: 'PROMPT.md', validator: 'validate-output.mjs' },
    { id: 'l2', kind: 'judgment', input: base, output: `inbox/memory/${session.id}.md`, prompt: 'PROMPT-L2.md', validator: 'validate-memory.mjs' },
    { id: 'l4', kind: 'judgment', input: `inbox/memory/${session.id}.md`, output: `inbox/events/${session.id}.json`, prompt: 'PROMPT-L4.md', validator: 'validate-events.mjs' },
  ];
}

/** 检测：新会话 + 缺层 + L5 缺口 + 索引/分册问题。 */
export async function plan(root = projectRoot) {
  const paths = memoryPaths(root);
  const status = await collectMemoryStatus(root);
  const checklist = await collectMemoryChecklist(root);
  const archive = await readJson(paths.archive, { conversations: [] });
  const byId = new Map((archive.conversations || []).map(item => [item.id, item]));

  const sessions = status.new_sessions.map(session => {
    const entry = byId.get(session.id) || {};
    return {
      id: session.id,
      short: session.short,
      title: session.title,
      group,
      rounds: entry.user_turn_count ?? null,
      turns: entry.turn_count ?? null,
      conversation: entry.conversation_path || null,
      tasks: judgmentTasks(session),
    };
  });

  const merges = [];
  // 新会话还没进 archive-map，所以 L5 缺口检查看不到它们；两者任一都要归并。
  if (sessions.length || checklist.l5.sessions_without_nodes.length) {
    merges.push({
      id: 'l5-group',
      kind: 'judgment',
      input: `global/l5-${group}.json`,
      output: `global/l5-${group}.json`,
      prompt: 'PROMPT-L5.md',
      validator: 'validate-tree.mjs',
      sessions: checklist.l5.sessions_without_nodes.map(item => item.short),
    });
    merges.push({
      id: 'l5-global',
      kind: 'judgment',
      input: 'global/tree.json',
      output: 'global/tree.json',
      prompt: 'PROMPT-L5.md',
      validator: 'validate-tree.mjs',
      sessions: checklist.l5.sessions_without_nodes.map(item => item.short),
    });
  }

  const docs = [];
  if (sessions.length || checklist.l5.sessions_without_nodes.length) {
    docs.push({ id: 'threads', kind: 'judgment', note: '把新会话补进受影响的分册（时间轴 / 判断演变 / 当前状态 / 证据索引）' });
    docs.push({ id: 'profile', kind: 'judgment', note: '重跑 memory:profile --assemble，再让子代理重写 profile' });
  }

  return {
    schema: 'ceobe.memory-queue/1',
    generated_at: new Date().toISOString(),
    group,
    status: {
      archive_sessions: status.archive_sessions,
      source_sessions: status.source_sessions,
      view_sessions: status.view_sessions,
      stale: status.stale,
    },
    sessions,
    merges,
    docs,
    mechanical: [
      { id: 'stage', status: sessions.length ? 'pending' : 'done', note: '复制会话到 inbox + 写 inbox/manifest' },
      { id: 'register', status: sessions.length ? 'pending' : 'done', note: '写 archive-map / ceobe-index / L3 coverage' },
      { id: 'finalize', status: 'pending', note: 'memory:import + library' },
    ],
    checklist_actions: checklist.actions,
  };
}

/** 机械步骤 1：复制会话 + 写 inbox/manifest。 */
export async function stage(queue, root = projectRoot) {
  const paths = memoryPaths(root);
  const archive = await readJson(paths.archive, { conversations: [] });
  const byId = new Map((archive.conversations || []).map(item => [item.id, item]));
  const manifestPath = join(paths.source, 'inbox/manifest.json');
  const manifest = await readJson(manifestPath, { conversations: [] });
  const done = [];

  for (const session of queue.sessions) {
    const entry = byId.get(session.id);
    if (!entry?.conversation_path) continue;
    const convDir = dirname(join(root, entry.conversation_path));
    const source = join(convDir, 'conversation.md');
    const target = join(paths.source, 'inbox/conversations', session.id + '.md');
    await mkdir(dirname(target), { recursive: true });
    if (!existsSync(target)) await copyFile(source, target);

    const conversation = await readJson(join(convDir, 'conversation.ceobe.json'), {});
    const lastMessageId = conversation?.linear_message_ids?.at(-1) || 'unknown';
    const hash = await sha256(target);

    if (!manifest.conversations.some(item => item.id === session.id)) {
      manifest.conversations.push({
        id: session.id,
        title: entry.title,
        first: entry.created_at,
        last: entry.updated_at,
        rounds: entry.user_turn_count,
        turns: entry.turn_count,
        last_message_id: lastMessageId,
        source_hash: hash,
        file: 'conversations/' + session.id + '.md',
      });
      done.push(session.short);
    }
  }

  manifest.generated_at = new Date().toISOString();
  await writeJson(manifestPath, manifest);
  return done;
}

/** 机械步骤 2：写 archive-map / ceobe-index / L3 coverage。 */
export async function register(queue, root = projectRoot) {
  const paths = memoryPaths(root);
  const source = paths.source;
  const archiveMapPath = join(source, 'overlay/archive-map.json');
  const archiveMap = await readJson(archiveMapPath);
  const indexPath = join(source, 'ceobe-index.json');
  const index = await readJson(indexPath);
  const manifest = await readJson(join(source, 'inbox/manifest.json'), { conversations: [] });
  const byId = new Map(manifest.conversations.map(item => [item.id, item]));
  const done = [];

  for (const session of queue.sessions) {
    const entry = byId.get(session.id);
    if (!entry) continue;
    const l2Path = join(source, 'inbox/memory', session.id + '.md');
    const l2 = existsSync(l2Path) ? await readFile(l2Path, 'utf8') : '';
    const front = l2.split('---')[1] || '';
    const first = (front.match(/^first:\s*(.+)$/m) || [])[1]?.trim();
    const last = (front.match(/^last:\s*(.+)$/m) || [])[1]?.trim();
    if (first) entry.first = Date.parse(first) / 1000;
    if (last) entry.last = Date.parse(last) / 1000;

    if (!archiveMap.sessions.some(item => item.id === session.id)) {
      archiveMap.sessions.push({
        id: session.id,
        short: session.short,
        title: session.title,
        group: session.group,
        project_label: 'User',
        rounds: entry.rounds,
        l1: { path: `inbox/output/${session.id}.json`, staging: true },
        l2: { path: `inbox/memory/${session.id}.md`, staging: true },
        l4: { path: `inbox/events/${session.id}.json`, staging: true },
        has_upstream: true,
        note: '不在旧语料 input/ 内；L1 + L2 + L4 均已在 inbox/ 补齐',
      });
      done.push(session.short);
    }

    if (!index.sessions.some(item => item.id === session.id)) {
      const sections = [...l2.matchAll(/^##\s+(.+)$/gm)].map(match => match[1].trim());
      index.sessions.push({
        id: session.id,
        short_id: session.short,
        title: session.title,
        group: session.group,
        rounds: entry.rounds,
        authoritative: true,
        staging: true,
        layers: {
          l1: { path: `inbox/output/${session.id}.json`, staging: true },
          l2: { path: `inbox/memory/${session.id}.md`, staging: true, chars: l2.replace(/\s/g, '').length, sections },
          l4: { path: `inbox/events/${session.id}.json`, staging: true },
        },
      });
    }
  }

  // 计数与 L3 coverage 一律从 sessions 重算，避免手改漏项。
  archiveMap.counts.total = archiveMap.sessions.length;
  for (const id of ['gq', 'g1', 'g-early', 'g-oct']) {
    archiveMap.counts[id] = archiveMap.sessions.filter(item => item.group === id).length;
    archiveMap.rounds_by_group[id] = archiveMap.sessions
      .filter(item => item.group === id)
      .reduce((sum, item) => sum + (item.rounds || 0), 0);
  }
  archiveMap.generated_at = new Date().toISOString();

  index.counts.sessions = index.sessions.length;
  index.counts.rounds = index.sessions.reduce((sum, item) => sum + (item.rounds || 0), 0);
  index.counts.l1 = index.sessions.length;
  index.counts.l2 = index.sessions.length;
  index.counts.l4 = index.sessions.length;
  for (const id of ['gq', 'g1', 'g-early', 'g-oct']) {
    index.counts[id] = index.sessions.filter(item => item.group === id).length;
  }
  index.counts.staging = index.sessions.filter(item => item.staging).length;
  if (index.authority) index.authority.sessions = index.sessions.length;
  index.generated_at = new Date().toISOString();

  // L3 / L3.1 / global coverage
  const groupSessions = archiveMap.sessions.filter(item => item.group === group);
  const groupRounds = groupSessions.reduce((sum, item) => sum + (item.rounds || 0), 0);
  const l3Path = join(source, `overlay/l3-${group}.v2.json`);
  const l3 = await readJson(l3Path);
  if (l3?.coverage) {
    l3.coverage.sessions = groupSessions.length;
    l3.coverage.rounds = groupRounds;
    l3.coverage.session_ids = groupSessions.map(item => item.id);
    if (Array.isArray(l3.coverage.evidence_session_ids)) l3.coverage.evidence_session_ids = groupSessions.map(item => item.id);
    await writeJson(l3Path, l3);
  }
  const bankPath = join(source, `overlay/l3.1-${group}.v2.json`);
  const bank = await readJson(bankPath);
  if (bank?.coverage) {
    bank.coverage.sessions = groupSessions.length;
    bank.coverage.rounds = groupRounds;
    await writeJson(bankPath, bank);
  }
  const globalPath = join(source, 'overlay/l3-global.v2.json');
  const globalL3 = await readJson(globalPath);
  if (globalL3?.coverage) {
    const groups = ['gq', 'g1', 'g-early', 'g-oct'];
    const totalSessions = archiveMap.sessions.length;
    const totalRounds = archiveMap.sessions.reduce((sum, item) => sum + (item.rounds || 0), 0);
    globalL3.coverage.sessions = totalSessions;
    globalL3.coverage.rounds = totalRounds;
    globalL3.coverage.session_ids = archiveMap.sessions.map(item => item.id);
    await writeJson(globalPath, globalL3);
  }

  await writeJson(archiveMapPath, archiveMap);
  await writeJson(indexPath, index);
  return done;
}

/** 机械步骤 3：导入 + 构建。 */
function finalize() {
  for (const script of ['memory:import', 'library']) {
    const result = spawnSync('npm', ['run', script], { cwd: projectRoot, stdio: 'inherit', shell: true });
    if (result.status !== 0) {
      console.error(`\n${script} 失败（退出码 ${result.status}）`);
      process.exit(1);
    }
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href;
if (isMain) {
  if (has('--apply')) {
    const queue = await plan();
    if (!queue.sessions.length) {
      console.log('没有新会话；队列为空。');
    } else {
      const staged = await stage(queue);
      const registered = await register(queue);
      console.log(`stage:    ${staged.length} 个会话（${staged.join(', ') || '无'}）`);
      console.log(`register: ${registered.length} 个会话（${registered.join(', ') || '无'}）`);
      console.log('\n剩余判断步骤：');
      for (const session of queue.sessions) {
        for (const task of session.tasks) console.log(`  ${session.short} ${task.id}: ${task.input} → ${task.output}`);
      }
      for (const merge of queue.merges) console.log(`  ${merge.id}: ${merge.input} → ${merge.output}`);
      for (const doc of queue.docs) console.log(`  ${doc.id}: ${doc.note}`);
    }
  } else if (has('--finalize')) {
    finalize();
  } else {
    const queue = await plan();
    await writeJson(queuePath, queue);
    console.log(`队列：${queue.sessions.length} 个新会话 · ${queue.merges.length} 个归并 · ${queue.docs.length} 个文档任务`);
    for (const session of queue.sessions) {
      console.log(`\n${session.short} ${session.title}（${session.group} · ${session.rounds} 轮）`);
      for (const task of session.tasks) console.log(`  ${task.id}: ${task.input} → ${task.output}`);
    }
    for (const merge of queue.merges) console.log(`\n${merge.id}: ${merge.input} → ${merge.output}`);
    for (const doc of queue.docs) console.log(`\n${doc.id}: ${doc.note}`);
    console.log(`\n工单已写入 ${queuePath}`);
  }
}
