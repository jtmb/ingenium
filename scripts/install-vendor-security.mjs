// Build-only overlay. Refuse vendor drift and never change application locks or models.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const staging = process.argv[2];
if (!staging || process.getuid() !== 0) throw new Error('Build-only root staging required');
const manifest = JSON.parse(fs.readFileSync(path.join(staging, 'manifest.json'), 'utf8'));
const roots = ['/usr/local/lib/code-server/node_modules/', '/usr/local/lib/code-server/lib/vscode/node_modules/', '/usr/local/lib/node_modules/npm/node_modules/'];
const semver = createRequire('/usr/local/lib/code-server/package.json')('semver');
const seen = new Set();
for (const [index, item] of manifest.packages.entries()) {
  const target = path.resolve(item.target);
  if (target !== item.target || !roots.some(root => target.startsWith(root)) || seen.has(target)) throw new Error('Unexpected overlay target');
  seen.add(target);
  if (fs.realpathSync(target) !== target || fs.lstatSync(target).isSymbolicLink()) throw new Error('Vendor target must be a real directory');
  const original = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
  const replacement = JSON.parse(fs.readFileSync(path.join(staging, String(index), 'package/package.json'), 'utf8'));
  if (original.name !== item.name || original.version !== item.from || replacement.name !== item.name || replacement.version !== item.version || semver.major(item.from) !== semver.major(item.version)) throw new Error(`Unexpected vendor identity or major API change at ${target}`);
}
// Validate every old identity first: body-parser contains the nested content-type target.
for (const [index, item] of manifest.packages.entries()) {
  if (fs.existsSync(item.target)) fs.rmSync(item.target, {recursive: true});
  fs.mkdirSync(path.dirname(item.target), {recursive: true});
  fs.cpSync(path.join(staging, String(index), 'package'), item.target, {recursive: true, dereference: false});
}
for (const item of manifest.packages) {
  const file = path.join(item.target, 'package.json');
  const require = createRequire(file);
  const installed = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [name, range] of Object.entries(installed.dependencies ?? {})) {
    let directory = path.dirname(require.resolve(name));
    let dependency;
    while (directory !== path.dirname(directory)) {
      const candidate = path.join(directory, 'package.json');
      if (fs.existsSync(candidate)) {
        const value = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (value.name === name) { dependency = value; break; }
      }
      directory = path.dirname(directory);
    }
    if (!dependency || !semver.satisfies(dependency.version, range)) throw new Error(`Unsatisfied vendor dependency ${item.name}: ${name}@${range}`);
  }
}
console.log(`Installed and dependency-verified ${manifest.packages.length} pinned compatible vendor packages`);
