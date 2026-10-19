import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { assertSnapshotTarget, formatSnapshotPlan, planSnapshot } from './archive-guard.mjs';
import { convertWebCapture } from './convert-web-capture.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: { input: { type: 'string' }, 'captured-at': { type: 'string' } } });
if (!values.input) {
  console.error('Usage: node scripts/import-web-capture.mjs --input <capture.json> [--captured-at ISO]');
  process.exitCode = 2;
} else {
  const input = resolve(values.input);
  const payload = JSON.parse(await readFile(input, 'utf8'));
  const capturedAt = values['captured-at'] || new Date().toISOString();
  const conversation = convertWebCapture(payload, { capturedAt });
  const snapshotRoot = join(projectRoot, 'archive', 'chatgpt-web');
  await mkdir(snapshotRoot, { recursive: true });
  const plan = planSnapshot({ shareId: conversation.id, capturedAt, snapshotRoot });
  await assertSnapshotTarget(plan.dir, { snapshotRoot });
  console.log(formatSnapshotPlan(plan));
  await mkdir(plan.dir, { recursive: true });
  await cp(input, join(plan.dir, 'raw-responses.json'));
  await writeFile(join(plan.dir, 'conversation.ceobe.json'), JSON.stringify(conversation, null, 2) + '\n', 'utf8');
  await writeFile(join(plan.dir, 'capture.json'), JSON.stringify({
    source_url: conversation.source.url || null,
    captured_at: capturedAt,
    method: 'extension-response-capture',
    conversation_id: conversation.id,
    sha256: conversation.source.sha256,
    scope: 'Signed-in web session capture. Linear messages only: no branch tree, attachments not yet downloaded.',
  }, null, 2) + '\n', 'utf8');
  console.log(`Archived: ${plan.dir}`);
  console.log(`messages: ${Object.keys(conversation.messages).length}`);
}
