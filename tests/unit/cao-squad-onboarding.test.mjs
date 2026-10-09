import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { collectFarmEvidence, farmEnrollment, FARM_LIMITS } from '../../activity/squad-farm.mjs';
import { installPreparedSquad, prepareSquadOnboarding, SQUAD_MANIFEST, SQUAD_OWNERSHIP, SQUAD_RECEIPT, SQUAD_VERIFIER } from '../../activity/squad-onboarding.mjs';
import { addCaoCampaign, updateCaoCampaigns } from '../../activity/cao.mjs';
import { planCaoMaterialization } from '../../.github/workflows/shared/materialize-cao.mjs';
import { discoverInventory } from '../../activity/inventory.mjs';
import { parse } from 'yaml';

const revision = 'a'.repeat(40);
const head = 'b'.repeat(40);
const now = () => new Date('2026-10-09T12:00:00Z');
const policy = {
  version: 1, 'gh-aw-version': 'v0.91.5',
  'control-plane': { scope: { 'allowed-owners': ['acme', 'partner'], 'allowed-repositories': ['acme/frontend', 'acme/backend', 'partner/worker'] } },
};
const manifest = {
  schema_version: 2, package: 'bradygaster/squad/workflows', minimum_gh_aw_version: 'v0.91.5',
  workflows: ['squad', 'squad-bootstrap', 'squad-command-router', 'squad-implement-worker', 'squad-deps-worker', 'squad-review', 'squad-retro', 'squad-improvement-worker'].map((name) => ({
    name, destination: `.github/workflows/${name}.md`, lock: `.github/workflows/${name}.lock.yml`,
  })),
  shared_runtime: [{ destination: SQUAD_VERIFIER, package_destination: SQUAD_VERIFIER }],
  skills: [{ destination: '.github/skills/gh-aw-enlistment/SKILL.md' }],
};

function farmApi(endpoint) {
  const repository = policy['control-plane'].scope['allowed-repositories'].find((repo) => endpoint.startsWith(`repos/${repo}`));
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

function fixture(t, options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cao-squad-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = [];
  let resolved = revision;
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  const execute = (executable, args, commandOptions) => {
    calls.push({ executable, args, commandOptions });
    let output = '';
    if (executable === 'git') output = options.dirty ? ' M .github/workflows/squad.md' : '';
    else if (args[0] === 'api') {
      const endpoint = args[1];
      if (endpoint === 'repos/bradygaster/squad/commits/dev') output = JSON.stringify({ sha: resolved });
      else if (endpoint === 'repos/acme/ops') output = JSON.stringify({ full_name: 'acme/ops', default_branch: 'main', has_issues: !options.noIssues, visibility: 'private' });
      else if (endpoint.startsWith('repos/bradygaster/squad/contents/')) {
        assert.ok(endpoint.endsWith(`ref=${resolved}`));
        output = JSON.stringify({ content: Buffer.from(JSON.stringify(options.manifest ?? manifest)).toString('base64') });
      } else output = JSON.stringify((options.api ?? farmApi)(endpoint));
    }     else if (args[0] === 'aw' && args[1] === 'version') return { status: 0, stdout: '', stderr: `gh aw ${options.compiler ?? 'v0.91.5'}` };
    else if (args[0] === 'aw' && args[1] === 'add') {
      assert.equal(args[2], `bradygaster/squad/workflows@${resolved}`);
      for (const workflow of manifest.workflows) {
        write(workflow.destination, 'package source');
        write(workflow.lock, 'compiled lock');
      }
      write(SQUAD_MANIFEST, JSON.stringify(manifest));
      write(SQUAD_OWNERSHIP, 'native-owned-record');
      write(SQUAD_VERIFIER, 'native verifier');
      write('.github/skills/gh-aw-enlistment/SKILL.md', 'native skill');
      write('.github/skills/agentic-workflows/SKILL.md', 'generated router');
    }
    if (options.failVerify && args.includes('--verify-install')) return { status: 1, stdout: '', stderr: 'sensitive diagnostic' };
    return { status: 0, stdout: output, stderr: '' };
  };
  return { root, execute, calls, write, options: { root, execute, policy, controlRepository: 'acme/ops', now }, advance: () => { resolved = 'c'.repeat(40); } };
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

test('incomplete evidence prevents every install side effect', async (t) => {
  const f = fixture(t, { api(endpoint) {
    if (endpoint.startsWith('repos/acme/frontend/languages')) throw new Error('token=do-not-echo');
    return farmApi(endpoint);
  } });
  await assert.rejects(prepareSquadOnboarding(f.options), /incomplete for acme\/frontend/);
  assert.equal(f.calls.some(({ args }) => args.includes('add') || args.includes('compile')), false);
  assert.equal(existsSync(path.join(f.root, 'farm')), false);
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

test('install resolves dev once, verifies the native unit, then writes scope and evidence ready for one reviewed commit', async (t) => {
  const f = fixture(t);
  const prepared = await prepareSquadOnboarding(f.options);
  assert.equal(existsSync(path.join(f.root, 'farm')), false);
  const result = installPreparedSquad(prepared);
  assert.equal(result.status, 'prepared-for-review');
  assert.equal(result.sourceRevision, revision);
  assert.equal(f.calls.filter(({ args }) => args[1] === 'repos/bradygaster/squad/commits/dev').length, 1);
  const mutating = f.calls.filter(({ args }) => args[0] !== 'api' && args[0] !== 'status' && args[1] !== 'version');
  assert.deepEqual(mutating.map(({ args }) => args.slice(0, 2)), [
    ['aw', 'add'], [SQUAD_VERIFIER, '--materialize-runtime'], ['aw', 'compile'], [SQUAD_VERIFIER, '--verify-install'],
  ]);
  assert.ok(mutating.every(({ commandOptions }) => commandOptions.env.SQUAD_GH_AW_SCHEDULE_SEED === 'githubnext/gh-aw-cao'));
  const scope = JSON.parse(readFileSync(path.join(f.root, '.squad/research-scope.json'), 'utf8'));
  assert.deepEqual(scope.evidence_roots, ['farm/']);
  assert.equal(existsSync(path.join(f.root, '.github/skills/agentic-workflows/SKILL.md')), false);
  assert.match(readFileSync(path.join(f.root, '.squad/skills/cao-farm/SKILL.md'), 'utf8'), /foreign-repository implementation/);
});

test('current incompatible dev and wrong local compiler fail before package installation', async (t) => {
  for (const options of [{ manifest: { ...manifest, minimum_gh_aw_version: 'v0.89.22' } }, { compiler: 'v0.89.22' }]) {
    const f = fixture(t, options);
    await assert.rejects(prepareSquadOnboarding(f.options), /requires/);
    assert.equal(f.calls.some(({ args }) => args[1] === 'add'), false);
  }
});

test('Issues must be enabled before any package mutation; settings are never changed', async (t) => {
  const f = fixture(t, { noIssues: true });
  await assert.rejects(prepareSquadOnboarding(f.options), /Issues enabled/);
  assert.equal(f.calls.some(({ args }) => args.includes('add') || args.includes('--method')), false);
});

test('private farm contents cannot be mirrored into public operations repositories', async () => {
  await assert.rejects(collectFarmEvidence({ policy, controlRepository: 'acme/ops', controlVisibility: 'public', api: farmApi, now }), /incomplete/);
});

test('dirty or existing unowned Squad files fail without overwriting', async (t) => {
  for (const file of ['.squad/team.md', '.github/workflows/squad.md', '.github/skills/agentic-workflows/SKILL.md', 'farm/INDEX.md', SQUAD_OWNERSHIP]) {
    const f = fixture(t);
    f.write(file, 'preserve me');
    await assert.rejects(prepareSquadOnboarding(f.options), /conflict|adoption|overwrite/);
    assert.equal(readFileSync(path.join(f.root, file), 'utf8'), 'preserve me');
    assert.equal(f.calls.some(({ args }) => args[1] === 'add'), false);
  }
  const dirty = fixture(t, { dirty: true });
  await assert.rejects(prepareSquadOnboarding(dirty.options), /clean committed worktree/);
  assert.equal(dirty.calls.length, 1);
});

test('destination symlinks are rejected without following them', async (t) => {
  const f = fixture(t);
  mkdirSync(path.join(f.root, '.github'), { recursive: true });
  symlinkSync(f.root, path.join(f.root, '.github/workflows'));
  await assert.rejects(prepareSquadOnboarding(f.options), /symlink/);
});

test('owned update resolves fresh dev, preserves accepted team artifacts, and uses native verifier before forced add', async (t) => {
  const f = fixture(t);
  installPreparedSquad(await prepareSquadOnboarding(f.options));
  f.write('.squad/team.md', 'accepted cast');
  f.write('.squad/decisions.md', 'accepted decisions');
  f.advance();
  f.calls.length = 0;
  const prepared = await prepareSquadOnboarding(f.options);
  const verify = f.calls.find(({ args }) => args.includes('--verify-install'));
  assert.ok(verify.args.includes(revision));
  const result = installPreparedSquad(prepared);
  assert.equal(result.sourceRevision, 'c'.repeat(40));
  assert.equal(f.calls.filter(({ args }) => args[1] === 'repos/bradygaster/squad/commits/dev').length, 1);
  assert.ok(f.calls.find(({ args }) => args[1] === 'add').args.includes('--force'));
  assert.equal(readFileSync(path.join(f.root, '.squad/team.md'), 'utf8'), 'accepted cast');
  assert.equal(readFileSync(path.join(f.root, '.squad/decisions.md'), 'utf8'), 'accepted decisions');
});

test('modified owned evidence, unknown ignored files, and expired collection block updates', async (t) => {
  for (const file of ['farm/INDEX.md', 'farm/unknown.md', '.squad/research-scope.json']) {
    const f = fixture(t);
    installPreparedSquad(await prepareSquadOnboarding(f.options));
    f.write(file, 'user edit');
    f.calls.length = 0;
    await assert.rejects(prepareSquadOnboarding(f.options), /ownership conflict/);
    assert.equal(f.calls.some(({ args }) => args[1] === 'add'), false);
  }
  const f = fixture(t);
  const prepared = await prepareSquadOnboarding(f.options);
  prepared.now = () => new Date(now().getTime() + FARM_LIMITS.maxAgeMs + 1);
  assert.throws(() => installPreparedSquad(prepared), /expired/);
});

test('native verifier failure is explicit and does not publish a successful CAO receipt', async (t) => {
  const f = fixture(t, { failVerify: true });
  const prepared = await prepareSquadOnboarding(f.options);
  assert.throws(() => installPreparedSquad(prepared), /do not commit a partial install/);
  assert.equal(existsSync(path.join(f.root, SQUAD_RECEIPT)), false);
});

test('cao add requires native prerequisites before touching the campaign or policy', async (t) => {
  const f = fixture(t);
  const policyPath = path.join(f.root, '.github/workflows/cao.json');
  f.write('.github/workflows/cao.json', JSON.stringify(policy));
  let calls = 0;
  await assert.rejects(addCaoCampaign('bradygaster/gh-aw-cao/squad-advisory@dev', [], {
    policyPath,
    execute(command, args) {
      calls++;
      assert.deepEqual(args, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
      return { status: 0, stdout: 'acme/ops', stderr: '' };
    },
    prepareSquad: async () => { throw new Error('incomplete farm'); },
  }), /incomplete farm/);
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(readFileSync(policyPath, 'utf8')), policy);
});

for (const operation of ['add', 'update']) {
  test(`cao ${operation} installs native Squad, preserves scope, removes duplicate research and keeps automation disabled`, async (t) => {
    const f = fixture(t);
    const previous = process.cwd();
    const order = [];
    const policyPath = path.join(f.root, '.github/workflows/cao.json');
    const configured = structuredClone(policy);
    configured['control-plane'].campaigns = {
      existing: { enabled: false, mode: 'review' },
      'squad-advisory': { enabled: false, mode: 'review', workers: { research: { workflow: 'squad-advisory-research' }, 'farm-snapshot': { workflow: 'squad-advisory-farm-snapshot', 'max-mode': 'review' } } },
    };
    f.write('.github/workflows/cao.json', JSON.stringify(configured));
    f.write('squad-advisory/cao.json', JSON.stringify({ campaign: 'squad-advisory', orchestrator: 'squad-advisory', workers: { 'farm-snapshot': 'squad-advisory-farm-snapshot' } }));
    const native = { sourceRevision: revision, status: 'prepared-for-review' };
    const recordPath = '.github/aw/packages/fork-squad-advisory.json';
    const campaign = 'bradygaster/gh-aw-cao/squad-advisory';
    const oldRecord = { package: campaign, source: `${campaign}@${head}`, resolvedCommit: head, files: [] };
    if (operation === 'update') f.write(recordPath, JSON.stringify(oldRecord));
    try {
      process.chdir(f.root);
      const options = {
        policyPath,
        execute(executable, args) {
          if (args[0] === 'repo') return { status: 0, stdout: 'acme/ops' };
          if (args[1] === 'version') return { status: 0, stderr: 'gh aw version v0.91.5' };
          if (args[0] === 'api') {
            assert.equal(args[3], `/${'repos/bradygaster/gh-aw-cao'}/commits/${revision}`);
            return { status: 0, stdout: revision };
          }
          order.push(args[0] === 'aw' ? 'campaign' : 'materialize');
          if (args[1] === 'add' && operation === 'update') f.write(recordPath, JSON.stringify({ ...oldRecord, source: `${campaign}@${revision}`, resolvedCommit: revision }));
          return { status: 0, stdout: '' };
        },
        async prepareSquad(args) {
          order.push('prerequisites');
          assert.deepEqual(args.policy['control-plane'].scope, configured['control-plane'].scope);
          return { prepared: true };
        },
        installSquad(prepared) {
          assert.deepEqual(prepared, { prepared: true });
          order.push('native');
          return native;
        },
      };
      const result = operation === 'add'
        ? await addCaoCampaign(`${campaign}@${revision}`, [], options)
        : await updateCaoCampaigns([revision], options);
      assert.deepEqual(order, ['prerequisites', 'campaign', 'materialize', 'native']);
      assert.deepEqual(result.nativeSquad, native);
      const saved = JSON.parse(readFileSync(policyPath, 'utf8'));
      assert.deepEqual(saved['control-plane'].scope, configured['control-plane'].scope);
      assert.deepEqual(saved['control-plane'].campaigns.existing, configured['control-plane'].campaigns.existing);
      assert.equal(saved['control-plane'].campaigns['squad-advisory'].enabled, false);
      assert.deepEqual(saved['control-plane'].campaigns['squad-advisory'].workers, { 'farm-snapshot': { workflow: 'squad-advisory-farm-snapshot', 'max-mode': 'review' } });
    } finally {
      process.chdir(previous);
    }
  });
}

test('materialization accepts only exact trusted fork identity and rejects ambiguous owners', () => {
  const record = { package: 'bradygaster/gh-aw-cao/squad-advisory', resolvedCommit: revision };
  const records = [{ name: record.package, record }];
  assert.equal(planCaoMaterialization(records, 'squad-advisory')[0].record, record);
  assert.throws(() => planCaoMaterialization([{ name: 'untrusted/gh-aw-cao/squad-advisory', record }], 'squad-advisory'), /No installed/);
  assert.throws(() => planCaoMaterialization([...records, { name: 'githubnext/gh-aw-cao/squad-advisory', record }], 'squad-advisory'), /Multiple trusted/);
});

test('fresh installed campaign inventory contains native Squad and never the retained bespoke research source', async (t) => {
  const f = fixture(t);
  const sourceRoot = path.resolve(import.meta.dirname, '../..');
  const campaignManifest = readFileSync(path.join(sourceRoot, 'squad-advisory/aw.yml'), 'utf8');
  const declaration = JSON.parse(readFileSync(path.join(sourceRoot, 'squad-advisory/cao.json'), 'utf8'));
  f.write('squad-advisory/aw.yml', campaignManifest);
  f.write('squad-advisory/cao.json', `${JSON.stringify(declaration)}\n`);
  const installedPolicy = structuredClone(policy);
  installedPolicy['control-plane'].campaigns = {
    'squad-advisory': { enabled: false, mode: 'review', workers: Object.fromEntries(Object.entries(declaration.workers).map(([name, workflow]) => [name, { workflow, 'max-mode': 'review' }])) },
  };
  f.write('.github/workflows/cao.json', JSON.stringify(installedPolicy));
  for (const file of parse(campaignManifest).includes.filter((entry) => entry.startsWith('.github/workflows/'))) {
    f.write(file, readFileSync(path.join(sourceRoot, file), 'utf8'));
  }
  installPreparedSquad(await prepareSquadOnboarding(f.options));
  assert.equal(existsSync(path.join(f.root, '.github/workflows/squad-advisory-research.md')), false);
  const inventory = discoverInventory(f.root, { generatedAt: now().toISOString() });
  const bundle = inventory.bundles.find((entry) => entry.id === 'squad-advisory');
  assert.deepEqual(bundle.workers.map((worker) => worker.id), ['squad-advisory-farm-snapshot']);
  assert.ok(inventory.workflows.some((workflow) => workflow.id === 'squad-bootstrap'));
  assert.equal(inventory.workflows.some((workflow) => workflow.id === 'squad-advisory-research'), false);
});
