#!/usr/bin/env node
/**
 * 更新队列：把「加一个会话」拆成机械步骤和判断步骤。
 *
 *   npm run memory:queue               # 检测 + 生成工单（只读，不写内核）
 *   npm run memory:queue -- --apply    # 执行机械步骤（stage + register）
 *   npm run memory:queue -- --prompts  # 把判断步骤写成可直接派发的提示词
 *   npm run memory:queue -- --verify   # 检查判断步骤的产物是否齐全、是否过校验器
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

const PROMPT_DIR = join(projectRoot, 'data/private/memory-kernel/queue-prompts');

const LAYER_RULES = {
  l1: '- 严格按提示词和 schema；summary ≤160 字、tags 3–6 个、status 用 fresh；\n- source.last_message_id 和 source_hash 从会话原文取；原文没有 frontmatter 时用 unknown 和该 md 的真实 SHA-256。',
  l2: '- 严格按提示词分节，只写原文里有的内容；\n- frontmatter 要有 id / title / first / last / rounds / turns / last_message_id / source_hash / generated_at / generator。',
  l4: '- L2 定路径，原文定全集；\n- 动态上限：core ≤ 12、supporting ≤ 2 × core、optional 不进 L4；\n- 节点字段 n/t/s/w/r/x/e，边 [from,to,rel]，superseded 从被推翻者指向推翻者。',
};
const LAYER_LABELS = { l1: 'L1 索引摘要', l2: 'L2 记忆文档', l4: 'L4 事件树' };

/** 把判断步骤写成可直接派发的提示词。 */
export async function prompts(queue, root = projectRoot) {
  const source = join(root, 'data/private/memory-kernel/source');
  const dir = join(root, 'data/private/memory-kernel/queue-prompts');
  await mkdir(dir, { recursive: true });
  const written = [];

  for (const session of queue.sessions) {
    for (const task of session.tasks) {
      const label = LAYER_LABELS[task.id];
      const text = `你是 CEOBE 记忆内核的 ${label} 生成员。为一个新会话生成 ${label}。

## 输入
- 会话原文：${join(source, 'inbox/conversations', session.id + '.md')}
- 提示词：${join(source, task.prompt)}
- 校验器：${join(source, task.validator)}

## 输出
${join(source, task.output)}

## 要求
${LAYER_RULES[task.id]}

写完后跑校验器，把结果贴出来。只读上面列的文件，不要读其他会话的同层产物（避免照抄）。
`;
      const path = join(dir, `${session.short}-${task.id}.md`);
      await writeFile(path, text, 'utf8');
      written.push(path);
    }
  }

  for (const merge of queue.merges) {
    const list = queue.sessions.map(item => `  - ${item.short} ${item.title}：inbox/events/${item.id}.json`).join('\n');
    const text = `你是 CEOBE 记忆内核的 L5 归并员。把新会话的 L4 并入 ${merge.input}。

## 输入
- L5 提示词：${join(source, 'PROMPT-L5.md')}
- 现有树：${join(source, merge.input)}
- 新会话 L4：
${list}
- 校验器：${join(source, 'validate-tree.mjs')}

## 输出
${join(source, merge.output)}（先备份到同目录的 .pre-merge-<时间戳>.json）

## 要求
- 保留现有节点的编号和内容，新节点从最大编号 +1 开始；
- 同一件事的节点合并（src 并集、重要度取最高），否则新增；
- 新会话推翻旧判断的，加 superseded 边（从被推翻者指向推翻者）；
- 节点字段 n/t/s/w/thread/x/e/src，边 [from,to,rel]；
- 写完后跑 node validate-tree.mjs --tree ${merge.output} --events inbox/events,events-v3，把结果贴出来。
`;
    const path = join(dir, `${merge.id}.md`);
    await writeFile(path, text, 'utf8');
    written.push(path);
  }

  for (const doc of queue.docs) {
    const text = doc.id === 'threads'
      ? `你是 CEOBE 记忆内核的分册维护员。把新会话补进受影响的分册。

## 输入
- 分册目录：${join(source, 'global/threads')}
- 新会话 L2：${queue.sessions.map(item => `inbox/memory/${item.id}.md`).join('、')}
- 校验器：${join(source, 'validate-thread.mjs')}

## 要求
- 只改受影响的分册，不硬塞；
- 时间轴追加条目、判断演变加节、当前状态更新、证据索引补行；
- 只写原文里有的内容；
- 写完后对每个改过的分册跑 validate-thread.mjs，把结果贴出来。
`
      : `你是 CEOBE 记忆内核的 profile 维护员。重写一页纸记忆档案。

## 输入
- 先跑：npm run memory:profile -- --assemble（生成 profile-input.json）
- 现有 profile：${join(source, 'profile/memory-profile.md')}
- 校验器：npm run memory:profile -- --check <path>

## 要求
- 保留「我是谁 / 在手的事 / 等着的事 / 近期变化 / 当前主线 / 未决清单 / 不要擅自补全 / 短版」结构；
- 每条带出处，带 [自述] / [观察] / [待核实] 标签；
- 写完后跑 --check，把结果贴出来。
`;
    const path = join(dir, `${doc.id}.md`);
    await writeFile(path, text, 'utf8');
    written.push(path);
  }

  return written;
}

/** 检查判断步骤的产物是否齐全、是否过校验器。 */
export async function verify(queue, root = projectRoot) {
  const source = join(root, 'data/private/memory-kernel/source');
  const missing = [];
  const passed = [];
  const failed = [];

  for (const session of queue.sessions) {
    for (const task of session.tasks) {
      const output = join(source, task.output);
      if (!existsSync(output)) { missing.push(`${session.short} ${task.id}`); continue; }
      const result = spawnSync(process.execPath, [join(source, task.validator), ...validatorArgs(task, output)], { cwd: source, encoding: 'utf8' });
      if (result.status === 0) passed.push(`${session.short} ${task.id}`);
      else failed.push(`${session.short} ${task.id}: ${(result.stdout || result.stderr || '').trim().split('\n').slice(-2).join(' ')}`);
    }
  }

  for (const merge of queue.merges) {
    const output = join(source, merge.output);
    if (!existsSync(output)) { missing.push(merge.id); continue; }
    passed.push(merge.id);
  }

  return { missing, passed, failed };
}

function validatorArgs(task, output) {
  if (task.id === 'l1') return ['--input', 'inbox', '--output', 'inbox/output'];
  if (task.id === 'l2') return ['--input', 'inbox', '--memory', 'inbox/memory'];
  return ['--input', 'inbox', '--events', 'inbox/events'];
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
  } else if (has('--prompts')) {
    const queue = await plan();
    const written = await prompts(queue);
    console.log(`已生成 ${written.length} 份提示词：`);
    for (const path of written) console.log(`  ${path}`);
  } else if (has('--verify')) {
    const queue = await plan();
    const result = await verify(queue);
    if (result.missing.length) console.log(`缺产物：${result.missing.join('、')}`);
    if (result.failed.length) { console.log('校验失败：'); for (const item of result.failed) console.log(`  ${item}`); }
    console.log(`通过 ${result.passed.length} 项${result.missing.length || result.failed.length ? '，仍有待办' : '，全部完成'}`);
    if (result.missing.length || result.failed.length) process.exitCode = 1;
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
