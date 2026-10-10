import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { collectFarmEvidence, contentHash, farmEnrollment, FARM_LIMITS } from '../../activity/squad-farm.mjs';
import { installPreparedSquad, prepareSquadOnboarding, SQUAD_MANIFEST, SQUAD_OWNERSHIP, SQUAD_RECEIPT, SQUAD_VERIFIER } from '../../activity/squad-onboarding.mjs';
import { addCaoCampaign, setCaoCampaignWorkflowsEnabled, updateCaoCampaigns } from '../../activity/cao.mjs';
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
    name, source: `workflows/package/${name}.md`,
    destination: `.github/workflows/${name}.md`, lock: `.github/workflows/${name}.lock.yml`,
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
        write(workflow.destination, `---\nsource: bradygaster/squad/${workflow.source}@${resolved}\n---\n`);
        write(workflow.lock, 'compiled lock');
      }
      write(SQUAD_MANIFEST, JSON.stringify(manifest));
      write(SQUAD_OWNERSHIP, JSON.stringify({
        package: 'bradygaster/squad/workflows', resolvedCommit: resolved,
        files: [{ destination: SQUAD_MANIFEST, sha256: contentHash(JSON.stringify(manifest)) }],
      }));
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
  for (const enabled of [undefined, false, true]) {
  test(`cao ${operation} preserves explicit enabled=${enabled} while disabling legacy workers`, async (t) => {
    const f = fixture(t);
    const previous = process.cwd();
    const order = [];
    const policyPath = path.join(f.root, '.github/workflows/cao.json');
    const configured = structuredClone(policy);
    configured['control-plane'].campaigns = {
      existing: { enabled: false, mode: 'review' },
      'squad-advisory': { ...(enabled === undefined ? {} : { enabled }), mode: 'review', workers: { research: { workflow: 'squad-advisory-research' }, 'farm-snapshot': { workflow: 'squad-advisory-farm-snapshot', 'max-mode': 'review' } } },
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
      assert.equal(saved['control-plane'].campaigns['squad-advisory'].enabled, enabled ?? false);
      assert.deepEqual(saved['control-plane'].campaigns['squad-advisory'].workers, { 'farm-snapshot': { workflow: 'squad-advisory-farm-snapshot', 'max-mode': 'review', enabled: false } });
    } finally {
      process.chdir(previous);
    }
  });
  }
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
  assert.deepEqual(parse(campaignManifest).includes, [
    '.github/workflows/squad-advisory.md',
    '.github/workflows/squad-advisory-farm-snapshot.md',
    'README.md',
  ], 'Squad requires an initialized CAO root and must not reinstall its owned workflows');
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

async function activationFixture(t, options = {}) {
  const f = fixture(t, options);
  const configured = structuredClone(policy);
  configured['control-plane'].campaigns = {
    'squad-advisory': { enabled: options.enabled ?? false, mode: 'review', workers: {
      'farm-snapshot': { workflow: 'squad-advisory-farm-snapshot', enabled: false },
      research: { workflow: 'squad-advisory-research', enabled: false },
    } },
  };
  if (options.rootOnly) configured['control-plane'].campaigns = {};
  const policyPath = path.join(f.root, '.github/workflows/cao.json');
  const save = () => f.write('.github/workflows/cao.json', JSON.stringify(configured));
  save();
  const declaration = { campaign: 'squad-advisory', orchestrator: 'squad-advisory', workers: { 'farm-snapshot': 'squad-advisory-farm-snapshot' } };
  const catalog = options.catalog ?? 'bradygaster/gh-aw-cao';
  if (options.rootOnly) {
    f.write('.github/aw/packages/root.json', JSON.stringify({ source: `${catalog}@main`, resolvedCommit: head, files: [] }));
  } else {
    f.write('squad-advisory/cao.json', JSON.stringify(declaration));
  }
  if (options.owned) {
    installPreparedSquad(await prepareSquadOnboarding({ ...f.options, policy: configured }));
    f.write('.squad/team.md', 'accepted cast');
    f.write('.squad/decisions.md', 'accepted decisions');
  }
  const nativeFiles = [SQUAD_MANIFEST, SQUAD_OWNERSHIP, SQUAD_VERIFIER, SQUAD_RECEIPT,
    '.github/workflows/cao.json', '.github/skills/gh-aw-enlistment/SKILL.md',
    ...manifest.workflows.flatMap((workflow) => [workflow.destination, workflow.lock]),
    ...(options.owned ? Object.keys(JSON.parse(readFileSync(path.join(f.root, SQUAD_RECEIPT), 'utf8')).files) : []),
  ];
  const remote = Object.fromEntries(nativeFiles.filter((file) => existsSync(path.join(f.root, file))).map((file) => [file, readFileSync(path.join(f.root, file))]));
  const remoteWorkflows = manifest.workflows.map((workflow, index) => ({ id: index + 1, path: workflow.lock, state: 'disabled_manually' }));
  remoteWorkflows.push({ id: 99, path: '.github/workflows/squad-advisory-farm-snapshot.lock.yml', state: 'disabled_manually' });
  const calls = [];
  let catalogAdded = false;
  const execute = (executable, args, commandOptions) => {
    calls.push({ executable, args });
    if (executable === 'git' && catalogAdded) return { status: 0, stdout: '?? squad-advisory/cao.json' };
    if (args[0] === 'aw' && args[1] === 'add' && args[2].startsWith(`${catalog}/`)) {
      assert.equal(args[2], `${catalog}/squad-advisory@${head}`);
      assert.equal(args.length, 3);
      catalogAdded = true;
      f.write('squad-advisory/cao.json', JSON.stringify(declaration));
      f.write('.github/aw/packages/squad-advisory.json', JSON.stringify({ source: args[2], resolvedCommit: head, files: [] }));
      f.write('.github/skills/agentic-workflows/SKILL.md', 'new catalog-generated router');
      return { status: 0, stdout: '' };
    }
    const ok = (value) => ({ status: 0, stdout: JSON.stringify(value), stderr: '' });
    if (args[0] === 'repo') return { status: 0, stdout: 'acme/ops', stderr: '' };
    if (args[0] === 'workflow') {
      if (options.failToggle) return { status: 1, stderr: 'denied' };
      return { status: 0, stdout: '' };
    }
    if (args[0] === 'api') {
      if (args[1] === 'repos/acme/ops/branches/main') return ok({ commit: { sha: head } });
      if (args[1] === `repos/acme/ops/git/trees/${head}?recursive=1`) return ok({ tree: Object.keys(remote).map((file) => ({ path: file, type: 'blob' })), truncated: options.truncated });
      if (args[1].startsWith('repos/acme/ops/contents/')) {
        assert.ok(args[1].endsWith(`?ref=${head}`));
        const file = decodeURIComponent(args[1].slice('repos/acme/ops/contents/'.length).split('?')[0]);
        return ok({ type: 'file', encoding: 'base64', content: remote[file].toString('base64') });
      }
      if (args[1].startsWith('repos/acme/ops/actions/workflows?')) {
        assert.deepEqual(args.slice(2), ['--paginate', '--slurp']);
        return ok([{ total_count: options.incompleteInventory ? 100 : remoteWorkflows.length, workflows: remoteWorkflows }]);
      }
    }
    return f.execute(executable, args, commandOptions);
  };
  return {
    ...f, calls, remote, remoteWorkflows, configured, save, policyPath,
    async invoke(action, overrides = {}) {
      const previous = process.cwd();
      try {
        process.chdir(f.root);
        return await setCaoCampaignWorkflowsEnabled(action, ['squad-advisory'], { policyPath, execute, now, ...overrides });
      } finally {
        process.chdir(previous);
      }
    },
    readPolicy: () => JSON.parse(readFileSync(policyPath, 'utf8')),
  };
}

test('enable installs missing native Squad with fresh farm evidence and prepares coherent enabled review policy without remote toggles', async (t) => {
  const f = await activationFixture(t);
  const result = await f.invoke('enable');
  assert.equal(result.nativeSquad.status, 'pending-review');
  assert.equal(result.nativeSquad.remotelyActive, null);
  assert.deepEqual(result.workflows, []);
  assert.ok(existsSync(path.join(f.root, '.github/workflows/squad-bootstrap.lock.yml')));
  assert.ok(existsSync(path.join(f.root, 'farm/evidence.json')));
  const campaign = f.readPolicy()['control-plane'].campaigns['squad-advisory'];
  assert.equal(campaign.enabled, true);
  assert.equal(campaign.mode, 'review');
  assert.ok(Object.values(campaign.workers).every((worker) => worker.enabled === false));
  assert.deepEqual(f.readPolicy()['control-plane'].scope, policy['control-plane'].scope);
  assert.equal(f.calls.filter(({ args }) => args[1] === 'repos/bradygaster/squad/commits/dev').length, 1);
  assert.equal(f.calls.some(({ args }) => args[0] === 'workflow'), false);
  assert.ok(f.calls.find(({ args }) => args.includes('--verify-install')));
});

test('enable of an existing disabled installation refreshes evidence without replacing accepted team artifacts', async (t) => {
  const f = await activationFixture(t, { owned: true });
  f.advance();
  const result = await f.invoke('enable');
  assert.equal(result.nativeSquad.nativeSquad.sourceRevision, 'c'.repeat(40));
  assert.equal(result.nativeSquad.status, 'pending-review');
  assert.equal(readFileSync(path.join(f.root, '.squad/team.md'), 'utf8'), 'accepted cast');
  assert.equal(readFileSync(path.join(f.root, '.squad/decisions.md'), 'utf8'), 'accepted decisions');
  assert.equal(f.calls.some(({ args }) => args[0] === 'workflow'), false);
});

test('enable confirms the complete reviewed default-branch unit before enabling exactly eight native workflows', async (t) => {
  const f = await activationFixture(t, { owned: true, enabled: true });
  const result = await f.invoke('enable');
  assert.equal(result.nativeSquad.status, 'native-workflows-enabled');
  assert.equal(result.nativeSquad.remotelyActive, true);
  assert.equal(result.workflows.length, 8);
  const toggles = f.calls.filter(({ args }) => args[0] === 'workflow');
  assert.deepEqual(toggles.map(({ args }) => args), Array.from({ length: 8 }, (_, i) => ['workflow', 'enable', String(i + 1), '--repo', 'acme/ops']));
  assert.ok(f.calls.findIndex(({ args }) => args.includes('--verify-install')) < f.calls.findIndex(({ args }) => args[0] === 'workflow'));
  assert.ok(f.calls.findLastIndex(({ args }) => args[1]?.startsWith('repos/acme/ops/contents/')) < f.calls.findIndex(({ args }) => args[0] === 'workflow'));
  assert.equal(f.calls.some(({ args }) => args.includes('add') || args.includes('run') || args[1] === 'repos/bradygaster/squad/commits/dev'), false);
  assert.match(result.nativeSquad.next, /does not prove bootstrap/);
});

for (const mismatch of ['missing', 'different', 'missing-workflow']) {
  test(`enable remains pending review for ${mismatch} default-branch evidence without remote mutations`, async (t) => {
    const f = await activationFixture(t, { owned: true, enabled: true });
    if (mismatch === 'missing') delete f.remote['farm/INDEX.md'];
    if (mismatch === 'different') f.remote['farm/INDEX.md'] = Buffer.from('old evidence');
    if (mismatch === 'missing-workflow') f.remoteWorkflows.splice(0, 1);
    const result = await f.invoke('enable');
    assert.equal(result.nativeSquad.status, 'pending-review');
    assert.equal(f.calls.some(({ args }) => args[0] === 'workflow'), false);
  });
}

for (const config of ['matching', 'different', 'local-only', 'remote-only']) {
  test(`activation binds ${config} compiler config to the reviewed default-branch unit`, async (t) => {
    const f = await activationFixture(t, { owned: true, enabled: true });
    const file = '.github/workflows/aw.json';
    const local = '{"maintenance":{"action_failure_issue_expires":24}}\n';
    if (config !== 'remote-only') f.write(file, local);
    if (config !== 'local-only') f.remote[file] = Buffer.from(config === 'different' ? '{"maintenance":{"action_failure_issue_expires":168}}\n' : local);
    const result = await f.invoke('enable');
    assert.equal(result.nativeSquad.status, config === 'matching' ? 'native-workflows-enabled' : 'pending-review');
    assert.equal(f.calls.filter(({ args }) => args[0] === 'workflow').length, config === 'matching' ? 8 : 0);
    if (config === 'matching') {
      assert.ok(f.calls.some(({ args }) => args[1] === `repos/acme/ops/contents/.github/workflows/aw.json?ref=${head}`));
    }
  });
}

test('enable fails closed on stale evidence, changed enrollment, local edits, or incomplete remote inventory', async (t) => {
  for (const reason of ['stale', 'scope', 'owned-edit', 'inventory', 'tree']) {
    const f = await activationFixture(t, { owned: true, enabled: true, incompleteInventory: reason === 'inventory', truncated: reason === 'tree' });
    if (reason === 'scope') { f.configured['control-plane'].scope['allowed-repositories'].pop(); f.save(); }
    if (reason === 'owned-edit') f.write('farm/INDEX.md', 'local changes');
    const overrides = reason === 'stale' ? { now: () => new Date(now().getTime() + FARM_LIMITS.maxAgeMs + 1) } : {};
    await assert.rejects(f.invoke('enable', overrides), /stale|enrollment|ownership conflict|incomplete/);
    assert.equal(f.calls.some(({ args }) => args[0] === 'workflow'), false);
  }
});

test('missing-install activation failure leaves policy untouched and never toggles remote workflows', async (t) => {
  const f = await activationFixture(t, { compiler: 'v0.89.22' });
  const original = readFileSync(f.policyPath, 'utf8');
  await assert.rejects(f.invoke('enable'), /exact CAO compiler/);
  assert.equal(readFileSync(f.policyPath, 'utf8'), original);
  assert.equal(f.calls.some(({ args }) => args[0] === 'workflow' || args[1] === 'add'), false);
});

test('disable targets native workflows rather than legacy jobs and records policy pending review', async (t) => {
  const f = await activationFixture(t, { owned: true, enabled: true });
  const result = await f.invoke('disable');
  assert.equal(result.nativeSquad.status, 'native-workflows-disabled-pending-policy-review');
  assert.equal(result.nativeSquad.remotelyActive, false);
  assert.equal(f.readPolicy()['control-plane'].campaigns['squad-advisory'].enabled, false);
  assert.deepEqual(f.calls.filter(({ args }) => args[0] === 'workflow').map(({ args }) => args), Array.from({ length: 8 }, (_, i) => ['workflow', 'disable', String(i + 1), '--repo', 'acme/ops']));
  assert.equal(f.calls.some(({ args }) => args.includes('add') || args[1] === 'repos/bradygaster/squad/commits/dev'), false);
});

test('disable with no registered native workflows does not install or toggle legacy workers', async (t) => {
  const f = await activationFixture(t);
  f.remoteWorkflows.splice(0, 8);
  const result = await f.invoke('disable');
  assert.deepEqual(result.workflows, []);
  assert.equal(f.calls.some(({ args }) => args[0] === 'workflow' || args[1] === 'add'), false);
  assert.equal(f.readPolicy()['control-plane'].campaigns['squad-advisory'].enabled, false);
});

test('remote toggle failure is not reported as successful native activation', async (t) => {
  const f = await activationFixture(t, { owned: true, enabled: true, failToggle: true });
  await assert.rejects(f.invoke('enable'), /command failed/);
});

test('dirty activation stops before installation, policy writes, and remote toggles', async (t) => {
  const f = await activationFixture(t, { dirty: true });
  const original = readFileSync(f.policyPath, 'utf8');
  await assert.rejects(f.invoke('enable'), /clean committed worktree/);
  assert.equal(readFileSync(f.policyPath, 'utf8'), original);
  assert.equal(f.calls.some(({ args }) => args[0] === 'workflow' || args[1] === 'add' || args[0] === 'api'), false);
});

test('unsupported native Actions states fail before any workflow is toggled', async (t) => {
  const f = await activationFixture(t, { owned: true, enabled: true });
  f.remoteWorkflows[7].state = 'disabled_fork';
  await assert.rejects(f.invoke('enable'), /unsupported Actions state/);
  assert.equal(f.calls.some(({ args }) => args[0] === 'workflow'), false);
});

for (const catalog of ['bradygaster/gh-aw-cao', 'githubnext/gh-aw-cao']) {
  test(`root-only enable installs the campaign at the trusted ${catalog} root pin and native Squad in one reviewed change`, async (t) => {
    const f = await activationFixture(t, { rootOnly: true, catalog });
    const result = await f.invoke('enable');
    assert.equal(result.nativeSquad.status, 'pending-review');
    assert.equal(result.nativeSquad.remotelyActive, null);
    assert.equal(result.nativeSquad.catalogSource, `${catalog}/squad-advisory@${head}`);
    assert.equal(f.readPolicy()['control-plane'].campaigns['squad-advisory'].enabled, true);
    assert.equal(f.readPolicy()['control-plane'].campaigns['squad-advisory'].workers['farm-snapshot'].enabled, false);
    assert.deepEqual(f.readPolicy()['control-plane'].scope, policy['control-plane'].scope);
    assert.ok(existsSync(path.join(f.root, 'farm/evidence.json')));
    assert.ok(existsSync(path.join(f.root, '.github/workflows/squad-bootstrap.lock.yml')));
    assert.equal(f.calls.filter(({ args }) => args[0] === 'status').length, 1);
    assert.deepEqual(f.calls.filter(({ args }) => args[1] === 'add').map(({ args }) => args[2]), [
      `${catalog}/squad-advisory@${head}`, `bradygaster/squad/workflows@${revision}`,
    ]);
    assert.equal(f.calls.filter(({ args }) => args[1] === 'repos/bradygaster/squad/commits/dev').length, 1);
    assert.equal(f.calls.some(({ args }) => args[0] === 'workflow'), false);
  });
}

test('root-only enable rejects missing, untrusted, ambiguous, or unpinned root ownership without side effects', async (t) => {
  for (const invalid of ['missing', 'untrusted', 'ambiguous', 'unpinned']) {
    const f = await activationFixture(t, { rootOnly: true });
    const original = readFileSync(f.policyPath, 'utf8');
    if (invalid === 'missing') rmSync(path.join(f.root, '.github/aw/packages/root.json'));
    if (invalid === 'untrusted') f.write('.github/aw/packages/root.json', JSON.stringify({ source: 'foreign/gh-aw-cao@main', resolvedCommit: head }));
    if (invalid === 'unpinned') f.write('.github/aw/packages/root.json', JSON.stringify({ source: 'bradygaster/gh-aw-cao@main', resolvedCommit: 'main' }));
    if (invalid === 'ambiguous') f.write('.github/aw/packages/second-root.json', JSON.stringify({ source: 'githubnext/gh-aw-cao@main', resolvedCommit: head }));
    await assert.rejects(f.invoke('enable'), /exactly one trusted installed CAO root/);
    assert.equal(readFileSync(f.policyPath, 'utf8'), original);
    assert.equal(f.calls.length, 0);
  }
});

test('root-only native preflight never deletes an existing router or starts either install', async (t) => {
  const f = await activationFixture(t, { rootOnly: true });
  f.write('.github/skills/agentic-workflows/SKILL.md', 'consumer-owned router');
  const original = readFileSync(f.policyPath, 'utf8');
  await assert.rejects(f.invoke('enable'), /existing .*SKILL.md/);
  assert.equal(readFileSync(path.join(f.root, '.github/skills/agentic-workflows/SKILL.md'), 'utf8'), 'consumer-owned router');
  assert.equal(readFileSync(f.policyPath, 'utf8'), original);
  assert.equal(f.calls.some(({ args }) => args[1] === 'add' || args[0] === 'workflow'), false);
});

test('root-only native verification failure leaves campaign policy unchanged and no remote toggles', async (t) => {
  const f = await activationFixture(t, { rootOnly: true, failVerify: true });
  const original = readFileSync(f.policyPath, 'utf8');
  await assert.rejects(f.invoke('enable'), /command failed/);
  assert.equal(readFileSync(f.policyPath, 'utf8'), original);
  assert.equal(f.calls.some(({ args }) => args[0] === 'workflow'), false);
});
