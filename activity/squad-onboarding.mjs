import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { collectFarmEvidence, contentHash, FARM_LIMITS } from './squad-farm.mjs';
import { parsePolicy } from '../.github/workflows/shared/policy.mjs';

export const SQUAD_PACKAGE = 'bradygaster/squad/workflows';
export const SQUAD_OWNERSHIP = '.github/aw/packages/bradygaster-squad-workflows-3632054824e8.json';
export const SQUAD_MANIFEST = '.github/aw/squad-workflows.manifest.json';
export const SQUAD_VERIFIER = '.github/workflows/shared/squad-install-verifier.mjs';
export const SQUAD_RECEIPT = '.github/cao/squad-install.json';
const ROUTER = '.github/skills/agentic-workflows/SKILL.md';
const WORKFLOWS = ['squad', 'squad-bootstrap', 'squad-command-router', 'squad-implement-worker', 'squad-deps-worker', 'squad-review', 'squad-retro', 'squad-improvement-worker'];

function command(execute, root, executable, args) {
  const result = execute(executable, args, {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, SQUAD_GH_AW_SCHEDULE_SEED: 'githubnext/gh-aw-cao' },
  });
  if (result.error || result.status !== 0) {
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
