import assert from 'node:assert/strict';
import { DEFAULT_THROTTLE_POLICY, createThrottle, parseRetryAfter } from './import-throttle.mjs';

// 限流策略本身是纯逻辑：用可控时钟与 sleep 验证，不真的等待。
const runs = [];
const harness = (policy = {}) => {
  let time = 0;
  const sleeps = [];
  return {
    throttle: createThrottle(policy, { now: () => time, sleep: async ms => { sleeps.push(ms); time += ms; } }),
    advance: ms => { time += ms; },
    sleeps,
    get time() { return time; },
  };
};

// 1. Retry-After：秒数 / HTTP 日期 / 垃圾值
assert.equal(parseRetryAfter('42'), 42);
assert.equal(parseRetryAfter(' 7 '), 7);
assert.equal(parseRetryAfter(''), 0);
assert.equal(parseRetryAfter('not-a-number'), 0);
assert.equal(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', Date.parse('Wed, 21 Oct 2026 07:27:00 GMT')), 60);
assert.equal(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', Date.parse('Wed, 21 Oct 2026 07:29:00 GMT')), 0);

// 2. 最小间隔：第一次不等待，第二次要等到 lastStart + minInterval
{
  const h = harness({ minIntervalMs: 1000, restEvery: 99, maxAttempts: 99 });
  assert.equal(await h.throttle.beforeRequest(), null);
  assert.deepEqual(h.sleeps, []);
  h.advance(300);
  await h.throttle.beforeRequest();
  assert.deepEqual(h.sleeps, [700], 'second request waits out the remaining interval');
  h.advance(1000);
  await h.throttle.beforeRequest();
  assert.deepEqual(h.sleeps, [700], 'no wait when the interval already passed');
}

// 3. 每 N 条休息一次
{
  const h = harness({ minIntervalMs: 0, restEvery: 3, restMs: 5000, maxAttempts: 99 });
  for (let index = 0; index < 3; index += 1) await h.throttle.beforeRequest();
  assert.deepEqual(h.sleeps, [], 'first batch does not rest');
  await h.throttle.beforeRequest();
  assert.deepEqual(h.sleeps, [5000], 'the 4th request rests');
  assert.equal(h.throttle.snapshot.sinceRest, 1, 'counter resets after the rest');
}

// 4. 最多尝试次数
{
  const h = harness({ maxAttempts: 2, minIntervalMs: 0 });
  assert.equal(await h.throttle.beforeRequest(), null);
  assert.equal(await h.throttle.beforeRequest(), null);
  const stop = await h.throttle.beforeRequest();
  assert.equal(stop?.stop, true);
  assert.equal(stop.reason, 'max-attempts');
  assert.equal((await h.throttle.beforeRequest()).reason, 'max-attempts', 'stays stopped');
}

// 5. 连续被限流 → 停，并带上 Retry-After
{
  const h = harness({ maxConsecutiveBlocked: 2, minIntervalMs: 0 });
  assert.equal(h.throttle.afterResponse({ status: 429, retryAfterSeconds: 30 }), null);
  assert.equal(h.throttle.afterResponse({ status: 200 }), null, 'a success resets the streak');
  assert.equal(h.throttle.afterResponse({ status: 429 }), null);
  const stop = h.throttle.afterResponse({ status: 503, retryAfterSeconds: 45 });
  assert.equal(stop?.reason, 'rate-limit');
  assert.equal(stop.retryAfterMs, 45000);
  assert.equal((await h.throttle.beforeRequest()).stop, true, 'beforeRequest reports the stop');
}

// 6. 失败率熔断（只看最近 N 条）
{
  const h = harness({ failureWindow: 4, failureRatio: 0.5, minIntervalMs: 0 });
  assert.equal(h.throttle.afterResponse({ status: 500 }), null);
  assert.equal(h.throttle.afterResponse({ status: 200 }), null);
  h.throttle.afterResponse({ status: 200 });
  const stop = h.throttle.afterResponse({ status: 500 });
  assert.equal(stop?.reason, 'failure-ratio');
  assert.equal(stop.failed, 2);
  assert.equal(stop.total, 4);
}

// 7. 失败率不会因为窗口未满就触发；成功够多时也不会触发
{
  const h = harness({ failureWindow: 5, failureRatio: 0.6, minIntervalMs: 0 });
  for (const status of [500, 500, 200]) assert.equal(h.throttle.afterResponse({ status }), null);
  for (const status of [200, 200]) assert.equal(h.throttle.afterResponse({ status }), null);
  assert.equal((await h.throttle.beforeRequest())?.stop, undefined);
}

// 8. 300/400 不算限流，但算失败
{
  const h = harness({ maxConsecutiveBlocked: 1, failureWindow: 2, failureRatio: 0.9, minIntervalMs: 0 });
  assert.equal(h.throttle.afterResponse({ status: 404 }), null, '404 is a failure, not a block');
  assert.equal(h.throttle.snapshot.consecutiveBlocked, 0);
}

// 9. reset 之后可以重新开始
{
  const h = harness({ maxAttempts: 1, minIntervalMs: 0 });
  await h.throttle.beforeRequest();
  assert.equal((await h.throttle.beforeRequest()).reason, 'max-attempts');
  h.throttle.reset();
  assert.equal(await h.throttle.beforeRequest(), null);
}

// 10. 默认策略覆盖了 inkstone 那几条保护
assert.ok(DEFAULT_THROTTLE_POLICY.minIntervalMs > 0);
assert.ok(DEFAULT_THROTTLE_POLICY.restEvery > 0 && DEFAULT_THROTTLE_POLICY.restMs > 0);
assert.ok(DEFAULT_THROTTLE_POLICY.maxAttempts >= 100);
assert.ok(DEFAULT_THROTTLE_POLICY.maxConsecutiveBlocked >= 2);
assert.ok(DEFAULT_THROTTLE_POLICY.failureRatio > 0 && DEFAULT_THROTTLE_POLICY.failureRatio <= 1);

console.log('PASS import throttle: interval, periodic rest, attempt cap, consecutive 429/503 stop with Retry-After, failure-ratio breaker, 404 not treated as a block, reset.');
