import { describe, expect, it } from 'vitest';
import contract from '../../../../server/internal/query/testdata/date-bucket-units.json' with { type: 'json' };
import { validateDashboardDocument } from '../../src/validator.js';
import { processDataRequest } from '../../src/data-worker.js';

/** @type {import('../../src/presenter.js').SourceMetadata} */
const metadata = {
  'source-id': 'runs', 'source-kind': 'fixture',
  'as-of': '2026-10-11T00:00:00Z', 'retrieved-at': '2026-10-11T00:00:00Z',
  availability: 'available', completeness: 'complete', freshness: 'fresh'
};

/** @param {unknown} argument */
function query(argument) {
  return {
    name: 'buckets', subject: 'Bucket retained observations in UTC.', from: 'runs',
    parameters: [{ name: 'unit', type: 'string' }],
    compute: [{ as: 'bucket', function: 'date-bucket', args: [{ field: 'started-at' }, argument] }]
  };
}

/** @param {unknown} argument */
function validate(argument) {
  return validateDashboardDocument(JSON.stringify({
    'language-version': '0.1.0',
    dashboard: {
      id: 'buckets', title: 'UTC buckets', queries: [query(argument)],
      pages: [{
        id: 'buckets', kind: 'custom', title: 'UTC buckets',
        views: [{
          id: 'buckets', mark: 'table', data: { source: 'buckets' },
          encoding: { columns: [{ field: 'bucket', type: 'temporal', title: 'Bucket' }] }
        }]
      }]
    }
  }));
}

/** @param {unknown} argument @param {Record<string, unknown>[]} rows */
function execute(argument, rows) {
  return /** @type {Record<string, import('../../src/presenter.js').LogicalSourceInput>} */ (processDataRequest({
    operation: 'execute-dashboard-queries',
    queries: [query(argument)], sourceNames: ['buckets'],
    sources: { runs: { source: 'runs', rows, metadata } }
  })).buckets;
}

describe('date-bucket literal unit contract', () => {
  it.each(contract.valid)('validates and executes literal $unit in UTC', ({ unit, expected }) => {
    const validation = validate({ value: unit });
    expect(validation, JSON.stringify(validation)).toMatchObject({ ok: true });
    expect(execute({ value: unit }, [
      { 'started-at': contract.timestamp }, { 'started-at': null }, { 'started-at': 'invalid' }
    ])).toMatchObject({
      rows: [{ bucket: expected }, { bucket: null }, { bucket: null }],
      metadata: { availability: 'available' }
    });
  });

  it.each(contract.invalid)('rejects invalid/dynamic unit %j in authoring and worker plans', (argument) => {
    const result = validate(argument);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'DLS-E005', path: '$.dashboard.queries[0].compute[0].args[1]'
    }));
    for (const rows of [[], [{ 'started-at': null }], [{ 'started-at': contract.timestamp, event: 'day' }]]) {
      expect(execute(argument, rows)).toMatchObject({
        rows: [], metadata: { availability: 'unavailable', 'query-diagnostic': expect.stringContaining('literal UTC unit') }
      });
    }
  });
});
