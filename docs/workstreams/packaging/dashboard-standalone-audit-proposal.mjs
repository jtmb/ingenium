// PROPOSAL ONLY. No CLI, module evaluation, network, writes, subprocesses or cleanup.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const within = (root, p) => { const r = path.relative(root, p); return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)); };
const demand = (ok, message) => { if (!ok) throw new Error(message); };
function files(root) {
  const out = [];
  const walk = p => {
    const st = fs.lstatSync(p);
    demand(!st.isSymbolicLink(), `Asset symlink requires separate review: ${p}`);
    if (st.isDirectory()) for (const n of fs.readdirSync(p).sort()) walk(path.join(p, n));
    else { demand(st.isFile(), `Nonregular asset: ${p}`); out.push(path.relative(root, p)); }
  };
  walk(root); return out;
}
function sameTree(source, destination) {
  const a = files(source), b = files(destination);
  demand(JSON.stringify(a) === JSON.stringify(b), `Asset file set differs: ${destination}`);
  for (const r of a) demand(sha(path.join(source, r)) === sha(path.join(destination, r)), `Asset differs: ${r}`);
  return { files: a.length, bytes: a.reduce((n, r) => n + fs.statSync(path.join(source, r)).size, 0) };
}
/** Root may invoke AFTER lifetime/admission checks and assembly. This is not runtime acceptance.
 * buildDir: original compiled view dashboard directory; standaloneDir: whole generated standalone root.
 * Both must remain available during reconciliation. Never use this helper to copy or delete anything.
 */
export function inspectStandalone({ buildDir, standaloneDir }) {
  const build = fs.realpathSync(buildDir), deploy = fs.realpathSync(standaloneDir);
  const requiredFile = path.join(build, '.next/required-server-files.json');
  const required = JSON.parse(fs.readFileSync(requiredFile, 'utf8'));
  demand(required.version === 1 && required.config.output === 'standalone', 'Unexpected standalone metadata');
  const tracing = fs.realpathSync(required.config.outputFileTracingRoot);
  demand(!within(tracing, deploy), 'Relocate standalone outside APP before this qualification audit');
  demand(fs.realpathSync(required.appDir) === build, 'Metadata appDir no longer identifies original build');
  demand(required.relativeAppDir === path.relative(tracing, build), 'Metadata relativeAppDir mismatch');
  const serverDir = path.resolve(deploy, required.relativeAppDir);
  demand(within(deploy, serverDir), 'Server directory escapes standalone');
  const entry = path.join(serverDir, 'server.js');
  demand(within(deploy, fs.realpathSync(entry)), 'Entrypoint escapes standalone');
  demand(sha(entry) === '4f26e523194013488284f5f0b6d3d0a69016650876bf78733938098a91b3e761', 'Different generated server: review new receipt');
  let regularFiles = 0, internalLinks = 0;
  const walk = p => {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) { demand(within(deploy, fs.realpathSync(p)), `External/dangling link: ${p}`); internalLinks++; }
    else if (st.isDirectory()) for (const n of fs.readdirSync(p)) walk(path.join(p, n));
    else { demand(st.isFile(), `Nonregular deployable: ${p}`); regularFiles++; }
  };
  walk(deploy);
  // Only Next-produced trace inputs. Do not traverse source dependencies or standalone here.
  const traces = fs.readdirSync(path.join(build, '.next')).filter(n => n.endsWith('.nft.json')).map(n => path.join(build, '.next', n));
  const traceWalk = p => { for (const n of fs.readdirSync(p)) { const q = path.join(p, n), st = fs.lstatSync(q); demand(!st.isSymbolicLink(), `Trace traversal link: ${q}`); if (st.isDirectory()) traceWalk(q); else if (n.endsWith('.nft.json')) traces.push(q); } };
  traceWalk(path.join(build, '.next/server'));
  demand(traces.length > 0, 'No generated traces');
  const checked = new Set();
  for (const trace of traces) {
    const nft = JSON.parse(fs.readFileSync(trace, 'utf8'));
    demand(nft.version === 1 && Array.isArray(nft.files), `Unexpected trace: ${trace}`);
    for (const name of nft.files) {
      demand(typeof name === 'string' && !path.isAbsolute(name), `Invalid trace member: ${trace}`);
      const original = path.resolve(path.dirname(trace), name);
      demand(within(tracing, original), `Trace outside source tracing root: ${original}`);
      const dest = path.resolve(deploy, path.relative(tracing, original));
      demand(within(deploy, dest) && within(deploy, fs.realpathSync(dest)), `Trace missing/escaping: ${dest}`);
      if (!checked.has(original)) {
        demand(fs.statSync(original).isFile() && fs.statSync(dest).isFile(), `Nonfile trace: ${original}`);
        demand(sha(original) === sha(dest), `Trace bytes differ: ${original}`); checked.add(original);
      }
    }
  }
  for (const r of required.files) {
    const original = path.resolve(build, r), dest = path.resolve(serverDir, r);
    demand(within(build, original) && within(deploy, dest), `Required file escapes: ${r}`);
    demand(within(deploy, fs.realpathSync(dest)) && sha(original) === sha(dest), `Required file differs: ${r}`);
  }
  // Native Node resolver only; resolving does not evaluate Next or start a listener.
  const req = createRequire(entry), resolutions = {};
  for (const specifier of ['next', 'next/package.json', 'next/dist/server/lib/start-server']) {
    const resolved = fs.realpathSync(req.resolve(specifier));
    demand(within(deploy, resolved), `Dependency falls through outside standalone: ${specifier} -> ${resolved}`);
    resolutions[specifier] = path.relative(deploy, resolved);
  }
  return { entry: path.relative(deploy, entry), entrySha256: sha(entry), requiredMetadataSha256: sha(requiredFile), traces: traces.length, tracedFiles: checked.size, regularFiles, internalLinks, resolutions,
    public: sameTree(path.join(build, 'public'), path.join(serverDir, 'public')),
    static: sameTree(path.join(build, '.next/static'), path.join(serverDir, '.next/static')),
    runtimeAccepted: false };
}