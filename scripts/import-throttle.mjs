// 批量抓取的限流与熔断：参考 inkstone 的保守策略，但按 CEOBE 的“一次一条、服务端串行”来落地。
// 只做判断与等待，不碰网络；调用方负责在请求前调用 beforeRequest()、拿到结果后调用 afterResponse()。

export const DEFAULT_THROTTLE_POLICY = {
  minIntervalMs: 1500,        // 两次抓取之间至少间隔
  restEvery: 40,              // 连续抓这么多条后强制休息
  restMs: 30_000,             // 休息时长
  maxAttempts: 1000,          // 一个进程/批次最多尝试次数
  maxConsecutiveBlocked: 3,   // 连续被限流（429/503）这么多次就停
  failureWindow: 10,          // 失败率只看最近 N 条
  failureRatio: 0.6,          // 最近 N 条失败率达到这个比例就停
};

// Retry-After 既可能是秒数，也可能是 HTTP 日期；解析不出来按 0 处理。
export function parseRetryAfter(value, now = Date.now()) {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.max(0, Math.round(Number(text)));
  const date = Date.parse(text);
  if (Number.isNaN(date)) return 0;
  return Math.max(0, Math.round((date - now) / 1000));
}

const blockedStatus = status => status === 429 || status === 503;

export function createThrottle(policy = {}, { now = () => Date.now(), sleep = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  const config = { ...DEFAULT_THROTTLE_POLICY, ...policy };
  let attempts = 0;
  let sinceRest = 0;
  let consecutiveBlocked = 0;
  let lastStart = null;
  let stopped = null;
  const window = [];

  const stop = reason => (stopped = { stop: true, reason });

  return {
    config,
    get stopped() { return stopped; },
    get snapshot() {
      return { attempts, sinceRest, consecutiveBlocked, window: [...window], stopped };
    },
    // 返回 null 表示可以继续；返回 {stop:true,...} 表示这一批应该停下。
    async beforeRequest() {
      if (stopped) return stopped;
      if (attempts >= config.maxAttempts) return stop('max-attempts');
      let wait = lastStart === null ? 0 : Math.max(0, lastStart + config.minIntervalMs - now());
      if (sinceRest >= config.restEvery) wait = Math.max(wait, config.restMs);
      if (wait > 0) await sleep(wait);
      if (sinceRest >= config.restEvery) sinceRest = 0;
      lastStart = now();
      attempts += 1;
      sinceRest += 1;
      return null;
    },
    // status 是这次抓取的结果（网络成功也要传）：429/503 计为“被限流”，其余按失败率统计。
    afterResponse({ status = 200, retryAfterSeconds = 0 } = {}) {
      if (stopped) return stopped;
      const ok = status >= 200 && status < 300;
      const blocked = blockedStatus(status);
      window.push({ ok, blocked });
      while (window.length > config.failureWindow) window.shift();
      consecutiveBlocked = blocked ? consecutiveBlocked + 1 : 0;
      if (blocked && consecutiveBlocked >= config.maxConsecutiveBlocked) {
        return Object.assign(stop('rate-limit'), { retryAfterMs: Math.max(0, Number(retryAfterSeconds) || 0) * 1000 });
      }
      if (window.length >= config.failureWindow) {
        const failed = window.filter(item => !item.ok).length;
        if (failed / window.length >= config.failureRatio) {
          return Object.assign(stop('failure-ratio'), { failed, total: window.length });
        }
      }
      return null;
    },
    reset() {
      attempts = 0; sinceRest = 0; consecutiveBlocked = 0; lastStart = 0; stopped = null; window.length = 0;
    },
  };
}
