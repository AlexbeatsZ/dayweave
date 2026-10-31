import { cp, mkdir, readFile, realpath, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { lockProfile } from './runtime.mjs';
import { checkNode, loadConfig, requireExistingProfile } from './config.mjs';

// Offline preparation only: no process/service/task management and no data restore.
try {
  checkNode();
  const args = process.argv.slice(2);
  const take = (name) => {
    const at = args.indexOf(name);
    if (at < 0 || !args[at + 1]) throw new Error(`Missing ${name}`);
    const value = path.resolve(args[at + 1]);
    args.splice(at, 2);
    return value;
  };
  const source = take('--package');
  const current = take('--current');
  const configPath = take('--config');
  const recovery = take('--recovery');
  if (args.length) throw new Error('Unexpected update arguments');
  const config = await loadConfig(configPath);
  if (config.createProfile) throw new Error('Offline migration requires createProfile=false');
  await requireExistingProfile(config);
  const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  if (manifest.name !== 'dayweave-server' || !manifest.version || !manifest.sourceCommit)
    throw new Error('Not a release Dayweave Server package');
  for (const file of ['runtime.mjs', 'server.mjs', 'admin.mjs', 'config.mjs'])
    if (!(await stat(path.join(source, file))).isFile()) throw new Error(`Missing ${file}`);
  const inside = (a, b) => {
    const relative = path.relative(a, b);
    return (
      relative === '' ||
      (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    );
  };
  const canonical = async (file) => {
    try {
      return await realpath(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return path.join(await realpath(path.dirname(file)), path.basename(file));
    }
  };
  const [actualSource, actualCurrent, actualRecovery, actualProfile, actualConfig] =
    await Promise.all([source, current, recovery, config.profile, configPath].map(canonical));
  // All writable targets must be separate from profile/config/source and each other.
  for (const [a, b] of [
    [actualCurrent, actualProfile],
    [actualCurrent, actualSource],
    [actualRecovery, actualProfile],
    [actualRecovery, actualSource],
    [actualRecovery, actualCurrent],
  ])
    if (inside(a, b) || inside(b, a))
      throw new Error('Package, current, recovery and profile directories must be separate');
  if (inside(actualCurrent, actualConfig) || inside(actualRecovery, actualConfig))
    throw new Error('Keep private server.json outside program/recovery directories');
  const unlock = await lockProfile(config.profile);
  try {
    await mkdir(recovery, { recursive: false });
    await cp(config.profile, path.join(recovery, 'profile'), {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: (file) => path.basename(file) !== 'owner.lock',
    });
    const staged = current + '.stage-' + crypto.randomUUID();
    await cp(source, staged, { recursive: true, errorOnExist: true, force: false });
    let previous = false;
    try {
      await rename(current, path.join(recovery, 'program'));
      previous = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await rename(staged, current);
    } catch (error) {
      if (previous) await rename(path.join(recovery, 'program'), current);
      throw error;
    }
    console.log(
      JSON.stringify(
        {
          prepared: true,
          activated: false,
          version: manifest.version,
          profile: config.profile,
          current,
          recovery,
          config: configPath,
        },
        null,
        2,
      ),
    );
  } finally {
    await unlock();
  }
} catch (error) {
  console.error('Dayweave Server update:', error.message);
  process.exitCode = 1;
}
