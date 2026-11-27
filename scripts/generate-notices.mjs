import fs from 'node:fs';
import path from 'node:path';
const seen = new Set();
let text = fs.readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
text +=
  '\n\n## ActivityWatch Android adaptations - MPL-2.0\n\n' +
  fs.readFileSync('licenses/MPL-2.0.txt', 'utf8');
function include(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const root = path.join('node_modules', name),
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const licenses = fs.readdirSync(root).filter((file) => /^licen[cs]e(?:[.-]|$)/i.test(file));
  if (!licenses.length) throw new Error(`Missing license text for ${name}`);
  text += `\n\n## ${name} ${pkg.version}\n\nLicense: ${pkg.license}. Source: https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${pkg.version}.tgz\n\n`;
  for (const file of licenses) text += fs.readFileSync(path.join(root, file), 'utf8') + '\n';
  for (const dependency of Object.keys(pkg.dependencies ?? {})) include(dependency);
}
for (const name of [
  ...Object.keys(JSON.parse(fs.readFileSync('package.json', 'utf8')).dependencies),
  'react',
  'react-dom',
  'lucide-react',
  '@material/material-color-utilities',
  '@kyralabs/m3e-react',
  '@kyralabs/m3e-css',
  '@fontsource-variable/roboto-flex',
  '@capacitor/core',
  '@capacitor/app',
])
  include(name);
for (const name of [
  '@kyralabs/m3e-react',
  '@kyralabs/m3e-shapes',
  '@kyralabs/m3e-motion',
  '@kyralabs/m3e-css',
  '@kyralabs/m3e-tokens',
]) {
  const notice = path.join('node_modules', name, 'NOTICE');
  if (fs.existsSync(notice))
    text += `\n\n## ${name} NOTICE\n\n${fs.readFileSync(notice, 'utf8')}\n`;
}
text +=
  '\n\n## Google Material Symbols Rounded - Apache-2.0\n\n' +
  fs.readFileSync('node_modules/@material/material-color-utilities/LICENSE', 'utf8');
fs.writeFileSync('THIRD_PARTY_LICENSES.txt', text.trimEnd() + '\n');
console.log(`Collected license texts for ${seen.size} runtime packages.`);
