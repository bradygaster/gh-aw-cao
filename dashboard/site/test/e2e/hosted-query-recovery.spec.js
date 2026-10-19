import { expect, registerSmokeRoutes, test } from './helpers/smoke-fixtures.js';

registerSmokeRoutes();

test('hosted views recover from throttling without a manual reload', async ({ page }) => {
  let requests = 0;
  /** @type {number[]} */
  const times = [];
  await page.route('**/api/v1/refresh', (route) => route.fulfill({
    json: { revision: 2, evaluatedAt: '2026-10-15T02:00:00Z' },
  }));
  await page.route('**/api/v1/query', (route) => {
    requests += 1;
    times.push(Date.now());
    return route.fulfill(requests === 1 ? {
      status: 429,
      headers: { 'Retry-After': '1' },
      json: { error: 'rate limit exceeded' },
    } : {
      json: { revision: 2, sources: { runs: { rows: [{ id: 'verified-run' }] } } },
    });
  });
  const results = await page.evaluate(async (backendUrl) => {
    const { queryRemoteDashboard } = await import(backendUrl);
    return Promise.all([
      queryRemoteDashboard(['runs'], { pages: [] }),
      queryRemoteDashboard(['runs'], { pages: [] }),
    ]);
  }, 'http://dashboard.test/src/remote-data-backend.js');
  expect(requests).toBe(3);
  expect(times[1] - times[0]).toBeGreaterThanOrEqual(950);
  for (const result of results) {
    expect(result.sources.runs.rows).toEqual([{ id: 'verified-run' }]);
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('leaving a hosted view aborts its rate-limit wait', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/v1/refresh', (route) => route.fulfill({
    json: { revision: 2, evaluatedAt: '2026-10-15T02:00:00Z' },
  }));
  await page.route('**/api/v1/query', (route) => {
    requests += 1;
    return route.fulfill({
      status: 429,
      headers: { 'Retry-After': '60' },
      json: { error: 'rate limit exceeded' },
    });
  });
  const errorName = await page.evaluate(async (backendUrl) => {
    const { queryRemoteDashboard } = await import(backendUrl);
    const controller = new AbortController();
    const pending = queryRemoteDashboard(['runs'], { pages: [] }, undefined, { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    try {
      await pending;
      return 'unexpected success';
    } catch (error) {
      return error instanceof Error ? error.name : String(error);
    }
  }, 'http://dashboard.test/src/remote-data-backend.js');
  expect(errorName).toBe('AbortError');
  expect(requests).toBe(1);
});
