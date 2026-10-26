import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localImportMiddleware } from './local-import-api.mjs';
import { createThrottle } from './import-throttle.mjs';

// 限流与熔断在 HTTP 层的表现：429 + stop + Retry-After，以及“熔断后不再调用抓取”。
const shareUrl = 'https://chatgpt.com/share/11111111-1111-4111-8111-111111111111';
const root = await mkdtemp(join('data/private', 'import-throttle-'));
await mkdir(join(root, 'data/private'), { recursive: true });
const servers = [];

async function serve(options) {
  const middleware = localImportMiddleware(root, options);
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('{}'); }));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  servers.push(server);
  return 'http://127.0.0.1:' + server.address().port;
}

const post = (base, body) => fetch(base + '/api/archive-share', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify(body),
}).then(async response => ({ status: response.status, headers: response.headers, body: await response.json() }));

try {
  // 1. 抓取被限流：429 + stop + Retry-After，并且记录停在 capture-failed
  let calls = 0;
  const limited = await serve({
    throttle: createThrottle({ minIntervalMs: 0 }),
    archive: async () => { calls += 1; throw new Error('RATE_LIMITED retryAfter=42'); },
  });
  const first = await post(limited, { url: shareUrl, requestId: '11111111-1111-4111-8111-111111111111' });
  assert.equal(first.status, 429);
  assert.equal(first.body.stop, true);
  assert.equal(first.body.reason, 'rate-limit');
  assert.equal(first.body.retryAfter, 42);
  assert.equal(first.headers.get('retry-after'), '42');
  assert.match(first.body.error, /限流/);
  assert.equal(calls, 1);
  const record = JSON.parse(await readFile(join(root, 'data/private/import-jobs/11111111-1111-4111-8111-111111111111.json'), 'utf8'));
  assert.equal(record.state, 'capture-failed', 'a rate-limited capture must not be marked as captured');
  assert.ok(!record.captured);

  // 2. 熔断：连续被限流 1 次后，闸门直接拒绝，不再调用抓取
  calls = 0;
  const tripped = await serve({
    throttle: createThrottle({ minIntervalMs: 0, maxConsecutiveBlocked: 1 }),
    archive: async () => { calls += 1; throw new Error('RATE_LIMITED retryAfter=60'); },
  });
  const tripping = await post(tripped, { url: shareUrl, requestId: '22222222-2222-4222-8222-222222222222' });
  assert.equal(tripping.status, 429);
  const blocked = await post(tripped, { url: shareUrl, requestId: '33333333-3333-4333-8333-333333333333' });
  assert.equal(blocked.status, 429, 'the second request is rejected by the gate');
  assert.equal(blocked.body.reason, 'rate-limit');
  assert.equal(calls, 1, 'the gate must short-circuit before spawning another capture');

  // 3. 普通失败：不是 429，也不熔断
  calls = 0;
  const failing = await serve({
    throttle: createThrottle({ minIntervalMs: 0 }),
    archive: async () => { calls += 1; throw new Error('fetch failed: ENOTFOUND'); },
  });
  const failed = await post(failing, { url: shareUrl, requestId: '44444444-4444-4444-8444-444444444444' });
  assert.equal(failed.status, 500, 'a plain capture failure keeps the generic 500');
  assert.equal(failed.body.stop, undefined);
  const retry = await post(failing, { url: shareUrl, requestId: '44444444-4444-4444-8444-444444444444' });
  assert.equal(retry.status, 500, 'retrying a failed capture is allowed (same request id resumes)');
  assert.equal(calls, 2);

  // 4. 成功：正常返回，闸门不误伤
  let rebuilt = 0;
  const ok = await serve({
    throttle: createThrottle({ minIntervalMs: 0 }),
    archive: async () => {},
    rebuild: async () => {
      rebuilt += 1;
      await mkdir(join(root, 'archive'), { recursive: true });
      await writeFile(join(root, 'archive/library.ceobe.json'), JSON.stringify({
        kind: 'ceobe.library',
        conversations: [{ id: '11111111-1111-4111-8111-111111111111', title: '限流测试', message_count: 2, turn_count: 1, user_turn_count: 1, assistant_turn_count: 1, resource_counts: {} }],
      }));
    },
  });
  const success = await post(ok, { url: shareUrl, requestId: '55555555-5555-4555-8555-555555555555' });
  assert.equal(success.status, 200);
  assert.equal(success.body.ok, true);
  assert.equal(success.body.title, '限流测试');
  assert.equal(rebuilt, 1);

  console.log('PASS import throttle API: 429 with stop/Retry-After, job stays capture-failed, gate short-circuits after a trip, plain failures keep the generic 500 and stay retryable, success path unaffected.');
} finally {
  for (const server of servers) await new Promise(done => server.close(done));
  await rm(root, { recursive: true, force: true });
}
