// IRUSHY - request limits.
//
//   createRateLimiter()      per-IP fixed-window budget (always applies)
//   createProviderLimiter()  rolling 60 s RPM bucket (APInex backend only)
//   createConcurrencyGate()  bounded in-flight work with a bounded queue
//   createDeduper()          the same request_id is answered once
//
// All state is in memory and bounded in size.

export class LimitError extends Error {
  constructor(code, message, { retryAfterMs = 0, status = 429 } = {}) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

const MAX_KEYS = 20000;

export function createRateLimiter({ windowMs, max, name }) {
  const buckets = new Map();
  let lastSweep = Date.now();

  function sweep(now) {
    if (now - lastSweep < Math.min(windowMs, 60000) && buckets.size < MAX_KEYS) return;
    lastSweep = now;
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    // Still too many keys (an address flood): drop the oldest windows first.
    if (buckets.size >= MAX_KEYS) {
      const excess = buckets.size - Math.floor(MAX_KEYS * 0.9);
      let i = 0;
      for (const k of buckets.keys()) {
        if (i++ >= excess) break;
        buckets.delete(k);
      }
    }
  }

  function hit(key) {
    const now = Date.now();
    sweep(now);
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      return { ok: false, retryAfterMs: Math.max(0, b.resetAt - now), remaining: 0 };
    }
    return { ok: true, retryAfterMs: 0, remaining: max - b.count };
  }

  return { name, hit, size: () => buckets.size };
}

export function createProviderLimiter({ rpm }) {
  const stamps = [];
  return {
    tryAcquire() {
      const now = Date.now();
      while (stamps.length && now - stamps[0] >= 60000) stamps.shift();
      if (stamps.length >= rpm) {
        return { ok: false, retryAfterMs: 60000 - (now - stamps[0]) };
      }
      stamps.push(now);
      return { ok: true, retryAfterMs: 0 };
    },
    inWindow: () => stamps.length
  };
}

export function createConcurrencyGate({ max, queueTimeoutMs, maxQueue }) {
  let active = 0;
  const queue = [];

  function release() {
    active -= 1;
    while (queue.length) {
      const next = queue.shift();
      if (next.cancelled) continue;
      clearTimeout(next.timer);
      active += 1;
      next.resolve();
      return;
    }
  }

  async function acquire() {
    if (active < max) {
      active += 1;
      return;
    }
    if (queue.length >= maxQueue) {
      throw new LimitError('busy', 'IRUSHY is busy right now.', { retryAfterMs: 5000, status: 503 });
    }
    await new Promise((resolve, reject) => {
      const entry = { resolve, cancelled: false, timer: null };
      entry.timer = setTimeout(() => {
        entry.cancelled = true;
        reject(new LimitError('busy', 'IRUSHY is busy right now.', { retryAfterMs: 5000, status: 503 }));
      }, queueTimeoutMs);
      queue.push(entry);
    });
  }

  return {
    async run(fn) {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    stats: () => ({ active, queued: queue.filter((q) => !q.cancelled).length })
  };
}

// Joins concurrent duplicates and replays a recent result for the same key,
// so a double click or a network retry is answered once.
export function createDeduper({ windowMs = 30000, max = 1000 } = {}) {
  const inflight = new Map();
  const done = new Map();

  function prune(now) {
    for (const [k, v] of done) {
      if (v.expires <= now || done.size > max) done.delete(k);
      else break;
    }
  }

  return {
    async run(key, fn) {
      if (!key || windowMs <= 0) return { value: await fn(), duplicate: false };
      const now = Date.now();
      prune(now);
      const cached = done.get(key);
      if (cached && cached.expires > now) return { value: cached.value, duplicate: true };
      if (inflight.has(key)) return { value: await inflight.get(key), duplicate: true };
      const p = (async () => fn())();
      inflight.set(key, p);
      try {
        const value = await p;
        done.set(key, { value, expires: Date.now() + windowMs });
        return { value, duplicate: false };
      } finally {
        inflight.delete(key);
      }
    },
    size: () => ({ inflight: inflight.size, done: done.size })
  };
}
