import { describe, expect, it } from 'vitest';
import corpus from '../../../../server/internal/query/testdata/facet-contract.json' with { type: 'json' };
import { validateDashboardDocument } from '../../src/validator.js';
import { processDataRequest } from '../../src/data-worker.js';
import { partitionFacetRows } from '../../src/data/queries/facet.js';

const rows = [
  { engine: 'copilot', repository: 'one', workflow: 'worker' },
  { engine: 'claude', repository: 'two', workflow: 'planner' },
  { engine: 'copilot', repository: 'one', workflow: 'worker' }
];
/** @type {import('../../src/presenter.js').SourceMetadata} */
const metadata = {
  'source-id': 'runs', 'source-kind': 'fixture',
  'as-of': '2026-10-11T00:00:00Z', 'retrieved-at': '2026-10-11T00:00:00Z',
  availability: 'available', completeness: 'complete', freshness: 'fresh'
};

describe('shared facet wire corpus', () => {
  it.each(corpus)('$name agrees across authoring, worker and executor', (entry) => {
    // Serialization preserves explicit null/empty axes and omits absent properties.
    const query = JSON.parse(JSON.stringify({
      name: 'panels', subject: 'Partition retained rows.', from: 'runs', facet: entry.facet
    }));
    const document = JSON.stringify({
      'language-version': '0.1.0',
      dashboard: {
        id: 'facets', title: 'Facets', queries: [query],
        pages: [{
          id: 'facets', kind: 'custom', title: 'Facets',
          views: [{
            id: 'facets', mark: 'table', data: { source: 'panels' },
            encoding: { columns: [{
              field: Object.hasOwn(query, 'facet') ? 'facet-field' : 'workflow',
              type: 'nominal', title: 'Category'
            }] }
          }]
        }]
      }
    });
    const validation = validateDashboardDocument(document);
    expect(validation.ok, JSON.stringify(validation)).toBe(entry.valid);
    for (const input of [rows, []]) {
      const result = /** @type {Record<string, import('../../src/presenter.js').LogicalSourceInput>} */ (processDataRequest({
        operation: 'execute-dashboard-queries', queries: [query], sourceNames: ['panels'],
        sources: { runs: { source: 'runs', rows: input, metadata } }
      })).panels;
      if (!entry.valid) {
        expect(result).toMatchObject({ rows: [], metadata: { availability: 'unavailable' } });
        expect(() => partitionFacetRows(input, query.facet)).toThrow();
      } else if (query.facet) {
        const direct = partitionFacetRows(input, query.facet);
        expect(result.rows).toEqual(direct);
        expect(direct).toHaveLength(input.length ? 2 : 0);
        expect(direct.flatMap((panel) => panel[query.facet.as])).toEqual(
          input.length ? [rows[0], rows[2], rows[1]] : []
        );
        expect(result.metadata.availability).toBe(input.length ? 'available' : 'empty');
      } else {
        expect(result.rows).toEqual(input);
      }
    }
  });
});
