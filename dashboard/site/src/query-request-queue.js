const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 60_000;

/** @param {Response} response */
function retryDelay(response) {
  const value = response.headers.get("Retry-After")?.trim();
  if (!value) return null;
  const delay = /^\d+$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay >= 0 && delay <= MAX_RETRY_DELAY_MS
    ? Math.max(1000, delay)
    : null;
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortSignal} [signal]
 */
function untilAborted(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}

/** @param {number} delay @param {AbortSignal} [signal] */
function wait(delay, signal) {
  signal?.throwIfAborted();
  if (delay <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve(undefined);
    }, delay);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Serialize hosted queries so throttled views share one cooldown rather than
 * retrying in parallel. This schedules transport only, never query evaluation.
 *
 * @param {(response: Response) => void} onResponse
 */
export function createQueryRequestQueue(onResponse) {
  /** @type {Promise<void>} */
  let tail = Promise.resolve();
  let retryAt = 0;

  /** @param {() => Promise<Response>} request @param {AbortSignal} [signal] */
  return (request, signal) => {
    const pending = tail.then(async () => {
      for (let attempt = 0; ; attempt += 1) {
        signal?.throwIfAborted();
        await wait(Math.max(0, retryAt - Date.now()), signal);
        const response = await request();
        onResponse(response);
        if (response.status !== 429) return response;
        const delay = retryDelay(response);
        if (delay === null) return response;
        retryAt = Date.now() + delay;
        if (attempt >= MAX_RETRIES) return response;
        await response.body?.cancel();
      }
    });
    // Failed or cancelled queries must not poison the queue for later views.
    tail = pending.then(() => {}, () => {});
    return untilAborted(pending, signal);
  };
}
