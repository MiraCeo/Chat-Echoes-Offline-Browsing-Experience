#!/usr/bin/env node
/**
 * Describe images with the modlens vision bridge and store the results.
 *
 * The sidecar is keyed by the asset sha256 (the archived filename), so a rerun
 * only processes new images. Each entry keeps the full summary and OCR text;
 * the build truncates them for display and search.
 *
 *   npm run memory:describe-images -- --input data/private/memory-kernel/image-descriptions-input.json
 *   --out data/private/memory-kernel/image-descriptions.json
 *   --concurrency 2
 *   --limit 20
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');
// ASCII prompt: on Windows the CLI is spawned through a shell, and a Chinese
// argument gets mangled by the shell's code page. The model still reads the
// Chinese text in the image.
const PROMPT = 'This is a screenshot the user pasted into a chat with an AI. Describe: 1) what interface or content it is; 2) the readable text in the image; 3) what it might be trying to show.';

const readJson = async (path, fallback = null) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
};

/** sha256 is the archived filename without its extension. */
export const shaOf = path => basename(String(path)).replace(/\.[a-z0-9]+$/i, '');

/** Run a command with a hard timeout; kills the whole tree on Windows. */
function run(command, args, timeout) {
  return new Promise(resolvePromise => {
    const child = spawn(command, args, { shell: process.platform === 'win32', windowsHide: true });
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(value);
    };
    const timer = setTimeout(() => {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
      finish(null);
    }, timeout);
    child.on('close', code => finish(code));
    child.on('error', () => finish(null));
  });
}

/** Run modlens on one image; returns the parsed evidence or null. */
export async function describeImage(path, { timeout = 90000, tmpDir } = {}) {
  const out = join(tmpDir, `${shaOf(path)}.json`);
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  // shell:true concatenates args without quoting, so quote every value that
  // may contain spaces (the prompt always does).
  const quote = value => `"${String(value).replaceAll('"', '\\"')}"`;
  const args = ['@liustack/modlens', 'analyze', '-i', quote(path), '-o', quote(out), '--prompt', quote(PROMPT)];
  const code = await run(command, args, timeout);
  if (code !== 0 && !existsSync(out)) return null;
  try { return JSON.parse(readFileSync(out, 'utf8'))?.result || null; }
  catch { return null; }
}

export function compact(evidence, { name, session }) {
  if (!evidence) return null;
  return {
    name,
    session: session || null,
    summary: String(evidence.summary || '').trim(),
    ocr: String(evidence.ocr?.full_text || '').trim(),
    entities: (evidence.semantics?.entities || []).map(entity => entity.name).filter(Boolean).slice(0, 20),
    uncertainty: (evidence.uncertainty || []).slice(0, 5),
    at: new Date().toISOString(),
  };
}

/** Atomic write: a crash mid-write must not truncate the sidecar. */
async function writeSidecar(path, sidecar) {
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(sidecar, null, 2) + '\n', 'utf8');
  await rename(temp, path);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const option = name => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const root = resolve(option('--root') || projectRoot);
  const input = resolve(option('--input') || join(root, 'data/private/memory-kernel/image-descriptions-input.json'));
  const out = resolve(option('--out') || join(root, 'data/private/memory-kernel/image-descriptions.json'));
  const concurrency = Math.max(1, Number(option('--concurrency') || 2));
  const limit = Number(option('--limit') || 0);
  const tmpDir = join(dirname(out), '_modlens');
  await mkdir(tmpDir, { recursive: true });

  const list = JSON.parse(await readFile(input, 'utf8'));
  const sidecar = await readJson(out, { schema: 'ceobe.image-descriptions/1', images: {} });
  const pending = list.filter(item => !sidecar.images[shaOf(item.path)]);
  const queue = limit ? pending.slice(0, limit) : pending;
  console.log(`待描述 ${queue.length} 张（已有 ${Object.keys(sidecar.images).length} 张）`);

  let done = 0;
  let failed = 0;
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      const evidence = await describeImage(item.path, { tmpDir });
      const entry = compact(evidence, item);
      if (entry) sidecar.images[shaOf(item.path)] = entry;
      else failed += 1;
      done += 1;
      await writeSidecar(out, sidecar);
      console.log(`  ${done}/${done + queue.length}（失败 ${failed}）`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  await writeSidecar(out, sidecar);
  console.log(`完成：${Object.keys(sidecar.images).length} 张，失败 ${failed} 张`);
  console.log(`已写入 ${out}`);
}
