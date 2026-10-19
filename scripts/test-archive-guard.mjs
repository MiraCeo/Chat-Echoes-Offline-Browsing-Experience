import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  assertSnapshotTarget,
  formatSnapshotPlan,
  planSnapshot,
  snapshotRootOf,
} from './archive-guard.mjs';

// archive/ is append-only: captures add snapshots, nothing overwrites them. The guard reasons about
// paths, so it can run before a single byte is written.
const workspace = await mkdtemp(join(tmpdir(), 'ceobe-archive-'));
const root = join(workspace, 'archive', 'chatgpt-share');
await mkdir(root, { recursive: true });
const shareId = '6ad4e7d4-97f4-83ec-99de-5cb2b12c18e4';

try {
  assert.equal(snapshotRootOf(workspace), root, 'the snapshot root is derived from the project root');

  // A fresh target is accepted, and the plan says exactly what a dry run would write.
  const plan = planSnapshot({ shareId, capturedAt: '2026-10-19T01:02:03.456Z', snapshotRoot: root });
  assert.equal(plan.dir, join(root, shareId, '2026-10-19T01-02-03.456Z'));
  for (const file of ['raw/share.html', 'conversation.ceobe.json', 'import-report.json']) assert.ok(plan.files.includes(file));
  const printed = formatSnapshotPlan(plan);
  assert.ok(printed.includes(plan.dir) && printed.includes('raw/share.html'), 'the dry run lists the target and the files');
  const accepted = await assertSnapshotTarget(plan.dir, { snapshotRoot: root });
  assert.equal(accepted.relativePath, join(shareId, plan.stamp));

  // Invalid ids and timestamps never reach the filesystem.
  assert.throws(() => planSnapshot({ shareId: '../escape', capturedAt: new Date().toISOString(), snapshotRoot: root }), /无效的会话 ID/);
  assert.throws(() => planSnapshot({ shareId, capturedAt: '2026-10-19 01:02', snapshotRoot: root }), /无效的抓取时间戳/);
  assert.throws(() => planSnapshot({ shareId: '', capturedAt: new Date().toISOString(), snapshotRoot: root }), /无效的会话 ID/);

  // Paths outside the archive, the archive root itself and wrong depths are refused.
  await assert.rejects(() => assertSnapshotTarget(join(workspace, 'elsewhere', shareId, 'stamp'), { snapshotRoot: root }), /之内/);
  await assert.rejects(() => assertSnapshotTarget(root, { snapshotRoot: root }), /之内/);
  await assert.rejects(() => assertSnapshotTarget(join(root, shareId), { snapshotRoot: root }), /两层目录/);
  await assert.rejects(() => assertSnapshotTarget(join(root, shareId, 'stamp', 'extra'), { snapshotRoot: root }), /两层目录/);
  await assert.rejects(() => assertSnapshotTarget(resolve(root, '..', '..', 'archive-guard-escape'), { snapshotRoot: root }), /之内/);

  // An existing snapshot is never overwritten, whether it is empty or already has content.
  const existing = join(root, shareId, '2026-10-18T00-00-00.000Z');
  await mkdir(existing, { recursive: true });
  await writeFile(join(existing, 'capture.json'), '{}', 'utf8');
  await assert.rejects(() => assertSnapshotTarget(existing, { snapshotRoot: root }), /拒绝覆盖/);
  const emptyDir = join(root, shareId, '2026-10-17T00-00-00.000Z');
  await mkdir(emptyDir, { recursive: true });
  await assertSnapshotTarget(emptyDir, { snapshotRoot: root });

  // A link inside the archive cannot redirect a write outside it.
  const outside = join(workspace, 'outside-target');
  await mkdir(outside, { recursive: true });
  const linked = join(root, 'linked-share');
  try {
    await symlink(outside, linked, 'junction');
    const viaLink = join(linked, '2026-10-19T02-00-00.000Z');
    await assert.rejects(() => assertSnapshotTarget(viaLink, { snapshotRoot: root }), /符号链接|之内/);
  } catch (error) {
    if (!['EPERM', 'EACCES', 'EEXIST'].includes(error.code)) throw error;
  }

  // The capture path actually uses the guard; a missing call would silently reintroduce overwrites.
  const archiveShare = await readFile(resolve('scripts/archive-share.mjs'), 'utf8');
  assert.ok(archiveShare.includes('assertSnapshotTarget'), 'archive-share.mjs must call the guard before writing');
  assert.ok(archiveShare.includes('formatSnapshotPlan'), 'archive-share.mjs must print the dry-run plan');
  const importApi = await readFile(resolve('scripts/local-import-api.mjs'), 'utf8');
  assert.ok(importApi.includes('archive-share.mjs'), 'the local import path archives through archive-share.mjs, so it inherits the guard');
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log('Archive guard: dry-run plan, containment, depth, overwrite refusal, link escape and capture-path wiring verified.');
