import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { contentHash } from '../../activity/squad-farm.mjs';
import { ownerScopedPatSecret, FINE_GRAINED_PAT_PROFILES } from '../../activity/authentication.mjs';
import { credentialPlan, ownerPatSecret, runWaveEvidence, verifyWaveBundle, WAVE_LIMITS } from '../../activity/squad-wave-evidence.mjs';

const RUNTIME = fileURLToPath(new URL('../../activity/squad-wave-evidence.mjs', import.meta.url));
const workflowSha = 'f'.repeat(40);
const start = new Date('2026-10-14T12:00:00Z');
const repositories = ['acme/backend', 'acme/frontend', 'partner/worker'];
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });

function policyFor(overrides = {}) {
  return {
    version: 1, 'gh-aw-version': 'v0.91.5',
    'control-plane': {
      scope: { 'allowed-owners': ['acme', 'partner'], 'allowed-repositories': overrides.repositories ?? repositories },
      campaigns: { 'squad-advisory': { enabled: overrides.enabled ?? true, mode: overrides.mode ?? 'review', workers: { 'farm-snapshot': { enabled: false } } } },
    },
  };
}

function fixture(t, overrides = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cao-wave-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'checkout');
  mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  const writePolicy = (policy) => writeFileSync(path.join(root, '.github/workflows/cao.json'), `${JSON.stringify(policy, null, 2)}\n`);
  writePolicy(policyFor(overrides));
  mkdirSync(path.join(root, 'farm'), { recursive: true });
  writeFileSync(path.join(root, 'farm/INDEX.md'), 'baseline');
  const state = { heads: Object.fromEntries(repositories.map((repo) => [repo, 'a'.repeat(40)])), calls: [], minted: [], revoked: [], content: overrides.content };
  const env = {
    GITHUB_REPOSITORY: 'acme/ops', GITHUB_WORKFLOW_SHA: workflowSha, GITHUB_RUN_ID: '9001', GITHUB_RUN_ATTEMPT: '2',
    GITHUB_API_URL: 'https://api.example.test', GITHUB_TOKEN: 'workflow-token-value',
    CAO_GITHUB_AUTH_MODE: 'app', CAO_GITHUB_READ_APP_ID: 'Iv1.cao', CAO_GITHUB_READ_APP_PRIVATE_KEY: pem,
    ...overrides.env,
  };
  const json = (value, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(value) });
  const fetchImpl = async (url, init) => {
    const endpoint = url.slice('https://api.example.test/'.length);
    const token = init.headers.Authorization.replace(/^Bearer /, '');
    state.calls.push({ method: init.method, endpoint, token });
    if (endpoint === 'repos/acme/ops') {
      assert.equal(token, env.GITHUB_TOKEN);
      return json({ full_name: 'acme/ops', visibility: overrides.controlVisibility ?? 'private' });
    }
    const install = endpoint.match(/^repos\/([^/]+)\/[^/]+\/installation$/);
    if (install) {
      const [header, payload, signature] = token.split('.');
      assert.ok(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, signature, 'base64url'), 'App JWT is signed with the read key');
      assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).iss, 'Iv1.cao');
      return json({ id: install[1] === 'acme' ? 11 : 22 });
    }
    const mint = endpoint.match(/^app\/installations\/(\d+)\/access_tokens$/);
    if (mint) {
      const body = JSON.parse(init.body);
      const minted = `ghs_${'x'.repeat(30)}${mint[1]}`;
      state.minted.push({ installation: mint[1], ...body, token: minted });
      return json({ token: minted });
    }
    if (endpoint === 'installation/token' && init.method === 'DELETE') { state.revoked.push(token); return { ok: true, status: 204, text: async () => '' }; }
    const repository = repositories.find((repo) => endpoint.startsWith(`repos/${repo}`));
    assert.ok(repository, `no reads outside enrollment: ${endpoint}`);
    const owner = repository.split('/')[0];
    state.tokenByOwner ??= {};
    (state.tokenByOwner[owner] ??= new Set()).add(token);
    if (overrides.missing === repository) return json({ message: 'Not Found' }, 404);
    const suffix = endpoint.slice(`repos/${repository}`.length);
    const head = state.heads[repository];
    if (!suffix) return json({ full_name: repository, default_branch: 'main', archived: false, visibility: 'private' });
    if (suffix.startsWith('/branches/')) return json({ commit: { sha: head } });
    if (suffix.startsWith('/git/trees/')) return json({ truncated: false, tree: [{ type: 'blob', path: 'README.md', size: 200 }] });
    if (suffix.startsWith('/contents/')) {
      assert.match(suffix, new RegExp(`ref=${head}$`));
      return json({ type: 'file', encoding: 'base64', content: Buffer.from(state.content ?? `# ${repository}\nComponent at ${head}`).toString('base64') });
    }
    if (suffix === '/languages') return json({ JavaScript: 1 });
    if (suffix.startsWith('/issues?') || suffix.startsWith('/pulls?')) return json([]);
    assert.fail(`unexpected endpoint ${endpoint}`);
  };
  let clock = start;
  const now = () => clock;
  return {
    dir, root, env, state, fetchImpl, writePolicy, now, advance: (ms) => { clock = new Date(clock.getTime() + ms); },
    output: (name = 'wave') => path.join(dir, name),
    collect(output, extra = {}) {
      const secrets = [];
      return runWaveEvidence(['collect', '--root', root, '--output', output, '--issue', '42'], { env, fetchImpl, now, onSecret: (value) => secrets.push(value), ...extra })
        .then((result) => ({ ...result, secrets }));
    },
  };
}

function bundleFiles(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/')).sort();
}

test('App-mode collection writes one complete, bound, revision-pinned bundle with step-local credentials', async (t) => {
  const f = fixture(t);
  const output = f.output();
  const result = await f.collect(output);
  assert.equal(result.status, 'ready');
  const manifestBytes = readFileSync(path.join(output, 'manifest.json'));
  assert.equal(result.manifest_sha256, contentHash(manifestBytes));
  const manifest = JSON.parse(manifestBytes);
  assert.deepEqual(Object.keys(manifest).sort(), ['bundle_bytes', 'control_repository', 'documents', 'enrollment_sha256', 'generated_at', 'issue', 'max_age_seconds', 'policy_sha256', 'repositories', 'run_attempt', 'run_id', 'schema', 'workflow_sha']);
  assert.equal(manifest.schema, 'cao-squad-wave-evidence/v1');
  assert.equal(manifest.control_repository, 'acme/ops');
  assert.equal(manifest.workflow_sha, workflowSha);
  assert.equal(manifest.issue, 42);
  assert.equal(manifest.run_id, '9001');
  assert.equal(manifest.run_attempt, '2');
  assert.equal(manifest.generated_at, start.toISOString());
  assert.equal(manifest.max_age_seconds, 86400);
  assert.equal(manifest.policy_sha256, contentHash(readFileSync(path.join(f.root, '.github/workflows/cao.json'))));
  assert.equal(manifest.enrollment_sha256, contentHash(JSON.stringify(policyFor()['control-plane'].scope)));
  assert.deepEqual(manifest.repositories.map((record) => [record.repository, record.revision]), [...repositories].sort().map((repo) => [repo, 'a'.repeat(40)]));
  assert.deepEqual(bundleFiles(output), ['farm/INDEX.md', 'farm/acme/backend/SNAPSHOT.md', 'farm/acme/frontend/SNAPSHOT.md', 'farm/evidence.json', 'farm/partner/worker/SNAPSHOT.md', 'manifest.json']);
  let bytes = 0;
  for (const [file, hash] of Object.entries(manifest.documents)) {
    const content = readFileSync(path.join(output, file));
    bytes += content.length;
    assert.equal(contentHash(content), hash);
  }
  assert.equal(manifest.bundle_bytes, bytes);
  // One read-only, repository-scoped installation token per owner; masked, used only for that owner, then revoked.
  assert.deepEqual(f.state.minted.map(({ repositories: names, permissions }) => [names, permissions]), [
    [['backend', 'frontend'], { contents: 'read', metadata: 'read', issues: 'read', pull_requests: 'read' }],
    [['worker'], { contents: 'read', metadata: 'read', issues: 'read', pull_requests: 'read' }],
  ]);
  assert.deepEqual(result.secrets, f.state.minted.map(({ token }) => token));
  assert.deepEqual([...f.state.tokenByOwner.acme], [f.state.minted[0].token]);
  assert.deepEqual([...f.state.tokenByOwner.partner], [f.state.minted[1].token]);
  assert.deepEqual(f.state.revoked.sort(), f.state.minted.map(({ token }) => token).sort());
  const all = bundleFiles(output).map((file) => readFileSync(path.join(output, file), 'utf8')).join('\n');
  for (const secret of [pem, f.env.GITHUB_TOKEN, ...result.secrets]) assert.equal(all.includes(secret), false);
  assert.equal(readFileSync(path.join(f.root, 'farm/INDEX.md'), 'utf8'), 'baseline', 'committed baseline is never touched');
  assert.equal(verifyWaveBundle({ root: f.root, bundle: output, env: f.env, now: f.now }).status, 'verified');
});

test('successive waves capture changed heads in fresh bundles without reusing or overwriting earlier evidence', async (t) => {
  const f = fixture(t);
  const first = await f.collect(f.output('wave-1'));
  f.state.heads['acme/frontend'] = 'b'.repeat(40);
  f.advance(25 * 60 * 60 * 1000);
  await assert.rejects(f.collect(f.output('wave-1')), /new absolute directory/);
  const second = await f.collect(f.output('wave-2'));
  assert.notEqual(first.manifest_sha256, second.manifest_sha256);
  assert.equal(second.generated_at, f.now().toISOString());
  assert.equal(second.repositories.find((record) => record.repository === 'acme/frontend').revision, 'b'.repeat(40));
  assert.throws(() => verifyWaveBundle({ root: f.root, bundle: f.output('wave-1'), env: f.env, now: f.now }), /expired/);
  assert.equal(verifyWaveBundle({ root: f.root, bundle: f.output('wave-2'), env: f.env, now: f.now }).status, 'verified');
});

test('any missing repository fails the whole wave with no bundle, partial directory, or echoed response', async (t) => {
  const f = fixture(t, { missing: 'partner/worker' });
  const output = f.output();
  await assert.rejects(f.collect(output), (error) => /incomplete for partner\/worker/.test(error.message) && !/Not Found/.test(error.message));
  assert.equal(existsSync(output), false);
  assert.deepEqual(readdirSync(f.dir).filter((name) => name.startsWith('wave')), []);
  assert.deepEqual(f.state.revoked.length, f.state.minted.length);
});

test('disabled, non-review, or changed enrollment policy stops before any GitHub read', async (t) => {
  for (const overrides of [{ enabled: false }, { mode: 'live' }, { repositories: ['acme/*'] }]) {
    const f = fixture(t, overrides);
    await assert.rejects(f.collect(f.output()), /review mode|enrollment/);
    assert.equal(f.state.calls.length, 0);
  }
});

test('farm evidence cannot cross into a less restrictive operations repository', async (t) => {
  const pub = fixture(t, { controlVisibility: 'public' });
  await assert.rejects(pub.collect(pub.output()), /incomplete/);
  const mismatch = fixture(t, { env: { GITHUB_EVENT_REPOSITORY_VISIBILITY: 'public' } });
  await assert.rejects(mismatch.collect(mismatch.output()), /visibility/);
});

test('run identity, workflow revision, and issue are mandatory provenance', async (t) => {
  for (const env of [{ GITHUB_WORKFLOW_SHA: '', GITHUB_SHA: '' }, { GITHUB_RUN_ID: 'x' }, { GITHUB_RUN_ATTEMPT: '' }]) {
    const f = fixture(t, { env });
    await assert.rejects(f.collect(f.output()), /run identity/);
  }
  const f = fixture(t);
  await assert.rejects(runWaveEvidence(['collect', '--root', f.root, '--output', f.output(), '--issue', '0x1'], { env: f.env, fetchImpl: f.fetchImpl, now: f.now }), /issue/);
  await assert.rejects(runWaveEvidence(['collect', '--root', f.root, '--repo', 'evil/x'], { env: f.env }), /unsupported arguments/);
});

test('verification rejects tampering, extra files, symlinks, future timestamps, and enrollment drift', async (t) => {
  const f = fixture(t);
  const cases = [
    ['tampered', (dir) => writeFileSync(path.join(dir, 'farm/acme/backend/SNAPSHOT.md'), 'changed'), /modified/],
    ['extra', (dir) => writeFileSync(path.join(dir, 'farm/extra.md'), 'x'), /differ/],
    ['symlink', (dir) => { rmSync(path.join(dir, 'farm/INDEX.md')); symlinkSync('/etc/hosts', path.join(dir, 'farm/INDEX.md')); }, /symlink/],
  ];
  for (const [name, mutate, expected] of cases) {
    const output = f.output(name);
    await f.collect(output);
    mutate(output);
    assert.throws(() => verifyWaveBundle({ root: f.root, bundle: output, env: f.env, now: f.now }), expected);
  }
  const output = f.output('drift');
  await f.collect(output);
  assert.throws(() => verifyWaveBundle({ root: f.root, bundle: output, env: f.env, now: () => new Date(start.getTime() - 1000) }), /future/);
  assert.throws(() => verifyWaveBundle({ root: f.root, bundle: output, env: { ...f.env, GITHUB_REPOSITORY: 'acme/other' }, now: f.now }), /control repository/);
  f.writePolicy(policyFor({ repositories: ['acme/backend', 'acme/frontend'] }));
  assert.throws(() => verifyWaveBundle({ root: f.root, bundle: output, env: f.env, now: f.now }), /current reviewed CAO enrollment/);
});

test('mirrored credentials in source content are redacted from the bundle', async (t) => {
  const leaked = `ghp_${'s'.repeat(36)}`;
  const f = fixture(t, { content: `token: ${leaked}\npassword = hunter2-value` });
  const output = f.output();
  await f.collect(output);
  const all = bundleFiles(output).map((file) => readFileSync(path.join(output, file), 'utf8')).join('\n');
  assert.equal(all.includes(leaked), false);
  assert.equal(all.includes('hunter2-value'), false);
});

test('credential planning mirrors CAO owner-scoped PAT mapping without reading secrets', () => {
  assert.equal(ownerPatSecret('my-org'), ownerScopedPatSecret(FINE_GRAINED_PAT_PROFILES[0], 'my-org'));
  const map = JSON.stringify({ 'acme/backend': 'GH_AW_GITHUB_READ_PAT_ACME', 'acme/frontend': 'GH_AW_GITHUB_READ_PAT_ACME', 'partner/worker': 'GH_AW_GITHUB_READ_PAT_PARTNER' });
  assert.deepEqual(credentialPlan({ CAO_GITHUB_AUTH_MODE: 'pat', CAO_GITHUB_READ_PAT_REPOSITORIES: map }, repositories, 'acme/ops', { secrets: false }).slots,
    [{ owner: 'acme', secret: 'GH_AW_GITHUB_READ_PAT_ACME' }, { owner: 'partner', secret: 'GH_AW_GITHUB_READ_PAT_PARTNER' }]);
  assert.throws(() => credentialPlan({ CAO_GITHUB_AUTH_MODE: 'pat', CAO_GITHUB_READ_PAT_REPOSITORIES: JSON.stringify({ 'acme/backend': 'OTHER' }) }, repositories, 'acme/ops'), /owner-scoped/);
  const many = ['a1', 'a2', 'a3', 'a4', 'a5'].map((owner) => `${owner}/repo`);
  assert.throws(() => credentialPlan({ CAO_GITHUB_AUTH_MODE: 'pat', CAO_GITHUB_READ_PAT_REPOSITORIES: JSON.stringify(Object.fromEntries(many.map((repo) => [repo, ownerPatSecret(repo.split('/')[0])]))) }, many, 'a1/ops'), /at most 4/);
  assert.throws(() => credentialPlan({ CAO_GITHUB_AUTH_MODE: 'workflow-token' }, repositories, 'acme/ops'), /GITHUB_TOKEN can read only/);
  assert.equal(credentialPlan({ CAO_GITHUB_AUTH_MODE: 'workflow-token' }, ['acme/ops'], 'acme/ops').kind, 'workflow-token');
  assert.equal(credentialPlan({}, repositories, 'acme/ops', { secrets: false }).kind, 'deferred');
  assert.throws(() => credentialPlan({}, repositories, 'acme/ops'), /No CAO read authentication/);
  assert.equal(credentialPlan({ CAO_GITHUB_READ_PAT: 'legacy' }, repositories, 'acme/ops').kind, 'legacy-token');
  assert.throws(() => credentialPlan({ CAO_GITHUB_AUTH_MODE: 'oidc' }, repositories, 'acme/ops'), /must be app, pat/);
});

test('PAT-mode collection uses each owner-scoped slot only for that owner and fails closed on a missing slot', async (t) => {
  const map = JSON.stringify({ 'acme/backend': 'GH_AW_GITHUB_READ_PAT_ACME', 'acme/frontend': 'GH_AW_GITHUB_READ_PAT_ACME', 'partner/worker': 'GH_AW_GITHUB_READ_PAT_PARTNER' });
  const env = { CAO_GITHUB_AUTH_MODE: 'pat', CAO_GITHUB_READ_PAT_REPOSITORIES: map, CAO_GITHUB_READ_APP_ID: '', CAO_GITHUB_READ_APP_PRIVATE_KEY: '', CAO_GITHUB_READ_PAT_1: 'pat-acme', CAO_GITHUB_READ_PAT_2: 'pat-partner' };
  const f = fixture(t, { env });
  await f.collect(f.output());
  assert.deepEqual([...f.state.tokenByOwner.acme], ['pat-acme']);
  assert.deepEqual([...f.state.tokenByOwner.partner], ['pat-partner']);
  assert.equal(f.state.minted.length, 0);
  const missing = fixture(t, { env: { ...env, CAO_GITHUB_READ_PAT_2: '' } });
  await assert.rejects(missing.collect(missing.output()), /owner-scoped read PAT for partner/);
  assert.equal(missing.state.calls.some(({ endpoint }) => endpoint.startsWith('repos/acme/backend')), false);
});

test('CLI plan emits only owner secret names and a final status line; failures are one sanitized line', (t) => {
  const f = fixture(t);
  const outputFile = path.join(f.dir, 'github-output');
  writeFileSync(outputFile, '');
  const map = JSON.stringify({ 'acme/backend': 'GH_AW_GITHUB_READ_PAT_ACME', 'acme/frontend': 'GH_AW_GITHUB_READ_PAT_ACME', 'partner/worker': 'GH_AW_GITHUB_READ_PAT_PARTNER' });
  const env = { PATH: process.env.PATH, GITHUB_REPOSITORY: 'acme/ops', GITHUB_OUTPUT: outputFile, CAO_GITHUB_AUTH_MODE: 'pat', CAO_GITHUB_READ_PAT_REPOSITORIES: map };
  const run = spawnSync(process.execPath, [RUNTIME, 'plan', '--root', '.'], { cwd: f.root, env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout.trim().split('\n').at(-1)).status, 'planned');
  const lines = readFileSync(outputFile, 'utf8').trim().split('\n');
  assert.deepEqual(lines, ['pat_secret_1=GH_AW_GITHUB_READ_PAT_ACME', 'pat_secret_2=GH_AW_GITHUB_READ_PAT_PARTNER', 'pat_secret_3=', 'pat_secret_4=']);
  assert.ok(lines.every((line) => /^pat_secret_[1-4]=([A-Z][A-Z0-9_]{0,99})?$/.test(line)));

  f.writePolicy(policyFor({ enabled: false }));
  const failed = spawnSync(process.execPath, [RUNTIME, 'verify', '--root', '.'], { cwd: f.root, env: { ...env, CAO_GITHUB_READ_PAT_1: 'super-secret-pat' }, encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, '');
  assert.equal(failed.stderr.trim().split('\n').length, 1);
  assert.match(failed.stderr, /^cao-farm evidence failed: Squad Advisory is not enabled/);
  assert.equal(failed.stderr.includes('super-secret-pat'), false);
});

test('bundle size bound fits within the native provider maximum', () => {
  assert.ok(WAVE_LIMITS.bundleBytes <= 8388608);
  assert.equal(WAVE_LIMITS.maxAgeMs, 24 * 60 * 60 * 1000);
});
