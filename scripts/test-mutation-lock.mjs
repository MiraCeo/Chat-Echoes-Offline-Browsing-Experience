// 工作区锁：持有进程死掉后不能把工作区永久卡住，但活着的持有者必须继续挡住写入。
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, utimes, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireMutation } from './workspace-mutation.mjs';

const root = await mkdtemp(join(tmpdir(), 'ceobe-lock-'));
const lockPath = join(root, 'data/private/mutation.lock');
await mkdir(join(root, 'data/private'), { recursive: true });

const expect409 = async (label, pattern) => {
  await assert.rejects(acquireMutation(root), error => {
    assert.equal(error.status, 409, `${label} 应返回 409`);
    if (pattern) assert.match(error.message, pattern);
    return true;
  }, label);
};

// 1. 死进程留下的锁：自动清理并接管。
await writeFile(lockPath, JSON.stringify({ pid: 999999, started_at: new Date().toISOString() }));
const release = await acquireMutation(root);
const owned = JSON.parse(await readFile(lockPath, 'utf8'));
assert.equal(owned.pid, process.pid, '接管后锁归当前进程');
await release();

// 2. 持有者还活着：必须拒绝。
await writeFile(lockPath, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
await expect409('活进程持锁', /工作区正在写入/);
await rm(lockPath);

// 3. 空文件但很旧（写入前崩溃）：视为遗留。
await writeFile(lockPath, '');
const old = Date.now() / 1000 - 120;
await utimes(lockPath, old, old);
const release2 = await acquireMutation(root);
await release2();

// 4. 空文件但是刚刚创建（可能正在写）：不能抢。
await writeFile(lockPath, '');
await expect409('刚创建的空锁');
await rm(lockPath);

// 5. 未完成的删除任务优先拦截。
await mkdir(join(root, 'data/private/delete-jobs/job-1'), { recursive: true });
await expect409('存在删除任务', /删除任务/);
await rm(join(root, 'data/private/delete-jobs'), { recursive: true });

await rm(root, { recursive: true, force: true });
console.log('工作区锁: 死进程遗留锁可接管、活进程与新建空锁拒绝、旧空锁按遗留处理、删除任务优先拦截。');
