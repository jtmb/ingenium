import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = path.resolve(apiRoot, '../..');
const domains = ['projects-v2', 'memory-v2', 'customize-v2', 'dot-v2', 'voice-v2'];
const shared = ['veyra-projects', 'veyra-memory', 'veyra-automation', 'veyra-voice', 'veyra-operations'];
// Reviewed singleton only: never discover or copy the release-tools directory.
const singletonTools = [{ source: 'tools/veyra-release/core126-candidate-intent.mjs', target: 'veyra-tools/veyra-release/core126-candidate-intent.mjs' }];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);

/** Compile-time closure only: never reads runtime data or discovers arbitrary files. */
export function planDomainRuntime({ sourceRoot = repository, destination = path.join(apiRoot, 'dist') } = {}) {
  sourceRoot = fs.realpathSync(sourceRoot);
  destination = path.resolve(destination);
  const roots = [
    ...domains.map(name => ({ source: path.join(sourceRoot, 'services/ingenium-api/lib', name), target: path.join(destination, 'lib', name) })),
    ...shared.map(name => ({ source: path.join(sourceRoot, 'packages', name), target: path.join(destination, 'veyra-packages', name) })),
  ].filter(root => fs.existsSync(root.source));
  const files = new Map();
  function add(directory, root) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Runtime closure does not follow symlinks');
      if (entry.isDirectory()) add(full, root);
      else if (entry.isFile() && entry.name.endsWith('.mjs') && !/\.(test|node)\.mjs$/.test(entry.name)) {
        const canonical = fs.realpathSync(full);
        if (!within(root.source, canonical)) throw new Error('Runtime source escaped declared root');
        files.set(canonical, { source: canonical, target: path.join(root.target, path.relative(root.source, canonical)) });
      }
    }
  }
  for (const root of roots) add(root.source, root);
  const sourceOwner = fs.statSync(sourceRoot).uid;
  const checkSingleton = stat => {
    if (!stat.isFile() || stat.isSymbolicLink?.() || stat.nlink !== 1 || !Number.isSafeInteger(sourceOwner) || stat.uid !== sourceOwner || !Number.isSafeInteger(stat.size) || stat.size < 1 || stat.size > 65536) throw new Error('Unsafe reviewed runtime singleton');
  };
  const readSingleton = entry => {
    let fd;
    try {
      if (fs.realpathSync(entry.source) !== entry.source) throw new Error('Runtime singleton aliases another source');
      fd = fs.openSync(entry.source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const first = fs.fstatSync(fd); checkSingleton(first);
      const raw = fs.readFileSync(fd), last = fs.fstatSync(fd), current = fs.lstatSync(entry.source);
      checkSingleton(last); checkSingleton(current);
      if (raw.length !== first.size || fs.realpathSync(entry.source) !== entry.source || ['dev','ino','size','mtimeMs','uid','gid','mode','nlink'].some(key => first[key] !== last[key] || first[key] !== current[key])) throw new Error('Runtime singleton changed during read');
      return raw;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  };
  for (const item of singletonTools) {
    const source = path.join(sourceRoot, ...item.source.split('/'));
    let stat;
    try { stat = fs.lstatSync(source); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    checkSingleton(stat);
    const canonical = fs.realpathSync(source);
    if (canonical !== source || !within(sourceRoot, canonical)) throw new Error('Runtime singleton escaped reviewed source');
    files.set(canonical, { source: canonical, target: path.join(destination, ...item.target.split('/')), singleton: true });
  }
  const planned = [];
  for (const entry of files.values()) {
    const raw = entry.singleton ? readSingleton(entry) : fs.readFileSync(entry.source);
    const text = raw.toString('utf8');
    const syntax = ts.createSourceFile(entry.source, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const replacements = [];
    function reference(specifier) {
      if (!specifier || !ts.isStringLiteralLike(specifier)) throw new Error('Runtime imports must be static strings');
      const value = specifier.text;
      if (value.startsWith('node:') || value === 'ingenium-core') return;
      if (!value.startsWith('.')) throw new Error('Undeclared runtime package import: ' + value);
      const source = path.resolve(path.dirname(entry.source), value);
      const dependency = files.get(source);
      if (!dependency) throw new Error('Runtime import is outside reviewed closure: ' + value);
      let relative = path.relative(path.dirname(entry.target), dependency.target).split(path.sep).join('/');
      if (!relative.startsWith('.')) relative = './' + relative;
      replacements.push({ start: specifier.getStart(syntax), end: specifier.getEnd(), value: JSON.stringify(relative) });
    }
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) reference(node.moduleSpecifier);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length !== 1) throw new Error('Unsupported dynamic runtime import');
        reference(node.arguments[0]);
      }
      ts.forEachChild(node, visit);
    }
    visit(syntax);
    let emitted = text;
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) emitted = emitted.slice(0, replacement.start) + replacement.value + emitted.slice(replacement.end);
    planned.push({ ...entry, sourceSha256: digest(raw), emittedSha256: digest(emitted), emitted });
  }
  return { destination, entries: planned };
}

export function materializeDomainRuntime(plan) {
  const root = plan.destination;
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw new Error('Runtime destination is a symlink');
  fs.mkdirSync(root, { recursive: true });
  if (fs.realpathSync(root) !== root) throw new Error('Runtime destination aliases another directory');
  for (const entry of plan.entries) {
    if (!within(root, entry.target)) throw new Error('Runtime output escaped declared destination');
    const parents = [];
    for (let dir = path.dirname(entry.target); dir !== root; dir = path.dirname(dir)) parents.push(dir);
    for (const parent of parents.reverse()) {
      if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error('Runtime output parent is a symlink');
      fs.mkdirSync(parent, { recursive: true });
    }
    if (fs.existsSync(entry.target) && (!fs.lstatSync(entry.target).isFile() || fs.lstatSync(entry.target).nlink !== 1)) throw new Error('Unsafe existing runtime output');
    fs.writeFileSync(entry.target, entry.emitted);
  }
  const manifest = { schemaVersion: 1, files: plan.entries.map(entry => ({ source: path.relative(repository, entry.source).split(path.sep).join('/'), path: path.relative(root, entry.target).split(path.sep).join('/'), sourceSha256: entry.sourceSha256, emittedSha256: entry.emittedSha256 })) };
  const manifestPath = path.join(root, 'veyra-runtime-closure.json');
  if (fs.existsSync(manifestPath) && (!fs.lstatSync(manifestPath).isFile() || fs.lstatSync(manifestPath).nlink !== 1)) throw new Error('Unsafe existing runtime manifest');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = planDomainRuntime();
  if (process.argv.includes('--check')) console.log(JSON.stringify({ files: plan.entries.length, destination: plan.destination }));
  else console.log(JSON.stringify({ files: materializeDomainRuntime(plan).files.length, destination: plan.destination }));
}