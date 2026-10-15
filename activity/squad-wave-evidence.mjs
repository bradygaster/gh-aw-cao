import { createSign } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { activityCollectionPlan } from './authentication.mjs';
import { collectFarmEvidence, contentHash, farmEnrollment, FARM_LIMITS } from './squad-farm.mjs';
import { parsePolicy } from '../.github/workflows/shared/policy.mjs';

export const WAVE_PROVIDER = '.squad/cao-evidence-provider.json';
export const WAVE_RUNTIME_ROOT = '.squad/cao-evidence-runtime/';
export const WAVE_RUNTIME_FILES = Object.freeze([
  'activity/squad-wave-evidence.mjs', 'activity/squad-farm.mjs', 'activity/authentication.mjs',
  '.github/workflows/shared/policy.mjs', '.github/workflows/shared/setup-github-apps.mjs',
]);
export const WAVE_BUNDLE = '/tmp/gh-aw/agent/cao-farm';
const POLICY = '.github/workflows/cao.json';
const RECEIPT = '.github/cao/squad-install.json';
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;

function safeFile(root, file) {
  if (typeof file !== 'string' || path.isAbsolute(file) || file.includes('\\')
    || file.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Unsafe CAO evidence path');
  let destination = root;
  if (lstatSync(root).isSymbolicLink()) throw new Error('Symlink in CAO evidence root');
  for (const part of file.split('/')) {
    destination = path.join(destination, part);
    try {
      if (lstatSync(destination).isSymbolicLink()) throw new Error('Symlink in CAO evidence path');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return destination;
}

export function waveProviderDocuments(sourceRoot = path.resolve(import.meta.dirname, '..')) {
  const documents = Object.fromEntries(WAVE_RUNTIME_FILES.map((file) => [
    `${WAVE_RUNTIME_ROOT}${file}`, readFileSync(safeFile(sourceRoot, file), 'utf8'),
  ]));
  documents[WAVE_PROVIDER] = `${JSON.stringify({
    schema: 'squad-evidence-provider/v1', kind: 'cao-farm-v1',
    runtime: `${WAVE_RUNTIME_ROOT}${WAVE_RUNTIME_FILES[0]}`,
    runtime_files: Object.fromEntries(Object.entries(documents).map(([file, text]) => [file, contentHash(text)])),
  }, null, 2)}\n`;
  return documents;
}

function positiveInteger(value) {
  return typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
}

export function waveContext(environment = process.env) {
  const { GITHUB_REPOSITORY: repository, SQUAD_WORKFLOW_SHA: revision, SQUAD_ISSUE_NUMBER: issue,
    GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: attempt } = environment;
  if (!REPOSITORY.test(repository ?? '') || ['.', '..'].includes(repository?.split('/')[1])
    || !SHA.test(revision ?? '') || !positiveInteger(issue) || !Number.isSafeInteger(Number(issue))
    || !positiveInteger(runId) || !positiveInteger(attempt)) throw new Error('CAO wave requires trusted workflow, issue, and run identity');
  return { control_repository: repository, workflow_revision: revision, issue_number: Number(issue), run_id: runId, run_attempt: attempt };
}

export function loadWaveAdoption(root, context) {
  const policySource = readFileSync(safeFile(root, POLICY), 'utf8');
  const policy = parsePolicy(policySource);
  const campaign = policy['control-plane']?.campaigns?.['squad-advisory'];
  if (campaign?.enabled !== true || campaign.mode !== 'review'
    || Object.values(campaign.workers ?? {}).some((worker) => worker.enabled !== false)) {
    throw new Error('CAO wave requires enabled review-only Squad adoption with disabled legacy workers');
  }
  const repositories = farmEnrollment(policy, context.control_repository);
  const receipt = JSON.parse(readFileSync(safeFile(root, RECEIPT), 'utf8'));
  const descriptorText = readFileSync(safeFile(root, WAVE_PROVIDER), 'utf8');
  const descriptor = JSON.parse(descriptorText);
  if (receipt.schema !== 'cao-squad-install/v1' || !SHA.test(receipt.source_revision ?? '')
    || JSON.stringify(receipt.repositories) !== JSON.stringify(repositories)
    || descriptor.schema !== 'squad-evidence-provider/v1' || descriptor.kind !== 'cao-farm-v1'
    || descriptor.runtime !== `${WAVE_RUNTIME_ROOT}${WAVE_RUNTIME_FILES[0]}`
    || JSON.stringify(Object.keys(descriptor.runtime_files ?? {}).sort())
      !== JSON.stringify(WAVE_RUNTIME_FILES.map((file) => `${WAVE_RUNTIME_ROOT}${file}`).sort())
    || receipt.files?.[WAVE_PROVIDER] !== contentHash(descriptorText)) throw new Error('CAO wave adoption or provider ownership mismatch');
  for (const [file, hash] of Object.entries(descriptor.runtime_files)) {
    if (!HASH.test(hash) || receipt.files[file] !== hash
      || contentHash(readFileSync(safeFile(root, file))) !== hash) throw new Error('CAO wave runtime integrity mismatch');
  }
  return { policy, repositories, policy_sha256: contentHash(policySource),
    enrollment_sha256: contentHash(JSON.stringify(policy['control-plane'].scope)) };
}

async function boundedJson(response) {
  if (!response.ok || !response.body) throw new Error('CAO evidence GitHub read failed');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > MAX_BUNDLE_BYTES) throw new Error('CAO evidence API response exceeds read bound');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Authentication selection is shared with Activity; the token is never an agent input.
export async function waveReadApi({ policy, context, environment = process.env, fetchImpl = fetch, now = () => new Date() }) {
  const plan = activityCollectionPlan({ allowed_repositories: farmEnrollment(policy, context.control_repository) }, {
    controlRepository: context.control_repository, authMode: environment.GH_AW_GITHUB_AUTH_MODE,
    patRepositoryMap: environment.GH_AW_GITHUB_READ_PAT_REPOSITORIES,
  });
  const base = new URL(environment.GITHUB_API_URL || 'https://api.github.com');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('CAO evidence requires a trusted HTTPS GitHub API');
  const tokens = new Map();
  const secrets = [];
  const issued = [];
  const started = now().getTime();
  let reads = 0;
  const request = async (endpoint, token, method = 'GET', body) => {
    if (++reads > 400 || now().getTime() - started > 5 * 60 * 1000) throw new Error('CAO evidence collection budget exceeded');
    return fetchImpl(`${base.href.replace(/\/$/, '')}/${endpoint}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  };
  const revoke = async () => {
    for (const token of issued) {
      const response = await fetchImpl(`${base.href.replace(/\/$/, '')}/installation/token`, {
        method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      });
      if (!response.ok) throw new Error('CAO evidence read credential revocation failed');
    }
  };
  try {
    const mode = environment.GH_AW_GITHUB_AUTH_MODE || 'workflow-token';
    const patSecrets = mode === 'pat' ? JSON.parse(environment.GH_AW_GITHUB_READ_PAT_SECRETS || '{}') : {};
    for (const group of plan) {
      let token;
      if (mode === 'pat') token = patSecrets[group.secret];
      else if (mode === 'workflow-token') token = environment.GITHUB_TOKEN;
      else {
        const appId = environment.GH_AW_GITHUB_READ_APP_ID;
        const key = environment.GH_AW_GITHUB_READ_APP_PRIVATE_KEY;
        if (!appId || !key) throw new Error('CAO evidence read App credentials unavailable');
        secrets.push(key);
        const issuedAt = Math.floor(now().getTime() / 1000) - 60;
        const input = [Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
          Buffer.from(JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: appId })).toString('base64url')].join('.');
        const jwt = `${input}.${createSign('RSA-SHA256').update(input).sign(key, 'base64url')}`;
        secrets.push(jwt);
        const installation = await boundedJson(await request(`repos/${group.repositories[0]}/installation`, jwt));
        if (!Number.isSafeInteger(installation.id) || installation.id <= 0
          || installation.account?.login?.toLowerCase() !== group.owner.toLowerCase()) throw new Error('CAO evidence read App installation mismatch');
        const result = await boundedJson(await request(`app/installations/${installation.id}/access_tokens`, jwt, 'POST', {
          repositories: group.repositories.map((repository) => repository.split('/')[1]),
          permissions: { contents: 'read', issues: 'read', pull_requests: 'read' },
        }));
        token = result.token;
        if (typeof token === 'string' && token) issued.push(token);
      }
      if (typeof token !== 'string' || !token) throw new Error('CAO evidence selected read credential unavailable');
      secrets.push(token);
      for (const repository of group.repositories) tokens.set(repository.toLowerCase(), token);
    }
  } catch {
    await revoke();
    throw new Error('CAO evidence read authentication unavailable; verify existing CAO Actions credentials');
  }
  return {
    secrets,
    close: revoke,
    async api(endpoint) {
      const repository = endpoint.match(/^repos\/([^/]+\/[^/?]+)(?:\/|$)/)?.[1]?.toLowerCase();
      const token = tokens.get(repository);
      if (!token) throw new Error('CAO evidence read outside exact enrollment');
      return boundedJson(await request(endpoint, token));
    },
  };
}

function validCapture(capturedAt, expiresAt, now) {
  const captured = Date.parse(capturedAt);
  const expires = Date.parse(expiresAt);
  const age = now().getTime() - captured;
  if (!Number.isFinite(age) || age < 0 || age > FARM_LIMITS.maxAgeMs
    || expires !== captured + FARM_LIMITS.maxAgeMs) throw new Error('CAO wave evidence is invalid, future-dated, or stale; run /squad research');
}

export function validateWaveBundle({ bundle = WAVE_BUNDLE, adoption, context, now = () => new Date(), currentRun = false }) {
  const read = (file) => {
    const destination = safeFile(bundle, file);
    const stat = lstatSync(destination);
    if (!stat.isFile() || stat.size > MAX_BUNDLE_BYTES) throw new Error('CAO wave document exceeds file bound');
    return readFileSync(destination);
  };
  const manifest = JSON.parse(read('manifest.json').toString('utf8'));
  if (manifest.schema !== 'cao-squad-wave-evidence/v1' || manifest.control_repository !== context.control_repository
    || manifest.issue_number !== context.issue_number || !SHA.test(manifest.workflow_revision ?? '')
    || !HASH.test(manifest.policy_sha256 ?? '') || manifest.enrollment_sha256 !== adoption.enrollment_sha256
    || !positiveInteger(manifest.run_id) || !positiveInteger(manifest.run_attempt)
    || (currentRun && (manifest.workflow_revision !== context.workflow_revision
      || manifest.policy_sha256 !== adoption.policy_sha256 || manifest.run_id !== context.run_id || manifest.run_attempt !== context.run_attempt))) {
    throw new Error('CAO wave manifest does not match trusted context and enrollment');
  }
  validCapture(manifest.captured_at, manifest.expires_at, now);
  const expected = ['farm/INDEX.md', 'farm/evidence.json', ...adoption.repositories.map((repo) => `farm/${repo}/SNAPSHOT.md`)].sort();
  if (JSON.stringify(Object.keys(manifest.documents ?? {}).sort()) !== JSON.stringify(expected)
    || JSON.stringify(manifest.repositories?.map((record) => record.repository)) !== JSON.stringify(adoption.repositories)
    || manifest.repositories.some((record) => !SHA.test(record.revision ?? '') || record.destination !== `farm/${record.repository}/SNAPSHOT.md`)) {
    throw new Error('CAO wave evidence repository coverage is incomplete');
  }
  let bytes = 0;
  for (const [file, hash] of Object.entries(manifest.documents)) {
    const content = read(file);
    bytes += content.length;
    if (!HASH.test(hash) || contentHash(content) !== hash || bytes > MAX_BUNDLE_BYTES) throw new Error('CAO wave document integrity or size mismatch');
  }
  const actual = [];
  const visit = (directory) => {
    for (const entry of readdirSync(path.join(bundle, directory), { withFileTypes: true })) {
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      safeFile(bundle, relative);
      if (entry.isDirectory()) {
        if (!expected.some((file) => file.startsWith(`${relative}/`))) throw new Error('CAO wave contains unknown files');
        visit(relative);
      }
      else actual.push(relative);
    }
  };
  visit('');
  if (JSON.stringify(actual.sort()) !== JSON.stringify([...expected, 'manifest.json'].sort())) throw new Error('CAO wave contains unknown files');
  const evidence = JSON.parse(read('farm/evidence.json').toString('utf8'));
  if (evidence.schema !== 'cao-squad-farm/v1' || evidence.control_repository !== context.control_repository
    || evidence.enrollment_sha256 !== manifest.enrollment_sha256 || evidence.generated_at !== manifest.captured_at
    || JSON.stringify(evidence.repositories) !== JSON.stringify(manifest.repositories)) throw new Error('CAO wave source manifest mismatch');
  return manifest;
}

export async function collectWaveBundle({ root = process.cwd(), bundle = WAVE_BUNDLE, environment = process.env,
  now = () => new Date(), fetchImpl = fetch, readApi = waveReadApi }) {
  const context = waveContext(environment);
  const adoption = loadWaveAdoption(root, context);
  if (existsSync(bundle)) throw new Error('CAO wave bundle already exists; refusing stale fallback');
  const credential = await readApi({ ...adoption, context, environment, now, fetchImpl });
  let evidence;
  try {
    const control = await credential.api(`repos/${context.control_repository}`);
    if (control.full_name?.toLowerCase() !== context.control_repository.toLowerCase() || control.archived || control.has_issues !== true) {
      throw new Error('CAO wave control repository identity is unsuitable');
    }
    evidence = await collectFarmEvidence({ ...adoption, controlRepository: context.control_repository,
      controlVisibility: control.visibility, api: credential.api, now });
  } finally {
    await credential.close();
  }
  const source = JSON.parse(evidence.documents['farm/evidence.json']);
  const manifest = {
    schema: 'cao-squad-wave-evidence/v1', ...context,
    policy_sha256: adoption.policy_sha256, enrollment_sha256: adoption.enrollment_sha256,
    captured_at: evidence.generatedAt, expires_at: new Date(Date.parse(evidence.generatedAt) + FARM_LIMITS.maxAgeMs).toISOString(),
    repositories: source.repositories,
    documents: Object.fromEntries(Object.entries(evidence.documents).map(([file, text]) => [file, contentHash(text)])),
  };
  validCapture(manifest.captured_at, manifest.expires_at, now);
  const documents = { ...evidence.documents, 'manifest.json': `${JSON.stringify(manifest, null, 2)}\n` };
  const serialized = Object.values(documents).join('');
  if (Buffer.byteLength(serialized) > MAX_BUNDLE_BYTES
    || credential.secrets.some((secret) => serialized.includes(secret))) throw new Error('CAO wave exceeds bundle bound or contains credential material');
  mkdirSync(path.dirname(bundle), { recursive: true, mode: 0o700 });
  const temporary = mkdtempSync(`${bundle}-`);
  try {
    for (const [file, text] of Object.entries(documents)) {
      const destination = safeFile(temporary, file);
      mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, text, { mode: 0o600, flag: 'wx' });
    }
    validateWaveBundle({ bundle: temporary, adoption, context, now, currentRun: true });
    renameSync(temporary, bundle);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  return manifest;
}

// Squad's publication gate restores the bundle outside the Agent job and passes its location.
function validationBundle(environment) {
  const bundle = environment.SQUAD_EVIDENCE_BUNDLE;
  if (bundle === undefined || bundle === '') return WAVE_BUNDLE;
  if (typeof bundle !== 'string' || !path.isAbsolute(bundle) || bundle.includes('\\')
    || path.normalize(bundle) !== bundle || path.parse(bundle).root === bundle) throw new Error('Unsafe CAO evidence bundle path');
  return bundle;
}

export async function runWaveEvidence(args = process.argv.slice(2), { root = process.cwd(), environment = process.env } = {}) {
  if (args.length === 1 && args[0] === '--validate-bundle') {
    const context = waveContext(environment);
    return validateWaveBundle({ bundle: validationBundle(environment), adoption: loadWaveAdoption(root, context), context });
  }
  if (args.length) throw new Error('Unsupported CAO wave evidence arguments');
  return collectWaveBundle({ root, environment });
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  runWaveEvidence().catch(() => {
    console.error('CAO farm evidence preparation failed; research is blocked. Verify reviewed adoption, enrollment, existing CAO read access, and evidence freshness.');
    process.exitCode = 1;
  });
}
