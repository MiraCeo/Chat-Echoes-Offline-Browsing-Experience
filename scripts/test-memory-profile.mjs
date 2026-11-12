import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleProfile, checkProfile } from './memory-profile.mjs';

const root = await mkdtemp(join(tmpdir(), 'ceobe-memory-profile-'));
const source = join(root, 'data/private/memory-kernel/source');
const communities = join(root, 'data/private/memory-kernel/communities');
const write = async (path, text) => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text, 'utf8');
};

try {
  await write(join(source, 'overlay/l3.1-g1.v2.json'), JSON.stringify({
    as_of: '2026-10-28',
    coverage: { sessions: 7, rounds: 400 },
    blocks: {
      who: [{ key: '身份', text: '本科大三', thread_ref: 'yj-intern', status: 'current', evidence: [{ session_id: 'aaaaaaaa-0000', rounds: [1, 7] }] }],
      doing: [{ key: '项目', text: '在做一个项目', thread_ref: null, status: 'current', evidence: [] }],
      waiting: [],
      changes: [],
    },
  }));
  await write(join(source, 'overlay/l3-g1.v2.json'), JSON.stringify({
    threads: [
      { id: 'tourgrid', label: 'TourGrid', mainline: true, status: 'active', scope_refs: ['g1'] },
      { id: 'other', label: '其他', mainline: false },
    ],
  }));
  await write(join(source, 'global/l5-g1.json'), JSON.stringify({ open: ['未决一', '未决二'] }));
  await write(join(communities, 'report-a.json'), JSON.stringify({
    community: 'tourgrid-01', title: '标题一', summary: '摘要一', findings: ['要点一'], rank: 0.9,
  }));
  await write(join(communities, 'report-b.json'), JSON.stringify({
    community: 'tourgrid-02', title: '标题二', summary: '摘要二', findings: ['要点二'], rank: 0.5,
  }));
  // report-input-* must not be treated as a report.
  await write(join(communities, 'report-input-tourgrid-01.json'), JSON.stringify({ community: { id: 'x' } }));

  const input = await assembleProfile(root, { group: 'g1' });
  assert.equal(input.schema, 'ceobe.memory-profile-input/1');
  assert.equal(input.as_of, '2026-10-28');
  assert.equal(input.blocks.who.items.length, 1);
  assert.equal(input.blocks.who.items[0].evidence[0], 'aaaaaaaa 第 1–7 轮');
  assert.equal(input.mainlines.length, 1, '只保留主线');
  assert.equal(input.open.length, 2);
  assert.equal(input.report_count, 2, 'report-input-* 不算报告');
  assert.deepEqual(input.reports.map(report => report.community), ['tourgrid-01', 'tourgrid-02'], '按 rank 排序');
  assert.equal(input.blocks.who.items[0].epistemic, 'stated', 'current 映射为自述');
  assert.equal(input.reports[0].epistemic, 'observed', '社区报告是观察');
  assert.equal(input.epistemic_labels.stated, '自述');

  const good = [
    '# 记忆档案',
    '> 范围：不是完整复刻。',
    '> 维护：追加更新记录，不覆盖旧事件。',
    '## 我是谁', '- [自述] 甲（出处：aaaaaaaa 第 1–7 轮）',
    '## 在手的事', '- [自述] 乙（出处：aaaaaaaa 第 1–7 轮）',
    '## 等着的事', '- [待核实] 丙（出处：aaaaaaaa 第 1–7 轮）',
    '## 近期变化', '- [自述] 丁（出处：aaaaaaaa 第 1–7 轮）',
    '## 当前主线', '- TourGrid',
    '## 未决清单', '- [待核实] 未决一',
    '## 不要擅自补全', '- [待核实] 不要把等待认定为失败',
    '## 短版', '> 一段可直接复制的背景。',
    'x'.repeat(400),
  ].join('\n');
  assert.deepEqual(checkProfile(good), []);

  const bad = '# 记忆档案\n## 我是谁\n- 甲\n';
  const issues = checkProfile(bad);
  assert.ok(issues.some(issue => issue.includes('在手的事')));
  assert.ok(issues.some(issue => issue.includes('出处')));
  assert.ok(issues.some(issue => issue.includes('过短')));

  console.log('PASS memory profile: block assembly, mainline filter, report ranking, structural check');
} finally {
  await rm(root, { recursive: true, force: true });
}
