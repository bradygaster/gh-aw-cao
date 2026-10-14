#!/usr/bin/env node
// Run-local CAO farm evidence for one native Squad research wave.
// Self-contained: imports only node built-ins and ./squad-farm.mjs so CAO can
// install both files verbatim into an operations repository.
import { createSign, randomUUID } from 'node:crypto';
import { appendFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectFarmEvidence, contentHash, farmEnrollment, FARM_LIMITS } from './squad-farm.mjs';

export const WAVE_SCHEMA = 'cao-squad-wave-evidence/v1';
export const WAVE_OUTPUT = '/tmp/gh-aw/agent/cao-farm';
export const WAVE_MANIFEST = 'manifest.json';
export const WAVE_LIMITS = Object.freeze({ bundleBytes: 4 * 1024 * 1024, responseBytes: 8 * 1024 * 1024, patSlots: 4, maxAgeMs: FARM_LIMITS.maxAgeMs });
const POLICY = '.github/workflows/cao.json';
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;
const SHA = /^[0-9a-f]{40}$/;
const READ_PERMISSIONS = Object.freeze({ contents: 'read', metadata: 'read', issues: 'read', pull_requests: 'read' });

export function ownerPatSecret(owner) {
  return `GH_AW_GITHUB_READ_PAT_${owner.toUpperCase().replaceAll('-', '_')}`;
}

function noSymlinks(base, relative) {
  let current = base;
  for (const segment of relative.split('/')) {
    if (!segment || segment === '.' || segment === '..') throw new Error('unsafe evidence path');
    current = path.join(current, segment);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('evidence path contains a symlink');
  }
  return current;
}

// Only the reviewed policy at the trusted workflow checkout grants farm reach.
export function loadWavePolicy(root, controlRepository) {
  if (!REPOSITORY.test(controlRepository || '')) throw new Error('GITHUB_REPOSITORY must be OWNER/REPOSITORY');
  const text = readFileSync(noSymlinks(root, POLICY), 'utf8');
  let policy;
  try { policy = JSON.parse(text); } catch { throw new Error('CAO policy is not valid JSON'); }
  const campaign = policy?.['control-plane']?.campaigns?.['squad-advisory'];
  if (campaign?.enabled !== true || campaign.mode !== 'review') {
    throw new Error('Squad Advisory is not enabled in review mode in reviewed CAO policy; no evidence collected');
  }
  const repositories = farmEnrollment(policy, controlRepository);
  return { policy, repositories, policySha256: contentHash(text), enrollmentSha256: contentHash(JSON.stringify(policy['control-plane'].scope)) };
}

const owners = (repositories) => [...new Map(repositories.map((repo) => [repo.split('/')[0].toLowerCase(), repo.split('/')[0]])).values()]
  .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

// Mirrors CAO Activity credential resolution; never widens enrollment.
// Planning runs without secrets: it may only name owner-scoped PAT secrets.
export function credentialPlan(env, repositories, controlRepository, { secrets = true } = {}) {
  const mode = env.CAO_GITHUB_AUTH_MODE || '';
  if (mode === 'workflow-token') {
    if (repositories.some((repo) => repo.toLowerCase() !== controlRepository.toLowerCase())) {
      throw new Error('GITHUB_TOKEN can read only the operations repository; configure CAO app or pat read authentication for the farm');
    }
    return { kind: 'workflow-token', slots: [] };
  }
  if (mode === 'pat') {
    let map;
    try { map = JSON.parse(env.CAO_GITHUB_READ_PAT_REPOSITORIES || '{}'); } catch { throw new Error('GH_AW_GITHUB_READ_PAT_REPOSITORIES is not valid JSON'); }
    if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('GH_AW_GITHUB_READ_PAT_REPOSITORIES must map repositories to secret names');
    for (const repo of repositories) {
      if (map[repo] !== ownerPatSecret(repo.split('/')[0])) throw new Error(`${repo} must map to owner-scoped secret ${ownerPatSecret(repo.split('/')[0])}`);
    }
    const slots = owners(repositories);
    if (slots.length > WAVE_LIMITS.patSlots) throw new Error(`PAT-mode research evidence supports at most ${WAVE_LIMITS.patSlots} farm owners`);
    return { kind: 'pat', slots: slots.map((owner) => ({ owner, secret: ownerPatSecret(owner) })) };
  }
  if (mode === 'app' || mode === '') {
    if (!secrets) {
      if (mode === 'app' && !env.CAO_GITHUB_READ_APP_ID) throw new Error('CAO read App credentials are not configured for this workflow');
      return { kind: mode === 'app' ? 'app' : 'deferred', slots: [] };
    }
    if (env.CAO_GITHUB_READ_APP_ID && env.CAO_GITHUB_READ_APP_PRIVATE_KEY) return { kind: 'app', slots: [] };
    if (mode === 'app') throw new Error('CAO read App credentials are not configured for this workflow');
    if (env.CAO_GITHUB_READ_PAT || env.CAO_GITHUB_TOKEN) return { kind: 'legacy-token', slots: [] };
    throw new Error('No CAO read authentication is configured; run CAO setup-auth for the farm');
  }
  throw new Error('GH_AW_GITHUB_AUTH_MODE must be app, pat, or workflow-token');
}

function githubClient(env, fetchImpl) {
  const base = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  if (!/^https:\/\/[^/\s]+(\/[^\s]*)?$/.test(base)) throw new Error('GITHUB_API_URL must be an https URL');
  return async (method, endpoint, token, body) => {
    if (!token) throw new Error('missing read credential');
    const response = await fetchImpl(`${base}/${endpoint}`, {
      method,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'cao-squad-wave-evidence' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    // Never include response bodies in errors; they may echo source content.
    if (!response.ok) throw new Error(`GitHub API ${method} returned ${response.status}`);
    if (text.length > WAVE_LIMITS.responseBytes) throw new Error('GitHub API response exceeded the read bound');
    return text ? JSON.parse(text) : {};
  };
}

function appJwt(appId, privateKey, nowMs) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const seconds = Math.floor(nowMs / 1000);
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: seconds - 60, exp: seconds + 540, iss: String(appId) })}`;
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url')}`;
}

async function resolveTokens(plan, env, repositories, request, now, onSecret) {
  const byOwner = new Map();
  if (plan.kind === 'workflow-token') {
    byOwner.set(repositories[0].split('/')[0].toLowerCase(), env.GITHUB_TOKEN);
  } else if (plan.kind === 'legacy-token') {
    for (const owner of owners(repositories)) byOwner.set(owner.toLowerCase(), env.CAO_GITHUB_READ_PAT || env.CAO_GITHUB_TOKEN);
  } else if (plan.kind === 'pat') {
    plan.slots.forEach(({ owner }, index) => {
      const token = env[`CAO_GITHUB_READ_PAT_${index + 1}`];
      if (!token) throw new Error(`owner-scoped read PAT for ${owner} was not provided to the evidence step`);
      byOwner.set(owner.toLowerCase(), token);
    });
  } else {
    let jwt;
    try { jwt = appJwt(env.CAO_GITHUB_READ_APP_ID, env.CAO_GITHUB_READ_APP_PRIVATE_KEY, now().getTime()); } catch { throw new Error('CAO read App private key is unusable'); }
    for (const owner of owners(repositories)) {
      const names = repositories.filter((repo) => repo.split('/')[0].toLowerCase() === owner.toLowerCase()).map((repo) => repo.split('/')[1]);
      const installation = await request('GET', `repos/${owner}/${names[0]}/installation`, jwt);
      if (!Number.isSafeInteger(installation.id)) throw new Error(`CAO read App is not installed for ${owner}`);
      const minted = await request('POST', `app/installations/${installation.id}/access_tokens`, jwt, { repositories: names, permissions: READ_PERMISSIONS });
      if (typeof minted.token !== 'string' || !minted.token) throw new Error(`CAO read App token unavailable for ${owner}`);
      onSecret(minted.token);
      byOwner.set(owner.toLowerCase(), minted.token);
    }
  }
  return byOwner;
}

function walk(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error('evidence bundle contains a symlink');
    if (entry.isDirectory()) files.push(...walk(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error('evidence bundle contains an unsupported entry');
  }
  return files;
}

// Fail closed unless the bundle is complete, untampered, fresh, and inside current enrollment.
export function verifyWaveBundle({ root, bundle, env = process.env, now = () => new Date() }) {
  const { repositories, enrollmentSha256 } = loadWavePolicy(root, env.GITHUB_REPOSITORY);
  if (!path.isAbsolute(bundle) || lstatSync(bundle, { throwIfNoEntry: false })?.isDirectory() !== true) throw new Error('evidence bundle is missing');
  const files = walk(bundle).sort();
  const manifestText = readFileSync(path.join(bundle, WAVE_MANIFEST), 'utf8');
  let manifest;
  try { manifest = JSON.parse(manifestText); } catch { throw new Error('evidence manifest is not valid JSON'); }
  if (manifest.schema !== WAVE_SCHEMA || manifest.control_repository !== env.GITHUB_REPOSITORY) throw new Error('evidence manifest belongs to a different control repository or schema');
  if (manifest.enrollment_sha256 !== enrollmentSha256 || JSON.stringify(manifest.repositories?.map((record) => record.repository)) !== JSON.stringify(repositories)) {
    throw new Error('evidence does not match current reviewed CAO enrollment; run /squad research again');
  }
  if (!SHA.test(manifest.workflow_sha) || !/^\d+$/.test(String(manifest.run_id)) || !/^\d+$/.test(String(manifest.run_attempt)) || !Number.isSafeInteger(manifest.issue) || manifest.issue < 1) {
    throw new Error('evidence manifest provenance is incomplete');
  }
  const generated = Date.parse(manifest.generated_at);
  const age = now().getTime() - generated;
  if (!Number.isFinite(age) || new Date(generated).toISOString() !== manifest.generated_at || age < 0 || age > WAVE_LIMITS.maxAgeMs) {
    throw new Error('evidence is expired, future-dated, or undated; run /squad research again');
  }
  const documents = manifest.documents ?? {};
  if (JSON.stringify(Object.keys(documents).sort()) !== JSON.stringify(files.filter((file) => file !== WAVE_MANIFEST))) {
    throw new Error('evidence bundle contents differ from its manifest');
  }
  let bytes = Buffer.byteLength(manifestText);
  for (const [file, hash] of Object.entries(documents)) {
    const content = readFileSync(noSymlinks(bundle, file));
    bytes += content.length;
    if (contentHash(content) !== hash) throw new Error('evidence bundle was modified after collection');
  }
  if (bytes > WAVE_LIMITS.bundleBytes || manifest.bundle_bytes !== bytes - Buffer.byteLength(manifestText)) throw new Error('evidence bundle exceeds its size bound');
  for (const record of manifest.repositories) {
    if (!SHA.test(record.revision) || !(record.destination in documents)) throw new Error(`evidence is missing coverage for ${record.repository}`);
  }
  return {
    status: 'verified', schema: WAVE_SCHEMA, manifest_sha256: contentHash(manifestText), generated_at: manifest.generated_at,
    run_id: manifest.run_id, run_attempt: manifest.run_attempt, issue: manifest.issue,
    repositories: manifest.repositories.map(({ repository, revision }) => ({ repository, revision })),
  };
}

export async function collectWaveBundle({ root, output, issue, env = process.env, fetchImpl = globalThis.fetch, now = () => new Date(), onSecret = () => {} }) {
  const controlRepository = env.GITHUB_REPOSITORY;
  const loaded = loadWavePolicy(root, controlRepository);
  const workflowSha = env.GITHUB_WORKFLOW_SHA || env.GITHUB_SHA;
  if (!SHA.test(workflowSha || '') || !/^\d+$/.test(env.GITHUB_RUN_ID || '') || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT || '')) {
    throw new Error('workflow revision and run identity are required');
  }
  if (!Number.isSafeInteger(issue) || issue < 1) throw new Error('a positive research issue number is required');
  if (!path.isAbsolute(output) || lstatSync(output, { throwIfNoEntry: false })) throw new Error('evidence output must be a new absolute directory; stale bundles are never reused');
  const plan = credentialPlan(env, loaded.repositories, controlRepository);
  const request = githubClient(env, fetchImpl);
  const control = await request('GET', `repos/${controlRepository}`, env.GITHUB_TOKEN);
  if (control.full_name?.toLowerCase() !== controlRepository.toLowerCase()
    || (env.GITHUB_EVENT_REPOSITORY_VISIBILITY && env.GITHUB_EVENT_REPOSITORY_VISIBILITY !== control.visibility)) {
    throw new Error('operations repository identity or visibility could not be verified');
  }
  const tokens = await resolveTokens(plan, env, loaded.repositories, request, now, onSecret);
  const staging = `${output}.partial-${randomUUID()}`;
  try {
    const evidence = await collectFarmEvidence({
      policy: loaded.policy, controlRepository, controlVisibility: control.visibility, now,
      api: (endpoint) => request('GET', endpoint, tokens.get(endpoint.split('/')[1]?.toLowerCase())),
    });
    if (JSON.stringify(evidence.repositories) !== JSON.stringify(loaded.repositories)) throw new Error('farm coverage differs from enrollment');
    const documents = {};
    let bytes = 0;
    for (const [file, text] of Object.entries(evidence.documents)) {
      const destination = noSymlinks(staging, file);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, text);
      bytes += Buffer.byteLength(text);
      documents[file] = contentHash(text);
    }
    const farm = JSON.parse(evidence.documents['farm/evidence.json']);
    const manifestText = `${JSON.stringify({
      schema: WAVE_SCHEMA, control_repository: controlRepository, workflow_sha: workflowSha,
      policy_sha256: loaded.policySha256, enrollment_sha256: loaded.enrollmentSha256,
      issue, run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT,
      generated_at: evidence.generatedAt, max_age_seconds: WAVE_LIMITS.maxAgeMs / 1000,
      repositories: farm.repositories, documents, bundle_bytes: bytes,
    }, null, 2)}\n`;
    writeFileSync(path.join(staging, WAVE_MANIFEST), manifestText);
    if (bytes + Buffer.byteLength(manifestText) > WAVE_LIMITS.bundleBytes) throw new Error('evidence bundle exceeds its size bound');
    verifyWaveBundle({ root, bundle: staging, env: { ...env, GITHUB_REPOSITORY: controlRepository }, now });
    renameSync(staging, output);
    return { ...verifyWaveBundle({ root, bundle: output, env, now }), status: 'ready', bundle: output };
  } finally {
    rmSync(staging, { recursive: true, force: true });
    if (plan.kind === 'app') {
      for (const token of tokens.values()) await request('DELETE', 'installation/token', token).catch(() => {});
    }
  }
}

function options(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    if (!['--root', '--output', '--bundle', '--issue'].includes(rest[index]) || rest[index + 1] === undefined || rest[index] in values) throw new Error('unsupported arguments');
    values[rest[index]] = rest[index + 1];
  }
  return { command, root: realpathSync(values['--root'] ?? '.'), output: values['--output'], bundle: values['--bundle'], issue: values['--issue'] };
}

export async function runWaveEvidence(argv, { env = process.env, fetchImpl = globalThis.fetch, now = () => new Date(), onSecret = () => {} } = {}) {
  const parsed = options(argv);
  if (parsed.command === 'plan') {
    const { repositories } = loadWavePolicy(parsed.root, env.GITHUB_REPOSITORY);
    const plan = credentialPlan(env, repositories, env.GITHUB_REPOSITORY, { secrets: false });
    const lines = Array.from({ length: WAVE_LIMITS.patSlots }, (_, index) => `pat_secret_${index + 1}=${plan.slots[index]?.secret ?? ''}`);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
    return { status: 'planned', credential: plan.kind, owners: plan.slots.length || owners(repositories).length, repositories };
  }
  if (parsed.command === 'collect') {
    if (!/^\d+$/.test(parsed.issue ?? '')) throw new Error('a positive research issue number is required');
    return collectWaveBundle({ root: parsed.root, output: parsed.output ?? WAVE_OUTPUT, issue: Number(parsed.issue), env, fetchImpl, now, onSecret });
  }
  if (parsed.command === 'verify') return verifyWaveBundle({ root: parsed.root, bundle: parsed.bundle ?? WAVE_OUTPUT, env, now });
  throw new Error('usage: squad-wave-evidence.mjs plan|collect|verify --root DIR [--output DIR --issue N | --bundle DIR]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // Squad forwards only ::add-mask:: lines; the last stdout line is the status JSON.
  runWaveEvidence(process.argv.slice(2), { onSecret: (value) => process.stdout.write(`::add-mask::${value}\n`) }).then(
    (result) => { process.stdout.write(`${JSON.stringify(result)}\n`); },
    (error) => { process.stderr.write(`cao-farm evidence failed: ${String(error.message).split('\n')[0].slice(0, 300)}\n`); process.exitCode = 1; },
  );
}
