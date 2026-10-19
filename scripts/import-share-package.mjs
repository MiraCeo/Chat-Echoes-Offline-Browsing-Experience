/**
 * Import a share capture package produced by the browser extension.
 *
 * The package is a ZIP holding `raw/share.html` and `capture.json` — the raw capture layer, exactly
 * what `archive-share.mjs` writes first. This command unpacks it into
 * `archive/chatgpt-share/<share-id>/<timestamp>/` through the archive guard, then decodes the page with
 * the existing Python importer and writes the Markdown copy, so the result is a normal archive snapshot.
 *
 * Usage:
 *   node scripts/import-share-package.mjs --input <capture.zip>
 */
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { assertSnapshotTarget, planSnapshot } from './archive-guard.mjs';
import { exportConversationMarkdown } from './export-conversation-markdown.mjs';

const projectRoot = resolve(import.meta.dirname, '..');

/** Minimal ZIP reader for STORE entries (the extension writes no compression, no data descriptors). */
export const readZip = bytes => {
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    if (view.getUint32(0, true) !== 0x04034b50) break;
    const method = view.getUint16(8, true);
    const size = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    if (method !== 0) throw new Error(`unsupported zip method ${method} for ${name}`);
    files.set(name, bytes.subarray(start, start + size));
    offset = start + size;
  }
  return files;
};

const shareIdOf = url => {
  const match = /^https:\/\/chatgpt\.com\/share\/([\w-]+)\/?$/.exec(String(url || ''));
  return match ? match[1] : null;
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { values } = parseArgs({ options: { input: { type: 'string' }, 'archive-root': { type: 'string' } } });
  if (!values.input) {
    console.error('Usage: node scripts/import-share-package.mjs --input <capture.zip>');
    process.exitCode = 2;
  } else {
    const zip = readZip(new Uint8Array(await readFile(resolve(values.input))));
    const html = zip.get('raw/share.html');
    const captureBytes = zip.get('capture.json');
    if (!html || !captureBytes) throw new Error('package must contain raw/share.html and capture.json');
    const capture = JSON.parse(new TextDecoder().decode(captureBytes));
    const shareId = shareIdOf(capture.source_url);
    if (!shareId) throw new Error('capture.json has no valid chatgpt.com/share URL');

    const snapshotRoot = resolve(values['archive-root'] || join(projectRoot, 'archive', 'chatgpt-share'));
    await mkdir(snapshotRoot, { recursive: true });
    const plan = planSnapshot({ shareId, capturedAt: capture.captured_at || new Date().toISOString(), snapshotRoot });
    await assertSnapshotTarget(plan.dir, { snapshotRoot });
    await mkdir(join(plan.dir, 'raw'), { recursive: true });
    await writeFile(join(plan.dir, 'raw', 'share.html'), html);
    await writeFile(join(plan.dir, 'capture.json'), `${JSON.stringify(capture, null, 2)}\n`);

    // Decode with the same importer the local pipeline uses.
    const run = spawnSync(process.env.CEOBE_PYTHON || 'python', [
      'scripts/import-chatgpt-share.py', join(plan.dir, 'raw', 'share.html'),
      '--output', join(plan.dir, 'conversation.ceobe.json'), '--source-url', capture.source_url,
    ], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
    if (run.status !== 0) {
      await writeFile(join(plan.dir, 'import-error.txt'), run.stderr || 'import failed').catch(() => {});
      throw new Error(`decode failed; raw page kept at ${plan.dir}: ${run.stderr || run.error}`);
    }
    const conversation = JSON.parse(await readFile(join(plan.dir, 'conversation.ceobe.json'), 'utf8'));
    await writeFile(join(plan.dir, 'conversation.md'), exportConversationMarkdown(conversation));
    await writeFile(join(plan.dir, 'import-report.json'), `${JSON.stringify(conversation.import_report, null, 2)}\n`);

    const counts = { messages: Object.keys(conversation.messages).length, nodes: Object.keys(conversation.nodes).length };
    console.log(`已归档：${plan.dir}`);
    console.log(`消息 ${counts.messages} 条 / 节点 ${counts.nodes} 个；下次运行 npm run library 即可出现在应用里。`);
    const entries = await readdir(plan.dir);
    console.log('文件：' + entries.join('、'));
  }
}
