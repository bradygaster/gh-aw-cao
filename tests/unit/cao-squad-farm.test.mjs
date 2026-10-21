import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectFarmEvidence, farmEnrollment, FARM_LIMITS } from '../../squad-advisory/runtime/squad-farm.mjs';

const head = 'b'.repeat(40);
const now = () => new Date('2026-10-09T12:00:00Z');
const policy = {
  version: 1, 'gh-aw-version': 'v0.92.6',
  'control-plane': { scope: { 'allowed-owners': ['acme', 'partner'], 'allowed-repositories': ['acme/frontend', 'acme/backend', 'partner/worker'] } },
};

function farmApi(endpoint) {
  const repository = policy['control-plane'].scope['allowed-repositories'].find((repo) => endpoint === `repos/${repo}` || endpoint.startsWith(`repos/${repo}/`));
  assert.ok(repository, `no reads outside authoritative enrollment: ${endpoint}`);
  const suffix = endpoint.slice(`repos/${repository}`.length);
  if (!suffix) return { full_name: repository, default_branch: 'main', archived: false, visibility: 'private' };
  if (suffix.startsWith('/branches/')) return { commit: { sha: head } };
  if (suffix.startsWith('/git/trees/')) return { truncated: false, tree: [{ type: 'blob', path: 'README.md', size: 60 }] };
  if (suffix.startsWith('/contents/')) {
    assert.match(suffix, new RegExp(`ref=${head}$`));
    return { type: 'file', encoding: 'base64', content: Buffer.from(`# ${repository}\nFarm component`).toString('base64') };
  }
  if (suffix === '/languages') return { TypeScript: 100 };
  if (suffix.startsWith('/issues?') || suffix.startsWith('/pulls?')) return [];
  assert.fail(`unexpected API: ${endpoint}`);
}

test('three-repository farm captures all enrolled owners at immutable heads with explicit bounds', async () => {
  const result = await collectFarmEvidence({ policy, controlRepository: 'acme/ops', controlVisibility: 'private', api: farmApi, now });
  assert.deepEqual(result.repositories, ['acme/backend', 'acme/frontend', 'partner/worker']);
  const evidence = JSON.parse(result.documents['farm/evidence.json']);
  assert.equal(evidence.repositories.length, 3);
  assert.deepEqual(evidence.limits, FARM_LIMITS);
  assert.ok(evidence.repositories.every((repo) => repo.revision === head && repo.files.length === 1));
  assert.match(result.documents['farm/INDEX.md'], /partner\/worker/);
});

test('no implicit discovery, owner escape, silent repository truncation, or duplicate enrollment', () => {
  for (const repositories of [[], ['acme/*'], ['acme/backend', 'ACME/BACKEND'], Array.from({ length: 17 }, (_, index) => `acme/repo${index}`), ['foreign/private']]) {
    const candidate = structuredClone(policy);
    candidate['control-plane'].scope['allowed-repositories'] = repositories;
    assert.throws(() => farmEnrollment(candidate, 'acme/ops'), /enrollment|allowed-owners/);
  }
});

test('rejects incomplete inventories and oversized selected files rather than claiming complete evidence', async () => {
  for (const tree of [{ truncated: true, tree: [] }, { tree: [{ type: 'blob', path: 'README.md', size: 100000 }] }, { tree: [] }]) {
    await assert.rejects(collectFarmEvidence({ policy, controlRepository: 'acme/ops', controlVisibility: 'private', now,
      api: (endpoint) => endpoint.includes('/git/trees/') ? tree : farmApi(endpoint),
    }), /incomplete/);
  }
});

test('redacts entire files before truncating and scrubs discovered secrets across repositories', async () => {
  const result = await collectFarmEvidence({ policy, controlRepository: 'acme/ops', controlVisibility: 'private', now, api(endpoint) {
    if (endpoint.includes('/contents/')) {
      const text = endpoint.includes('frontend')
        ? 'password: highly-sensitive-value\n{"password":"inline-secret-value"}\n-----BEGIN RSA PRIVATE KEY-----\nprivate-content\n-----END RSA PRIVATE KEY-----'
        : 'repeated highly-sensitive-value inline-secret-value';
      return { type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') };
    }
    return farmApi(endpoint);
  } });
  assert.doesNotMatch(JSON.stringify(result.documents), /highly-sensitive-value|private-content|inline-secret-value/);
});

test('private farm contents cannot be mirrored into public operations repositories', async () => {
  await assert.rejects(collectFarmEvidence({ policy, controlRepository: 'acme/ops', controlVisibility: 'public', api: farmApi, now }), /incomplete/);
});
