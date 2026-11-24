import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { existsSync } from 'node:fs';
if (process.platform !== 'darwin') throw new Error('Build macOS packages on a Mac.');
if (process.arch !== 'arm64' || (process.argv[2] && process.argv[2] !== 'arm64'))
  throw new Error('Build macOS packages on an Apple Silicon Mac (arm64 only).');
if (!existsSync('native-bin/work-review-agent'))
  throw new Error('Run npm run build:collector for the selected architecture before packaging.');

// macOS 辅助功能授权绑定代码的 designated requirement：ad-hoc 签名绑 cdhash，
// 每次升级都会失效；固定证书签名绑 identifier + 证书指纹，升级后保持有效。
// CI 没有本机证书，继续 ad-hoc；本机交付构建必须用固定证书。
const adhoc = process.env.CI === 'true' || process.env.DAYWEAVE_MAC_ADHOC === '1';
const identity = process.env.DAYWEAVE_MAC_SIGN_IDENTITY || 'Local Development Code Signing';
if (!adhoc) {
  const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  });
  if (!identities.includes(`"${identity}"`))
    throw new Error(
      `Code signing identity "${identity}" is missing. Recreate it (docs/design/platforms.md) ` +
        'or set DAYWEAVE_MAC_ADHOC=1 for a build whose Accessibility grant may be lost on upgrade.',
    );
}

const require = createRequire(import.meta.url);
const exitCode = await new Promise((resolve) => {
  const child = spawn(
    process.execPath,
    [
      require.resolve('electron-builder/cli.js'),
      '--mac',
      '--arm64',
      '--publish',
      'never',
      `--config.electronDist=${path.join(path.dirname(require.resolve('electron/package.json')), 'dist')}`,
      ...(adhoc ? [] : [`--config.mac.identity=${identity}`, '--config.mac.timestamp=none']),
    ],
    { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } },
  );
  child.on('error', (error) => {
    console.error(error);
    resolve(1);
  });
  child.on('exit', (code) => resolve(code ?? 1));
});
if (exitCode !== 0) process.exit(exitCode);

if (!adhoc) {
  // codesign --verify 对 ad-hoc 也会通过，只有 designated requirement 能证明签名身份。
  const app = 'release/mac-arm64/Dayweave.app';
  const expected = [
    [app, 'org.dayweave.desktop'],
    [`${app}/Contents/Resources/native-bin/work-review-agent`, 'work-review-agent'],
  ];
  execFileSync('codesign', ['--verify', '--strict', '--deep', app], { stdio: 'inherit' });
  for (const [target, identifier] of expected) {
    const requirement = execFileSync('codesign', ['-d', '-r-', target], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (
      !requirement.includes(`identifier "${identifier}"`) ||
      !requirement.includes('certificate leaf')
    )
      throw new Error(`${target} is not signed with a stable identity:\n${requirement}`);
  }
  console.log(`Signed with "${identity}" (stable Accessibility requirement).`);
}
