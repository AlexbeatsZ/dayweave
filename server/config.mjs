import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export function checkNode() {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 14 || (minor === 14 && patch < 1))
    throw new Error('Dayweave Server requires Node >=24.14.1 <25; tested with 24.14.1');
}
export async function loadConfig(file) {
  const location = path.resolve(file);
  const value = JSON.parse(await readFile(location, 'utf8'));
  const allowed = ['profile', 'createProfile', 'apiPort', 'discovery', 'hub', 'initialHubPort'];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new Error('Unknown server configuration fields');
  if (typeof value.profile !== 'string' || !value.profile.trim())
    throw new Error('Specify the original Dayweave profile explicitly');
  const config = {
    profile: path.resolve(path.dirname(location), value.profile),
    createProfile: value.createProfile ?? false,
    apiPort: value.apiPort ?? 49731,
    discovery: value.discovery ?? false,
    hub: value.hub ?? 'preserve',
    initialHubPort: value.initialHubPort ?? 49732,
  };
  for (const key of ['apiPort', 'initialHubPort'])
    if (!Number.isInteger(config[key]) || config[key] < 0 || config[key] > 65535)
      throw new Error(`Invalid ${key}`);
  if (
    typeof config.createProfile !== 'boolean' ||
    typeof config.discovery !== 'boolean' ||
    !['preserve', 'enable'].includes(config.hub)
  )
    throw new Error('Invalid server configuration');
  return config;
}
export async function requireExistingProfile(config) {
  if (config.createProfile) return;
  const exists = async (name) => {
    try {
      return (await stat(path.join(config.profile, name))).isFile();
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  };
  if (
    !(await exists('sync.json')) ||
    !(await exists('api.json')) ||
    !((await exists('data.json')) || (await exists('data.backup.json')))
  )
    throw new Error(
      'Existing profile requires sync.json, api.json and data.json or data.backup.json; refusing an empty replacement',
    );
}
