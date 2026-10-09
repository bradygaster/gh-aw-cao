import { realpathSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const CAO_CATALOGS = ['githubnext/gh-aw-cao', 'bradygaster/gh-aw-cao'];

export function resolvePathWithinRoot(root, destination) {
  const resolved = path.resolve(root, destination);
  const canonicalRoot = realpathSync(root);
  let canonicalPath;
  try {
    canonicalPath = realpathSync(resolved);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const missingSegments = [];
    let existingAncestor = resolved;
    while (true) {
      missingSegments.unshift(path.basename(existingAncestor));
      existingAncestor = path.dirname(existingAncestor);
      try {
        canonicalPath = path.join(realpathSync(existingAncestor), ...missingSegments);
        break;
      } catch (ancestorError) {
        if (ancestorError?.code !== 'ENOENT') throw ancestorError;
      }
    }
  }
  const relative = path.relative(canonicalRoot, canonicalPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Installed package destination escapes the repository: ${destination}`);
  }
  return resolved;
}

export async function installedCampaignRecords(root = process.cwd(), { caoOnly = true } = {}) {
  const records = new Map();
  for (const directory of ['campaigns', 'packages']) {
    let recordsDirectory;
    let entries;
    try {
      recordsDirectory = resolvePathWithinRoot(root, path.join('.github', 'aw', directory));
      entries = await readdir(recordsDirectory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory() || !entry.name.endsWith('.json')) continue;
      const recordPath = resolvePathWithinRoot(root, path.join(recordsDirectory, entry.name));
      let record;
      try {
        record = JSON.parse(await readFile(recordPath, 'utf8'));
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error(`${path.relative(root, recordPath)} contains invalid JSON: ${error.message}`);
        throw error;
      }
      const campaignName = typeof record.package === 'string' && record.package.trim()
        ? record.package.trim()
        : typeof record.campaign === 'string' && record.campaign.trim()
          ? record.campaign.trim()
          : typeof record.source === 'string'
            ? record.source.split('@')[0].trim()
            : '';
      if (!campaignName || (caoOnly
        && !CAO_CATALOGS.some((catalog) => campaignName === catalog || campaignName.startsWith(`${catalog}/`)))) {
        continue;
      }
      records.set(campaignName, {
        campaign: campaignName,
        source: typeof record.source === 'string' ? record.source : campaignName,
        resolvedCommit: typeof record.resolvedCommit === 'string' && record.resolvedCommit.trim()
          ? record.resolvedCommit.trim()
          : '',
        record,
        recordPath
      });
    }
  }
  return [...records.values()].sort((left, right) => left.campaign.localeCompare(right.campaign));
}
