#!/usr/bin/env node
/**
 * Assemble the model-facing memory profile.
 *
 * The profile is the first thing a model reads when it takes over: who this
 * person is, what they are working on, what is pending, what changed recently,
 * plus the mainlines and the top community reports. This script gathers the
 * material; a clean-context subagent writes the prose.
 *
 *   npm run memory:profile -- --assemble
 *   npm run memory:profile -- --check <path>
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');
const sourceRoot = root => join(root, 'data/private/memory-kernel/source');
const communityRoot = root => join(root, 'data/private/memory-kernel/communities');
const profileRoot = root => join(root, 'data/private/memory-kernel/profile');

const readJson = async (path, fallback = null) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
};

const BLOCK_LABELS = { who: '我是谁', doing: '在手的事', waiting: '等着的事', changes: '近期变化' };

// 认知标签：出处回答「哪来的」，标签回答「这算事实还是推断」。
// L3.1 的 status 只有 current / unresolved / historical，映射到三档。
const EPISTEMIC = { current: 'stated', unresolved: 'unverified', historical: 'stated' };
const EPISTEMIC_LABELS = { stated: '自述', observed: '观察', unverified: '待核实' };

/** Gather L3.1 blocks, L3 mainlines, community reports and L5 open items. */
export async function assembleProfile(root, { group = 'g1', topReports = 12 } = {}) {
  const source = sourceRoot(root);
  const bank = await readJson(join(source, `overlay/l3.1-${group}.v2.json`));
  const l3 = await readJson(join(source, `overlay/l3-${group}.v2.json`));
  const tree = await readJson(join(source, `global/l5-${group}.json`));
  const dir = communityRoot(root);
  const reportFiles = (await readdir(dir).catch(() => []))
    .filter(name => name.startsWith('report-') && !name.startsWith('report-input-') && name.endsWith('.json'));
  const reports = [];
  for (const file of reportFiles) {
    const report = await readJson(join(dir, file));
    if (report?.community) reports.push(report);
  }
  reports.sort((a, b) => (b.rank || 0) - (a.rank || 0));

  const blocks = {};
  for (const key of Object.keys(BLOCK_LABELS)) {
    blocks[key] = {
      label: BLOCK_LABELS[key],
      items: (bank?.blocks?.[key] || []).map(item => ({
        key: item.key,
        text: item.text,
        status: item.status || null,
        epistemic: EPISTEMIC[item.status] || 'stated',
        thread: item.thread_ref || null,
        evidence: (item.evidence || []).map(evidence => `${String(evidence.session_id).slice(0, 8)} 第 ${evidence.rounds?.[0]}–${evidence.rounds?.[1]} 轮`),
      })),
    };
  }

  const mainlines = (l3?.threads || []).filter(thread => thread.mainline).map(thread => ({
    id: thread.id,
    label: thread.label,
    status: thread.status || null,
    scope_refs: thread.scope_refs || [],
  }));

  return {
    schema: 'ceobe.memory-profile-input/1',
    group,
    as_of: bank?.as_of || null,
    coverage: bank?.coverage || null,
    blocks,
    mainlines,
    open: (tree?.open || []).slice(0, 20),
    reports: reports.slice(0, topReports).map(report => ({
      community: report.community,
      title: report.title,
      summary: report.summary,
      findings: report.findings || [],
      boundary: report.boundary || null,
      epistemic: 'observed',
      rank: report.rank ?? null,
    })),
    report_count: reports.length,
    epistemic_labels: EPISTEMIC_LABELS,
  };
}

/** Structural check for the generated markdown. */
export function checkProfile(markdown) {
  const issues = [];
  for (const label of Object.values(BLOCK_LABELS)) {
    if (!markdown.includes(`## ${label}`)) issues.push(`缺少「${label}」小节`);
  }
  if (!markdown.includes('## 当前主线')) issues.push('缺少「当前主线」小节');
  if (!markdown.includes('## 未决清单')) issues.push('缺少「未决清单」小节');
  if (!markdown.includes('## 不要擅自补全')) issues.push('缺少「不要擅自补全」小节');
  if (!markdown.includes('## 短版')) issues.push('缺少「短版」小节');
  if (!/出处[:：]/.test(markdown)) issues.push('没有任何出处标注');
  if (!/\[(自述|观察|待核实)\]/.test(markdown)) issues.push('没有任何认知标签（[自述]/[观察]/[待核实]）');
  if (!/范围[:：]/.test(markdown)) issues.push('缺少范围声明');
  if (!/维护[:：]/.test(markdown)) issues.push('缺少维护规则');
  if (markdown.length < 400) issues.push('正文过短（<400 字）');
  return issues;
}

/** Pull the copy-paste brief out of the profile. */
export function extractBrief(markdown) {
  const match = markdown.match(/## 短版[^\n]*\n([\s\S]*?)(?=\n## |$)/);
  return match ? match[1].trim() : '';
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const option = name => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const has = name => process.argv.includes(name);
  const root = resolve(option('--root') || projectRoot);

  if (has('--check')) {
    const path = resolve(option('--check'));
    if (!existsSync(path)) {
      console.error(`找不到 profile：${path}`);
      process.exit(1);
    }
    const markdown = await readFile(path, 'utf8');
    const issues = checkProfile(markdown);
    if (issues.length) {
      console.error(`profile 检查未通过：\n- ${issues.join('\n- ')}`);
      process.exit(1);
    }
    const brief = extractBrief(markdown);
    if (!brief) {
      console.error('profile 检查未通过：\n- 「短版」小节为空');
      process.exit(1);
    }
    const briefPath = join(dirname(path), 'memory-brief.md');
    await writeFile(briefPath, brief + '\n', 'utf8');
    console.log(`PASS memory profile: 四个小节、当前主线、未决清单、不要擅自补全、短版、出处与认知标签齐全`);
    console.log(`已写入 ${briefPath}（${brief.length} 字）`);
  } else {
    const group = option('--group') || 'g1';
    const input = await assembleProfile(root, { group, topReports: Number(option('--top') || 12) });
    const dir = profileRoot(root);
    await mkdir(dir, { recursive: true });
    const out = join(dir, 'profile-input.json');
    await writeFile(out, JSON.stringify(input, null, 2) + '\n', 'utf8');
    console.log(`profile 输入（${group} · 截至 ${input.as_of}）`);
    console.log(`  四块 ${Object.values(input.blocks).reduce((sum, block) => sum + block.items.length, 0)} 条 · 主线 ${input.mainlines.length} 条 · 社区报告 ${input.report_count} 份（取前 ${input.reports.length}）· 未决 ${input.open.length} 条`);
    console.log(`已写入 ${out}`);
  }
}
