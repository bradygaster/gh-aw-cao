import assert from 'node:assert/strict';
import test from 'node:test';
import { sqliteRetention } from '../../activity/sqlite-retention.mjs';

const day = 86400000;

test('SQLite operational values share the run/default window, not the linked-detail override', () => {
  for (const [detail, runs, expectedDetail, expectedRuns] of [
    [undefined, undefined, 7 * day, 30 * day],
    [7 * day, 30 * day, 7 * day, 30 * day],
    [undefined, 60 * day, 7 * day, 60 * day],
    [90 * day, undefined, 90 * day, 90 * day],
    [7 * day, Number.MAX_SAFE_INTEGER, 7 * day, Number.MAX_SAFE_INTEGER],
    [Number.MAX_SAFE_INTEGER, undefined, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
  ]) {
    assert.deepEqual(sqliteRetention(detail, runs, day), {
      retentionWindowMs: expectedDetail,
      retentionWindowMsByStore: { runs: expectedRuns, operationalValues: expectedRuns }
    });
  }
});
