import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryRequestQueue } from "../../src/query-request-queue.js";

afterEach(() => vi.useRealTimers());

function throttled(retryAfter = "2") {
  return new Response(JSON.stringify({ error: "rate limit exceeded" }), {
    status: 429,
    headers: { "Retry-After": retryAfter },
  });
}

describe("hosted query request queue", () => {
  it("recovers throttled queries after Retry-After and shares cooldown with other views", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const enqueue = createQueryRequestQueue(notify);
    const first = vi.fn().mockResolvedValueOnce(throttled()).mockResolvedValueOnce(new Response("{}"));
    const second = vi.fn().mockResolvedValue(new Response("{}"));
    const result = enqueue(first);
    const next = enqueue(second);
    await vi.advanceTimersByTimeAsync(1999);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).status).toBe(200);
    expect((await next).status).toBe(200);
    expect(notify.mock.calls.map(([response]) => response.status)).toEqual([429, 200, 200]);
  });

  it("honors HTTP-date Retry-After", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T02:00:00Z"));
    const request = vi.fn()
      .mockResolvedValueOnce(throttled("Thu, 15 Oct 2026 02:00:03 GMT"))
      .mockResolvedValueOnce(new Response("{}"));
    const pending = createQueryRequestQueue(() => {})(request);
    await vi.advanceTimersByTimeAsync(2999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(200);
  });

  it.each(["invalid", "", "61", "-1"])("does not retry invalid or excessive Retry-After %j", async (header) => {
    const request = vi.fn().mockResolvedValue(throttled(header));
    const result = await createQueryRequestQueue(() => {})(request);
    expect(result.status).toBe(429);
    expect(request).toHaveBeenCalledOnce();
  });

  it("surfaces persistent throttling after two retries", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockImplementation(async () => throttled("1"));
    const pending = createQueryRequestQueue(() => {})(request);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await pending).status).toBe(429);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("cancels cooldown when navigating away and lets a later view recover", async () => {
    vi.useFakeTimers();
    const enqueue = createQueryRequestQueue(() => {});
    const controller = new AbortController();
    const request = vi.fn().mockResolvedValue(throttled());
    const pending = enqueue(request, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    const next = enqueue(async () => new Response("{}"));
    await vi.advanceTimersByTimeAsync(2000);
    expect((await next).status).toBe(200);
    expect(request).toHaveBeenCalledOnce();
  });

  it("immediately rejects a queued aborted request without sending it", async () => {
    vi.useFakeTimers();
    const enqueue = createQueryRequestQueue(() => {});
    const firstRequest = vi.fn().mockResolvedValueOnce(throttled()).mockResolvedValueOnce(new Response("{}"));
    const first = enqueue(firstRequest);
    const controller = new AbortController();
    const skipped = vi.fn();
    const pending = enqueue(skipped, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(2000);
    await first;
    expect(skipped).not.toHaveBeenCalled();
    expect((await enqueue(async () => new Response("{}"))).status).toBe(200);
  });

  it("preserves non-rate-limit errors without retrying or blocking later queries", async () => {
    const enqueue = createQueryRequestQueue(() => {});
    const request = vi.fn().mockResolvedValue(new Response("failure", { status: 503 }));
    expect((await enqueue(request)).status).toBe(503);
    expect(request).toHaveBeenCalledOnce();
    await expect(enqueue(async () => { throw new Error("network failure"); })).rejects.toThrow("network failure");
    expect((await enqueue(async () => new Response("{}"))).status).toBe(200);
  });
});
