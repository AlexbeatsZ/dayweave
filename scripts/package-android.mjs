import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

const root = process.cwd();
const windows = process.platform === 'win32';
const debug = process.argv.includes('--debug');
const unsigned = process.argv.includes('--unsigned');
const signAt = process.argv.indexOf('--sign-only');
const signOnly = signAt < 0 ? null : process.argv[signAt + 1];
if (signAt >= 0 && !signOnly) throw new Error('Provide an unsigned APK after --sign-only.');
const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  (windows
    ? path.join(process.env.LOCALAPPDATA, 'Android/Sdk')
    : path.join(os.homedir(), 'Library/Android/sdk'));
const studioJava = windows
  ? 'C:/Program Files/Android/Android Studio/jbr'
  : '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const java =
  process.env.DAYWEAVE_JAVA_HOME ?? (existsSync(studioJava) ? studioJava : process.env.JAVA_HOME);
const env = {
  ...process.env,
  ANDROID_HOME: sdk,
  GRADLE_USER_HOME: process.env.GRADLE_USER_HOME ?? path.join(root, '.local/gradle'),
  ...(java ? { JAVA_HOME: java } : {}),
};
const proxy = env.HTTPS_PROXY ?? env.HTTP_PROXY;
if (proxy) {
  const url = new URL(proxy);
  if (!url.username && !url.password)
    env.GRADLE_OPTS = `${env.GRADLE_OPTS ?? ''} -Dhttps.proxyHost=${url.hostname} -Dhttps.proxyPort=${url.port || 80} -Dhttp.proxyHost=${url.hostname} -Dhttp.proxyPort=${url.port || 80}`;
}
async function run(command, args, cwd = root, customEnv = env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: customEnv,
      stdio: 'inherit',
      windowsHide: true,
      ...(windows && command.endsWith('.bat') ? { shell: true } : {}),
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed (${code})`)),
    );
  });
}
await writeFile(
  path.join(root, 'android/local.properties'),
  `sdk.dir=${sdk.replace(/\\/g, '/').replace(/:/g, '\\:')}\n`,
);
if (!debug && !unsigned) {
  const directory = path.join(root, '.local/android-signing');
  await mkdir(directory, { recursive: true });
  const credentialPath = path.join(directory, 'credentials.json'),
    keystore = path.join(directory, 'dayweave-release.jks');
  let credentials;
  if (existsSync(credentialPath)) credentials = JSON.parse(await readFile(credentialPath, 'utf8'));
  else {
    if (existsSync(keystore))
      throw new Error(
        'Signing key exists without credentials; preserve it and restore credentials.',
      );
    credentials = { password: randomBytes(24).toString('hex') };
    const file = await open(credentialPath, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(credentials));
      await file.sync();
    } finally {
      await file.close();
    }
    if (JSON.parse(await readFile(credentialPath, 'utf8')).password !== credentials.password)
      throw new Error('Signing credentials did not persist; no key generated.');
  }
  if (!existsSync(keystore)) {
    const keytool = java ? path.join(java, `bin/keytool${windows ? '.exe' : ''}`) : 'keytool';
    await run(
      keytool,
      [
        '-genkeypair',
        '-noprompt',
        '-keystore',
        keystore,
        '-storetype',
        'PKCS12',
        '-alias',
        'dayweave',
        '-keyalg',
        'RSA',
        '-keysize',
        '3072',
        '-validity',
        '10000',
        '-dname',
        'CN=Dayweave, O=Dayweave contributors, C=CN',
        '-storepass:env',
        'DAYWEAVE_KEY_PASSWORD',
        '-keypass:env',
        'DAYWEAVE_KEY_PASSWORD',
      ],
      root,
      { ...env, DAYWEAVE_KEY_PASSWORD: credentials.password },
    );
  }
  env.DAYWEAVE_KEYSTORE = keystore;
  env.DAYWEAVE_KEY_PASSWORD = credentials.password;
}
if (!signOnly)
  await run(
    windows ? 'gradlew.bat' : './gradlew',
    [
      '--no-daemon',
      debug ? ':app:assembleDebug' : ':app:assembleRelease',
      debug ? ':app:lintDebug' : ':app:lintRelease',
      ':app:testReleaseUnitTest',
    ],
    path.join(root, 'android'),
  );
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('release', { recursive: true });
const target = `release/Dayweave-${version}-Android${debug ? '-debug' : unsigned ? '-unsigned' : ''}.apk`;
if (signOnly) {
  if (debug || unsigned)
    throw new Error('--sign-only cannot be combined with --debug or --unsigned.');
  const versions = (await readdir(path.join(sdk, 'build-tools')))
    .filter((s) => /^\d+\.\d+\.\d+$/.test(s))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const signer = path.join(
    sdk,
    'build-tools',
    versions.at(-1) ?? '',
    `apksigner${windows ? '.bat' : ''}`,
  );
  await run(signer, [
    'sign',
    '--ks',
    env.DAYWEAVE_KEYSTORE,
    '--ks-key-alias',
    'dayweave',
    '--ks-pass',
    'env:DAYWEAVE_KEY_PASSWORD',
    '--key-pass',
    'env:DAYWEAVE_KEY_PASSWORD',
    '--out',
    path.resolve(target),
    path.resolve(signOnly),
  ]);
  await run(signer, ['verify', '--verbose', path.resolve(target)]);
} else
  await copyFile(
    `android/app/build/outputs/apk/${debug ? 'debug/app-debug' : unsigned ? 'release/app-release-unsigned' : 'release/app-release'}.apk`,
    target,
  );
console.log(`Created ${target}. Signing material remains in ignored .local/ only.`);
