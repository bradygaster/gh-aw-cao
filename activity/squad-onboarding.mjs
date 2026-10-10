import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { collectFarmEvidence, contentHash, farmEnrollment, FARM_LIMITS } from './squad-farm.mjs';
import { parsePolicy } from '../.github/workflows/shared/policy.mjs';
import { CAO_CATALOGS, installedCampaignRecords } from './campaign-records.mjs';

export const SQUAD_PACKAGE = 'bradygaster/squad/workflows';
export const SQUAD_OWNERSHIP = '.github/aw/packages/bradygaster-squad-workflows-3632054824e8.json';
export const SQUAD_MANIFEST = '.github/aw/squad-workflows.manifest.json';
export const SQUAD_VERIFIER = '.github/workflows/shared/squad-install-verifier.mjs';
export const SQUAD_RECEIPT = '.github/cao/squad-install.json';
const ROUTER = '.github/skills/agentic-workflows/SKILL.md';
const COMPILER_CONFIG = '.github/workflows/aw.json';
const WORKFLOWS = ['squad', 'squad-bootstrap', 'squad-command-router', 'squad-implement-worker', 'squad-deps-worker', 'squad-review', 'squad-retro', 'squad-improvement-worker'];

export function setSquadPolicy(policy, enabled = policy['control-plane']?.campaigns?.['squad-advisory']?.enabled ?? false) {
  const campaign = policy['control-plane']?.campaigns?.['squad-advisory'];
  if (!campaign) throw new Error('Squad Advisory must be declared in CAO policy before activation');
  campaign.enabled = enabled;
  campaign.mode = 'review';
  for (const worker of Object.values(campaign.workers ?? {})) worker.enabled = false;
}

function command(execute, root, executable, args) {
  const result = execute(executable, args, {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, SQUAD_GH_AW_SCHEDULE_SEED: 'githubnext/gh-aw-cao' },
  });
  if (result.error || result.status !== 0) {
    if (executable === 'gh' && args[0] === 'workflow') {
      throw new Error(`Squad workflow ${args[1]} command failed for ID ${args[2]}; earlier workflow toggles may have succeeded. Inspect Actions state before retrying; no successful activation is claimed`);
    }
    throw new Error(`Squad prerequisite or installation command failed: ${executable} ${args.slice(0, 2).join(' ')} (exit ${result.status ?? 'unknown'}); inspect locally, do not commit a partial install`);
  }
  return (args[0] === 'aw' && args[1] === 'version'
    ? `${result.stdout || ''}\n${result.stderr || ''}`
    : String(result.stdout || '')).trim();
}

function safePath(root, file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.split('/').some((part) => !part || part === '.' || part === '..') || path.isAbsolute(file)) {
    throw new Error('Unsafe Squad installation destination');
  }
  let current = root;
  for (const segment of file.split('/')) {
    current = path.join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Squad destination has a symlink: ${file}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return current;
}

function destinations(manifest) {
  if (manifest.schema_version !== 2 || manifest.package !== SQUAD_PACKAGE
    || !Array.isArray(manifest.workflows)
    || JSON.stringify(manifest.workflows.map((entry) => entry.name).sort()) !== JSON.stringify([...WORKFLOWS].sort())
    || !Array.isArray(manifest.shared_runtime) || !Array.isArray(manifest.skills)) {
    throw new Error('Unsupported native Squad integrity contract; no installation performed');
  }
  const files = [SQUAD_MANIFEST, SQUAD_OWNERSHIP];
  for (const entry of manifest.workflows) {
    if (entry.destination !== `.github/workflows/${entry.name}.md` || entry.lock !== `.github/workflows/${entry.name}.lock.yml`) throw new Error('Unexpected Squad workflow destination');
    files.push(entry.destination, entry.lock);
  }
  for (const entry of manifest.shared_runtime) files.push(entry.destination, entry.package_destination);
  for (const entry of manifest.skills) files.push(entry.destination);
  if (files.some((file) => typeof file !== 'string' || !file.startsWith('.github/'))) throw new Error('Unexpected Squad resource destination');
  return [...new Set(files)];
}

function readJson(root, file) {
  return JSON.parse(readFileSync(safePath(root, file), 'utf8'));
}

export function squadInventoryWorkflowPaths(root) {
  if (!existsSync(safePath(root, SQUAD_RECEIPT))) return new Set();
  const receipt = readJson(root, SQUAD_RECEIPT);
  const ownership = readJson(root, SQUAD_OWNERSHIP);
  const manifest = readJson(root, SQUAD_MANIFEST);
  destinations(manifest);
  const ownedManifest = ownership.files?.find((file) => file.destination === SQUAD_MANIFEST);
  if (receipt.schema !== 'cao-squad-install/v1' || !/^[0-9a-f]{40}$/.test(receipt.source_revision)
    || ownership.package !== SQUAD_PACKAGE || ownership.resolvedCommit !== receipt.source_revision
    || ownedManifest?.sha256 !== contentHash(readFileSync(safePath(root, SQUAD_MANIFEST)))) {
    throw new Error('Cannot attribute native Squad inventory: installation records disagree');
  }
  for (const workflow of manifest.workflows) {
    const source = readFileSync(safePath(root, workflow.destination), 'utf8');
    if (!source.split(/\r?\n/).includes(`source: ${SQUAD_PACKAGE}@${receipt.source_revision}`)) {
      throw new Error(`Cannot attribute native Squad inventory: source revision differs for ${workflow.name}`);
    }
  }
  return new Set(manifest.workflows.map((workflow) => workflow.destination));
}

function ownedIntegration(root, receipt) {
  if (!receipt) return;
  if (receipt.schema !== 'cao-squad-install/v1' || !receipt.files || !/^[0-9a-f]{40}$/.test(receipt.source_revision)) throw new Error('Invalid CAO Squad receipt');
  for (const [file, hash] of Object.entries(receipt.files)) {
    if (!(file.startsWith('farm/') || file === '.squad/research-scope.json' || file === '.squad/skills/cao-farm/SKILL.md')) throw new Error('Invalid CAO Squad owned path');
    if (!existsSync(safePath(root, file)) || contentHash(readFileSync(safePath(root, file))) !== hash) {
      throw new Error(`CAO Squad evidence ownership conflict: ${file}; preserve and reconcile local changes before update`);
    }
  }
}

export async function prepareSquadOnboarding({ policy, controlRepository, root = process.cwd(), execute = spawnSync, now = () => new Date() }) {
  parsePolicy(JSON.stringify(policy));
  const run = (executable, args) => command(execute, root, executable, args);
  if (run('git', ['status', '--porcelain', '--untracked-files=all'])) throw new Error('Squad onboarding requires a clean committed worktree; no files were changed');
  const api = async (endpoint) => JSON.parse(run('gh', ['api', endpoint]));
  const revision = (await api('repos/bradygaster/squad/commits/dev')).sha;
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('Squad dev did not resolve to an immutable commit');
  const encodedManifest = await api(`repos/bradygaster/squad/contents/workflows/squad-workflows.manifest.json?ref=${revision}`);
  const manifest = JSON.parse(Buffer.from(encodedManifest.content, 'base64').toString('utf8'));
  const files = destinations(manifest);
  const compiler = policy['gh-aw-version'];
  if (manifest.minimum_gh_aw_version !== compiler) {
    throw new Error(`Squad dev ${revision} requires ${manifest.minimum_gh_aw_version}, CAO requires ${compiler}; publish an aligned Squad dev revision before installing`);
  }
  const installedVersion = run('gh', ['aw', 'version']).match(/\bv\d+\.\d+\.\d+(?:-[\w.-]+)?\b/)?.[0];
  if (installedVersion !== compiler) throw new Error(`Squad requires the exact CAO compiler ${compiler}; found ${installedVersion || 'unknown'}`);
  const control = await api(`repos/${controlRepository}`);
  if (control.full_name?.toLowerCase() !== controlRepository.toLowerCase() || !control.default_branch || control.has_issues !== true || control.archived) {
    throw new Error('Squad requires an active operations repository with a default branch and Issues enabled; ask an administrator, no settings were changed');
  }
  if (existsSync(safePath(root, ROUTER))) throw new Error(`Squad conflicts with existing ${ROUTER}; reconcile this consumer-owned skill explicitly`);
  const receipt = existsSync(safePath(root, SQUAD_RECEIPT)) ? readJson(root, SQUAD_RECEIPT) : undefined;
  ownedIntegration(root, receipt);
  const owned = existsSync(safePath(root, SQUAD_OWNERSHIP));
  if (owned !== Boolean(receipt)) throw new Error('Existing Squad installation requires explicit adoption; refusing to take ownership');
  let previousFiles = [];
  if (owned) {
    const oldManifest = readJson(root, SQUAD_MANIFEST);
    previousFiles = destinations(oldManifest);
    run(process.execPath, [SQUAD_VERIFIER, '--verify-install', '--source-revision', receipt.source_revision, '--strict-compile']);
  } else if (existsSync(safePath(root, '.squad'))) {
    throw new Error('Existing .squad state requires explicit adoption; refusing to overwrite a team');
  }
  for (const file of files) {
    if (existsSync(safePath(root, file)) && !previousFiles.includes(file)) throw new Error(`Native Squad ownership conflict: ${file}`);
  }
  if (!receipt && existsSync(safePath(root, 'farm'))) throw new Error('Existing farm/ is not owned by CAO Squad; refusing to overwrite evidence');
  // Unknown files under farm/ are also conflicts, even when ignored by Git.
  if (receipt) {
    const visit = (directory) => {
      for (const entry of readdirSync(safePath(root, directory), { withFileTypes: true })) {
        const file = `${directory}/${entry.name}`;
        safePath(root, file);
        if (entry.isDirectory()) visit(file);
        else if (!(file in receipt.files)) throw new Error(`CAO Squad evidence ownership conflict: ${file}`);
      }
    };
    visit('farm');
  }
  const evidence = await collectFarmEvidence({ policy, controlRepository, controlVisibility: control.visibility, api, now });
  for (const file of [...Object.keys(evidence.documents), '.squad/research-scope.json', '.squad/skills/cao-farm/SKILL.md']) {
    if (existsSync(safePath(root, file)) && !(file in (receipt?.files ?? {}))) throw new Error(`CAO Squad ownership conflict: ${file}`);
  }
  return { revision, compiler, manifest, files, receipt, evidence, root, execute, now };
}

const GUIDANCE = `---
name: cao-farm
description: Farm-wide Squad research, triage, and planning in a CAO operations repository.
---

# Farm-oriented Squad

Read farm/INDEX.md and farm/evidence.json before research, triage, or planning.
Use every enrolled repository, its recorded immutable revision, and its bounded
evidence; do not mistake the operations repository for the product. Check the
24-hour evidence freshness bound and current reviewed CAO enrollment before
starting new research. Stop for missing, stale, or mismatched evidence and ask
the operator to refresh with CAO. Never infer authorization from mirrored files.

Coordinate one farm plan with shared decisions, cross-repository dependencies,
repository-specific execution slices, integration checkpoints, and completion
evidence. Cite farm paths and source revisions. Proposals are not completed
research: begin research with native /squad research, then native triage and plan.

Native issues, implementation, and review are local to this operations repository.
A farm plan never authorizes foreign-repository implementation. CAO reviewed
policy and declared safe outputs remain the authority for any later target work.
Never edit package-owned Squad workflows to implement these instructions.

Farm snapshot PR automation is blocked pending compatible native review
attribution. Refresh via the reviewed CAO installation/update change; do not
forge agent attribution, bypass review, or weaken native Squad review guards.
`;

export function installPreparedSquad(prepared) {
  const { root, execute, revision, evidence, receipt, now } = prepared;
  if (now().getTime() - Date.parse(evidence.generatedAt) > FARM_LIMITS.maxAgeMs) throw new Error('Squad farm evidence expired before installation');
  const run = (executable, args) => command(execute, root, executable, args);
  run('gh', ['aw', 'add', `${SQUAD_PACKAGE}@${revision}`, ...(receipt ? ['--force'] : [])]);
  // gh-aw adds a generic mutable router; preflight established it was absent.
  rmSync(safePath(root, ROUTER), { force: true });
  run(process.execPath, [SQUAD_VERIFIER, '--materialize-runtime']);
  run('gh', ['aw', 'compile', '--strict', '--no-check-update', '--schedule-seed', 'githubnext/gh-aw-cao']);
  run(process.execPath, [SQUAD_VERIFIER, '--verify-install', '--source-revision', revision, '--strict-compile']);
  const documents = {
    ...evidence.documents,
    '.squad/research-scope.json': `${JSON.stringify({ schema: 'squad-research-scope/v1', evidence_roots: ['farm/'], description: 'Cast and research the whole authorized CAO farm. Read farm/INDEX.md and the cao-farm skill; operations infrastructure is not the product.' }, null, 2)}\n`,
    '.squad/skills/cao-farm/SKILL.md': GUIDANCE,
  };
  for (const file of Object.keys(receipt?.files ?? {})) {
    if (!(file in documents)) rmSync(safePath(root, file));
  }
  for (const [file, text] of Object.entries(documents)) {
    const destination = safePath(root, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, text);
  }
  const result = {
    schema: 'cao-squad-install/v1', source_revision: revision, compiler: prepared.compiler,
    evidence_generated_at: evidence.generatedAt, repositories: evidence.repositories,
    files: Object.fromEntries(Object.entries(documents).map(([file, text]) => [file, contentHash(text)])),
  };
  const destination = safePath(root, SQUAD_RECEIPT);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`);
  return { sourceRevision: revision, repositories: evidence.repositories, status: 'prepared-for-review', next: 'Review and commit the complete install, farm evidence, scope, and policy together. Run the native staged-install verifier before committing. Bootstrap starts only after the reviewed default-branch installation push.' };
}

function verifySquadActivation(root, execute, policy, controlRepository, now) {
  const receipt = readJson(root, SQUAD_RECEIPT);
  ownedIntegration(root, receipt);
  const manifest = readJson(root, SQUAD_MANIFEST);
  const files = destinations(manifest);
  command(execute, root, process.execPath, [SQUAD_VERIFIER, '--verify-install', '--source-revision', receipt.source_revision, '--strict-compile']);
  if (manifest.minimum_gh_aw_version !== policy['gh-aw-version'] || receipt.compiler !== policy['gh-aw-version']) throw new Error('Squad activation compiler differs from reviewed CAO policy');
  for (const file of ['farm/INDEX.md', 'farm/evidence.json', '.squad/research-scope.json', '.squad/skills/cao-farm/SKILL.md']) {
    if (!receipt.files[file]) throw new Error(`Squad activation is missing owned evidence: ${file}`);
  }
  const evidence = readJson(root, 'farm/evidence.json');
  const age = now().getTime() - Date.parse(evidence.generated_at);
  if (!Number.isFinite(age) || age < 0 || age > FARM_LIMITS.maxAgeMs) throw new Error('Squad evidence is stale; run cao update and review the fresh evidence before activation');
  const enrollment = farmEnrollment(policy, controlRepository);
  if (evidence.schema !== 'cao-squad-farm/v1' || evidence.control_repository !== controlRepository
    || evidence.enrollment_sha256 !== contentHash(JSON.stringify(policy['control-plane'].scope))
    || JSON.stringify(evidence.repositories?.map((record) => record.repository)) !== JSON.stringify(enrollment)
    || JSON.stringify(receipt.repositories) !== JSON.stringify(enrollment)) {
    throw new Error('Squad farm evidence does not match current authoritative enrollment; refresh before activation');
  }
  for (const record of evidence.repositories) {
    if (!receipt.files[record.destination]) throw new Error(`Squad activation is missing farm coverage for ${record.repository}`);
  }
  return { receipt, files: [...new Set([
    ...files, ...Object.keys(receipt.files), SQUAD_RECEIPT,
    ...(existsSync(safePath(root, COMPILER_CONFIG)) ? [COMPILER_CONFIG] : []),
  ])] };
}

function pendingActivation(extra = {}) {
  return {
    status: 'pending-review', remotelyActive: null, workflows: [], ...extra,
    next: 'Review and commit the native package, policy, farm evidence, scope, and skill together; run the native staged-install verifier. Merge to the default branch to trigger bootstrap, then rerun cao enable squad-advisory to confirm native workflow enablement. No commit, push, or bootstrap dispatch was performed.',
  };
}

export async function installSquadCampaignFromRoot({ addCampaign, policyPath, execute, prepareSquad, installSquad, now }) {
  const roots = (await installedCampaignRecords()).filter((record) => CAO_CATALOGS.includes(record.campaign));
  if (roots.length !== 1 || !/^[0-9a-f]{40}$/i.test(roots[0].resolvedCommit)) {
    throw new Error('Squad activation requires exactly one trusted installed CAO root with an immutable resolvedCommit; install or reconcile the root package first');
  }
  const campaignSpec = `${roots[0].campaign}/squad-advisory@${roots[0].resolvedCommit}`;
  // add prepares native prerequisites while clean, before either package writes.
  const result = await addCampaign(campaignSpec, [], {
    policyPath, execute, installSquad, enableSquad: true,
    prepareSquad: (options) => prepareSquad({ ...options, now }),
  });
  return pendingActivation({ nativeSquad: result.nativeSquad, catalogSource: campaignSpec });
}

export async function activateSquadCampaign(action, {
  policy, policyPath, controlRepository, writePolicy, root = process.cwd(), execute = spawnSync,
  now = () => new Date(), prepareSquad = prepareSquadOnboarding, installSquad = installPreparedSquad,
}) {
  if (!['enable', 'disable'].includes(action)) throw new Error('Squad activation action must be enable or disable');
  parsePolicy(JSON.stringify(policy));
  const run = (executable, args) => command(execute, root, executable, args);
  if (run('git', ['status', '--porcelain', '--untracked-files=all'])) throw new Error('Squad activation requires a clean committed worktree; review and commit pending changes first');
  const campaign = policy['control-plane']?.campaigns?.['squad-advisory'];
  if (!campaign) throw new Error('Squad Advisory must be declared in CAO policy before activation');
  if (action === 'enable' && (!existsSync(safePath(root, SQUAD_RECEIPT)) || campaign.enabled !== true)) {
    const prepared = await prepareSquad({ policy, controlRepository, root, execute, now });
    const nativeSquad = installSquad(prepared);
    setSquadPolicy(policy, true);
    await writePolicy(policyPath, policy);
    return pendingActivation({ nativeSquad });
  }

  const api = (endpoint) => JSON.parse(run('gh', ['api', endpoint]));
  let unit;
  if (action === 'enable') {
    unit = verifySquadActivation(root, execute, policy, controlRepository, now);
    const previous = JSON.stringify(campaign);
    setSquadPolicy(policy, true);
    if (previous !== JSON.stringify(campaign)) {
      await writePolicy(policyPath, policy);
      return pendingActivation();
    }
    const metadata = api(`repos/${controlRepository}`);
    if (metadata.full_name?.toLowerCase() !== controlRepository.toLowerCase() || !metadata.default_branch || metadata.archived || metadata.has_issues !== true) {
      throw new Error('Squad activation requires the active operations repository with Issues and a default branch');
    }
    const branch = api(`repos/${controlRepository}/branches/${encodeURIComponent(metadata.default_branch)}`);
    const head = branch.commit?.sha;
    if (!/^[0-9a-f]{40}$/.test(head)) throw new Error('Squad activation could not resolve an immutable default-branch revision');
    const relativePolicy = path.relative(realpathSync(root), realpathSync(path.resolve(root, policyPath))).split(path.sep).join('/');
    safePath(root, relativePolicy);
    const required = [...unit.files, relativePolicy];
    // One immutable default-branch tree proves the whole reviewed unit landed.
    const tree = api(`repos/${controlRepository}/git/trees/${head}?recursive=1`);
    if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Squad activation default-branch inventory is incomplete');
    const remoteFiles = new Set(tree.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path));
    if (remoteFiles.has(COMPILER_CONFIG) !== unit.files.includes(COMPILER_CONFIG)) return pendingActivation({ defaultBranchRevision: head });
    if (required.some((file) => !remoteFiles.has(file))) return pendingActivation({ defaultBranchRevision: head });
    for (const file of required) {
      const expected = readFileSync(safePath(root, file));
      const remote = api(`repos/${controlRepository}/contents/${file.split('/').map(encodeURIComponent).join('/')}?ref=${head}`);
      if (remote.type !== 'file' || remote.encoding !== 'base64' || typeof remote.content !== 'string') throw new Error(`Squad activation cannot verify reviewed file: ${file}`);
      if (!Buffer.from(remote.content, 'base64').equals(expected)) return pendingActivation({ defaultBranchRevision: head });
    }
  }
  const pages = JSON.parse(run('gh', ['api', `repos/${controlRepository}/actions/workflows?per_page=100`, '--paginate', '--slurp']));
  const workflows = Array.isArray(pages) ? pages.flatMap((page) => page.workflows ?? []) : [];
  if (!Array.isArray(pages) || !pages.length || pages.some((page) => !Array.isArray(page.workflows) || page.total_count !== workflows.length)
    || new Set(workflows.map((workflow) => workflow.id)).size !== workflows.length) {
    throw new Error('Squad workflow inventory is incomplete; no workflow state was changed');
  }
  const native = WORKFLOWS.map((name) => workflows.find((workflow) => workflow.path === `.github/workflows/${name}.lock.yml`)).filter(Boolean);
  if (action === 'enable' && native.length !== WORKFLOWS.length) return pendingActivation();
  if (native.some((workflow) => !Number.isSafeInteger(workflow.id) || !['active', 'disabled_manually', 'disabled_inactivity'].includes(workflow.state))) {
    throw new Error('Squad native workflows have an unsupported Actions state; no workflow state was changed');
  }
  for (const workflow of native) {
    run('gh', ['workflow', action, String(workflow.id), '--repo', controlRepository]);
  }
  if (action === 'disable') {
    setSquadPolicy(policy, false);
    await writePolicy(policyPath, policy);
  }
  return {
    status: action === 'enable' ? 'native-workflows-enabled' : 'native-workflows-disabled-pending-policy-review',
    remotelyActive: action === 'enable',
    workflows: native.map((workflow) => path.basename(workflow.path, '.lock.yml')),
    ...(unit ? { sourceRevision: unit.receipt.source_revision } : {}),
    next: action === 'enable'
      ? 'Native workflow entrypoints are enabled; this does not prove bootstrap or research completed. Follow the Cast PR/Profile A review gates. No bootstrap dispatch was performed.'
      : 'Native workflow entrypoints are disabled. Review and commit the disabled CAO policy. Existing runs are not cancelled; native runtime does not consult the CAO enabled flag.',
  };
}
