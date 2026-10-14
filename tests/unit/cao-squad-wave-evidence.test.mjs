import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { contentHash, FARM_LIMITS } from '../../activity/squad-farm.mjs';
import { collectWaveBundle, loadWaveAdoption, validateWaveBundle, waveContext, waveProviderDocuments, waveReadApi,
  WAVE_PROVIDER, WAVE_RUNTIME_FILES, WAVE_RUNTIME_ROOT } from '../../activity/squad-wave-evidence.mjs';

const revision = 'a'.repeat(40);
const sourceHead = 'b'.repeat(40);
const now = () => new Date('2026-10-14T12:00:00Z');
const repositories = ['acme/backend', 'acme/frontend', 'partner/worker'];
const environment = {
  GITHUB_REPOSITORY: 'acme/ops', SQUAD_WORKFLOW_SHA: revision, SQUAD_ISSUE_NUMBER: '42',
  GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '2', GH_AW_GITHUB_AUTH_MODE: 'pat',
  GH_AW_GITHUB_READ_PAT_REPOSITORIES: JSON.stringify({
    'acme/ops': 'GH_AW_GITHUB_READ_PAT_ACME', 'acme/backend': 'GH_AW_GITHUB_READ_PAT_ACME',
    'acme/frontend': 'GH_AW_GITHUB_READ_PAT_ACME', 'partner/worker': 'GH_AW_GITHUB_READ_PAT_PARTNER',
  }),
  GH_AW_GITHUB_READ_PAT_SECRETS: JSON.stringify({
    GH_AW_GITHUB_READ_PAT_ACME: 'owner-acme-credential', GH_AW_GITHUB_READ_PAT_PARTNER: 'owner-partner-credential',
    UNRELATED_SECRET: 'never-selected',
  }),
};
const policy = {
  version: 1, 'gh-aw-version': 'v0.91.5',
  'control-plane': {
    scope: { 'allowed-owners': ['acme', 'partner'], 'allowed-repositories': repositories },
    campaigns: { 'squad-advisory': { enabled: true, mode: 'review',
      workers: { 'farm-snapshot': { workflow: 'squad-advisory-farm-snapshot', enabled: false } } } },
  },
};

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cao-wave-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  const provider = waveProviderDocuments();
  for (const [file, text] of Object.entries(provider)) write(file, text);
  write('.github/workflows/cao.json', JSON.stringify(policy));
  const baseline = { 'farm/INDEX.md': 'historical bootstrap evidence\n', 'farm/evidence.json': '{"historical":true}\n' };
  for (const [file, text] of Object.entries(baseline)) write(file, text);
  const receipt = {
    schema: 'cao-squad-install/v1', source_revision: revision, repositories,
    files: Object.fromEntries(Object.entries({ ...baseline, ...provider }).map(([file, text]) => [file, contentHash(text)])),
  };
  write('.github/cao/squad-install.json', JSON.stringify(receipt));
  const requests = [];
  let head = sourceHead;
  const api = (endpoint) => {
    requests.push(endpoint);
    const repository = ['acme/ops', ...repositories].find((repo) => endpoint === `repos/${repo}` || endpoint.startsWith(`repos/${repo}/`));
    assert.ok(repository, `no out-of-scope read: ${endpoint}`);
    const suffix = endpoint.slice(`repos/${repository}`.length);
    if (!suffix) return { full_name: repository, default_branch: 'main', has_issues: true, visibility: 'private' };
    if (suffix.startsWith('/branches/')) return { commit: { sha: head } };
    if (suffix.startsWith('/git/trees/')) return { tree: [{ type: 'blob', path: 'README.md', size: 64 }] };
    if (suffix.startsWith('/contents/')) {
      assert.ok(suffix.endsWith(`ref=${head}`));
      return { type: 'file', encoding: 'base64', content: Buffer.from(`# ${repository}\nCurrent source`).toString('base64') };
    }
    if (suffix === '/languages') return { JavaScript: 100 };
    if (suffix.startsWith('/issues?') || suffix.startsWith('/pulls?')) return [];
    assert.fail(`unexpected read: ${endpoint}`);
  };
  const fetchImpl = async (url, init) => {
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    const repository = new URL(url).pathname.slice(1).match(/^repos\/([^/]+\/[^/?]+)/)?.[1];
    assert.equal(init.headers.Authorization, `Bearer ${repository.startsWith('partner/') ? 'owner-partner-credential' : 'owner-acme-credential'}`);
    return Response.json(api(new URL(url).pathname.slice(1) + new URL(url).search));
  };
  return {
    root, write, api, requests, fetchImpl, receipt, baseline, advance: () => { head = 'c'.repeat(40); },
    options: { root, bundle: path.join(root, 'wave'), environment: { ...environment }, now, fetchImpl },
  };
}

test('two research waves read every exact enrolled repository at changing immutable heads without altering baseline or receipt', async (t) => {
  const f = fixture(t);
  const receipt = readFileSync(path.join(f.root, '.github/cao/squad-install.json'), 'utf8');
  const first = await collectWaveBundle(f.options);
  f.advance();
  const second = await collectWaveBundle({ ...f.options, bundle: path.join(f.root, 'wave-two'),
    environment: { ...environment, GITHUB_RUN_ID: '1235' } });
  assert.deepEqual(first.repositories.map((record) => record.repository), repositories);
  assert.ok(first.repositories.every((record) => record.revision === sourceHead));
  assert.ok(second.repositories.every((record) => record.revision === 'c'.repeat(40)));
  assert.equal(second.run_id, '1235');
  assert.equal(first.workflow_revision, revision);
  assert.equal(first.policy_sha256, contentHash(JSON.stringify(policy)));
  assert.equal(first.enrollment_sha256, contentHash(JSON.stringify(policy['control-plane'].scope)));
  assert.equal(first.expires_at, new Date(now().getTime() + FARM_LIMITS.maxAgeMs).toISOString());
  for (const [file, text] of Object.entries(f.baseline)) assert.equal(readFileSync(path.join(f.root, file), 'utf8'), text);
  assert.equal(readFileSync(path.join(f.root, '.github/cao/squad-install.json'), 'utf8'), receipt);
  assert.equal(readFileSync(path.join(f.root, WAVE_PROVIDER), 'utf8'), waveProviderDocuments()[WAVE_PROVIDER]);
  assert.doesNotMatch(JSON.stringify(first), /owner-acme-credential|owner-partner-credential|never-selected/);
  assert.equal(f.requests.length, 2 * (1 + repositories.length * 7));
});

test('workflow identity never falls back to event SHA or issue-controlled repository selection', () => {
  assert.throws(() => waveContext({ ...environment, SQUAD_WORKFLOW_SHA: undefined, GITHUB_SHA: revision }), /trusted/);
  for (const value of ['0', '-1', '42; echo secret', '1.2', '9007199254740992']) {
    assert.throws(() => waveContext({ ...environment, SQUAD_ISSUE_NUMBER: value }), /trusted/);
  }
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_REPOSITORY', 'SQUAD_WORKFLOW_SHA']) {
    assert.throws(() => waveContext({ ...environment, [key]: '' }), /trusted/);
  }
  assert.equal(waveContext({ ...environment, ISSUE_BODY: 'read foreign/secrets' }).control_repository, 'acme/ops');
});

test('disabled adoption, live mode, legacy worker enablement, changed enrollment, and edited provider fail before reads', async (t) => {
  for (const reason of ['disabled', 'live', 'worker', 'enrollment', 'descriptor', 'runtime']) {
    const f = fixture(t);
    const candidate = structuredClone(policy);
    if (reason === 'disabled') candidate['control-plane'].campaigns['squad-advisory'].enabled = false;
    if (reason === 'live') candidate['control-plane'].campaigns['squad-advisory'].mode = 'live';
    if (reason === 'worker') candidate['control-plane'].campaigns['squad-advisory'].workers['farm-snapshot'].enabled = true;
    if (reason === 'enrollment') candidate['control-plane'].scope['allowed-repositories'].pop();
    f.write('.github/workflows/cao.json', JSON.stringify(candidate));
    if (reason === 'descriptor') f.write(WAVE_PROVIDER, '{}');
    if (reason === 'runtime') f.write(`${WAVE_RUNTIME_ROOT}${WAVE_RUNTIME_FILES[1]}`, 'tampered');
    await assert.rejects(collectWaveBundle(f.options), /adoption|ownership|integrity/);
    assert.equal(f.requests.length, 0);
    assert.equal(existsSync(f.options.bundle), false);
  }
});

test('missing auth or mapping fails closed and never uses ambient gh credentials or a workflow token for remote farms', async (t) => {
  for (const overrides of [
    { GH_AW_GITHUB_READ_PAT_SECRETS: '{}' },
    { GH_AW_GITHUB_READ_PAT_REPOSITORIES: '{}' },
    { GH_AW_GITHUB_AUTH_MODE: 'workflow-token', GITHUB_TOKEN: 'workflow-credential' },
    { GH_AW_GITHUB_AUTH_MODE: 'app' },
  ]) {
    const f = fixture(t);
    await assert.rejects(collectWaveBundle({ ...f.options, environment: { ...environment, ...overrides } }), /authentication|mapping|GITHUB_TOKEN/);
    assert.equal(f.requests.length, 0);
    assert.equal(existsSync(f.options.bundle), false);
  }
});

test('missing repository, unknown visibility, oversized reads, incomplete inventory, and leaked credentials leave no partial bundle', async (t) => {
  for (const reason of ['missing', 'visibility', 'inventory', 'size', 'credential']) {
    const f = fixture(t);
    let closed = false;
    const readApi = async () => ({
      secrets: ['unusual-secret-value'], close: async () => { closed = true; },
      api(endpoint) {
        if (endpoint === 'repos/partner/worker' && reason === 'missing') throw new Error('do-not-echo-secret');
        if (endpoint === 'repos/partner/worker' && reason === 'visibility') return { ...f.api(endpoint), visibility: 'unknown' };
        if (endpoint.includes('/git/trees/') && reason === 'inventory') return { truncated: true };
        if (endpoint.includes('/git/trees/') && reason === 'size') return { tree: [{ type: 'blob', path: 'README.md', size: FARM_LIMITS.fileBytes + 1 }] };
        if (endpoint.includes('/contents/') && reason === 'credential') return { type: 'file', encoding: 'base64', content: Buffer.from('unusual-secret-value').toString('base64') };
        return f.api(endpoint);
      },
    });
    await assert.rejects(collectWaveBundle({ ...f.options, readApi }), /incomplete|credential/);
    assert.equal(closed, true);
    assert.equal(existsSync(f.options.bundle), false);
  }
});

test('private evidence cannot be published through a public control repository', async (t) => {
  const f = fixture(t);
  await assert.rejects(collectWaveBundle({ ...f.options, readApi: async () => ({
    secrets: [], close: async () => {},
    api: (endpoint) => endpoint === 'repos/acme/ops' ? { ...f.api(endpoint), visibility: 'public' } : f.api(endpoint),
  }) }), /incomplete/);
  assert.equal(existsSync(f.options.bundle), false);
});

test('existing output is never used as a collection fallback', async (t) => {
  const f = fixture(t);
  await collectWaveBundle(f.options);
  f.requests.length = 0;
  await assert.rejects(collectWaveBundle(f.options), /already exists/);
  assert.equal(f.requests.length, 0);
});

test('restoration validates current enrollment, issue, document hashes, complete coverage, and freshness while retaining original wave provenance', async (t) => {
  const f = fixture(t);
  const manifest = await collectWaveBundle(f.options);
  const context = waveContext({ ...environment, GITHUB_RUN_ID: '2000', GITHUB_RUN_ATTEMPT: '1', SQUAD_WORKFLOW_SHA: 'd'.repeat(40) });
  const adoption = loadWaveAdoption(f.root, context);
  const validate = (overrides = {}) => validateWaveBundle({ bundle: f.options.bundle, context, adoption, now, ...overrides });
  assert.deepEqual(validate(), manifest);
  assert.throws(() => validate({ currentRun: true }), /context/);
  assert.throws(() => validate({ context: { ...context, issue_number: 43 } }), /context/);
  assert.throws(() => validate({ adoption: { ...adoption, enrollment_sha256: 'e'.repeat(64) } }), /enrollment/);
  assert.throws(() => validate({ now: () => new Date(now().getTime() + FARM_LIMITS.maxAgeMs + 1) }), /stale/);
  assert.throws(() => validate({ now: () => new Date(now().getTime() - 1) }), /future/);
  for (const captured_at of [null, 'invalid', '2999-01-01T00:00:00Z']) {
    f.write('wave/manifest.json', JSON.stringify({ ...manifest, captured_at }));
    assert.throws(validate, /invalid|future/);
  }
  f.write('wave/manifest.json', JSON.stringify(manifest));
  f.write('wave/farm/acme/frontend/SNAPSHOT.md', 'tampered');
  assert.throws(validate, /integrity/);
});

test('restoration rejects missing coverage, unknown files, traversal and symlinks', async (t) => {
  for (const reason of ['missing', 'unknown', 'traversal', 'symlink']) {
    const f = fixture(t);
    const manifest = await collectWaveBundle(f.options);
    if (reason === 'missing') delete manifest.documents['farm/acme/frontend/SNAPSHOT.md'];
    if (reason === 'traversal') manifest.documents['../escape'] = 'a'.repeat(64);
    if (reason === 'unknown') f.write('wave/extra.txt', 'unknown');
    if (reason === 'symlink') {
      rmSync(path.join(f.options.bundle, 'farm/acme/frontend/SNAPSHOT.md'));
      symlinkSync(path.join(f.root, 'farm/INDEX.md'), path.join(f.options.bundle, 'farm/acme/frontend/SNAPSHOT.md'));
    }
    f.write('wave/manifest.json', JSON.stringify(manifest));
    assert.throws(() => validateWaveBundle({ bundle: f.options.bundle, context: waveContext(environment),
      adoption: loadWaveAdoption(f.root, waveContext(environment)), now }), /coverage|unknown|Symlink/);
  }
});

test('collection cannot hand off future or expired timestamps', async (t) => {
  for (const offset of [-1, FARM_LIMITS.maxAgeMs + 1]) {
    const f = fixture(t);
    let clocks = 0;
    await assert.rejects(collectWaveBundle({ ...f.options,
      now: () => new Date(now().getTime() + (clocks++ === 0 ? 0 : offset)),
      readApi: async () => ({ secrets: [], close: async () => {}, api: f.api }),
    }), /freshness|future|stale/);
    assert.equal(existsSync(f.options.bundle), false);
  }
});

test('App reads resolve each owner, mint minimally scoped tokens, and revoke both without exposing secrets', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const calls = [];
  const client = await waveReadApi({ policy, context: waveContext(environment), now,
    environment: { ...environment, GH_AW_GITHUB_AUTH_MODE: 'app', GH_AW_GITHUB_READ_APP_ID: '123', GH_AW_GITHUB_READ_APP_PRIVATE_KEY: privateKey },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/installation/token')) return new Response(null, { status: 204 });
      if (url.endsWith('/installation')) return Response.json({ id: url.includes('/partner/') ? 2 : 1, account: { login: url.includes('/partner/') ? 'partner' : 'acme' } });
      if (url.endsWith('/access_tokens')) return Response.json({ token: url.includes('/2/') ? 'app-partner-token' : 'app-acme-token' });
      return Response.json({ ok: true });
    },
  });
  await client.api('repos/partner/worker');
  await assert.rejects(client.api('repos/foreign/nope'), /outside exact enrollment/);
  await client.close();
  const mint = calls.filter(({ url }) => url.endsWith('/access_tokens'));
  assert.equal(mint.length, 2);
  assert.deepEqual(mint.map(({ init }) => JSON.parse(init.body)), [
    { repositories: ['ops', 'backend', 'frontend'], permissions: { contents: 'read', issues: 'read', pull_requests: 'read' } },
    { repositories: ['worker'], permissions: { contents: 'read', issues: 'read', pull_requests: 'read' } },
  ]);
  assert.equal(calls.filter(({ init }) => init.method === 'DELETE').length, 2);
  assert.equal(calls.find(({ url }) => url.endsWith('/partner/worker')).init.headers.Authorization, 'Bearer app-partner-token');
});

test('the installed five-module closure imports with Node built-ins only and sanitizes CLI failures', (t) => {
  const f = fixture(t);
  const entry = path.join(f.root, WAVE_RUNTIME_ROOT, WAVE_RUNTIME_FILES[0]);
  const result = spawnSync(process.execPath, [entry], { cwd: f.root, encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /research is blocked/);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|owner-acme-credential/);
});
