import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256, validateBuildLock } from './reproducible-linux.mjs';

export function unifiedPatch(before, after, filename = 'Dockerfile') {
  const a = before.trimEnd().split('\n'), b = after.trimEnd().split('\n');
  if (a.length > 4000 || b.length > 4000) throw new Error('Recipe exceeds bounded diff size');
  const matrix = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) matrix[i][j] = a[i] === b[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
  const operations = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { operations.push([' ', a[i]]); i++; j++; }
    else if (i < a.length && (j === b.length || matrix[i + 1][j] >= matrix[i][j + 1])) operations.push(['-', a[i++]]);
    else operations.push(['+', b[j++]]);
  }
  const ranges = [];
  for (const [index, [kind]] of operations.entries()) if (kind !== ' ') {
    const start = Math.max(0, index - 3), end = Math.min(operations.length, index + 4);
    if (ranges.length && start <= ranges.at(-1).end) ranges.at(-1).end = end;
    else ranges.push({ start, end });
  }
  if (!ranges.length) return '';
  const lines = [`diff --git a/${filename} b/${filename}`, `--- a/${filename}`, `+++ b/${filename}`];
  for (const { start, end } of ranges) {
    const oldBefore = operations.slice(0, start).filter(([kind]) => kind !== '+').length;
    const newBefore = operations.slice(0, start).filter(([kind]) => kind !== '-').length;
    const region = operations.slice(start, end);
    const oldCount = region.filter(([kind]) => kind !== '+').length, newCount = region.filter(([kind]) => kind !== '-').length;
    lines.push(`@@ -${oldBefore + (oldCount ? 1 : 0)},${oldCount} +${newBefore + (newCount ? 1 : 0)},${newCount} @@`, ...region.map(([kind, line]) => kind === ' ' && line === '' ? '' : kind + line));
  }
  return lines.join('\n') + '\n';
}

export function recipeRunScripts(text) {
  const lines = text.split('\n'), scripts = [];
  for (let index = 0; index < lines.length; index++) if (lines[index].startsWith('RUN ')) {
    let body = lines[index].slice(4);
    while (body.endsWith('\\')) {
      body = body.slice(0, -1) + '\n' + lines[++index];
    }
    scripts.push(body);
  }
  return scripts;
}
export function prepareDockerfile(originalBytes, lock) {
  validateBuildLock(lock);
  if (!Buffer.isBuffer(originalBytes) || sha256(originalBytes) !== lock.sourceRecipe?.dockerfileSha256) throw new Error('Coordinator Dockerfile differs from reviewed source; rebase explicitly');
  let text = originalBytes.toString('utf8');
  if (text.includes('\r')) throw new Error('Docker recipe must retain reviewed LF bytes');
  const replace = (before, after) => {
    if (text.split(before).length !== 2) throw new Error('Expected exactly one recipe boundary: ' + before.slice(0, 80));
    text = text.replace(before, () => after);
  };
  const guard = '/usr/local/libexec/veyra/reproducible-linux.mjs';
  const manifest = '/usr/local/share/veyra/linux-build.lock.json';
  const bootstrap = `COPY --chown=root:root --chmod=0444 tools/veyra-release/reproducible-linux.mjs ${guard}\nCOPY --chown=root:root --chmod=0444 tools/veyra-release/linux-build.lock.json ${manifest}\nRUN VEYRA_IMAGE_BUILD_CONTEXT=1 node ${guard} configure ${manifest}\n`;
  replace('FROM node:22-slim AS builder\n', `ARG SOURCE_DATE_EPOCH\nFROM ${lock.base.reference} AS builder\n`);
  replace('WORKDIR /app\n\n# Native modules', 'WORKDIR /app\n' + bootstrap + '\n# Native modules');
  replace('RUN apt-get update && apt-get install -y --no-install-recommends \\\n    python3 make g++ ca-certificates && \\\n    rm -rf /var/lib/apt/lists/*', `RUN export VEYRA_IMAGE_BUILD_CONTEXT=1; apt-get update --error-on=any && \\\n    node ${guard} verify-indexes ${manifest} && \\\n    apt-get install -y --no-install-recommends python3 make g++ ca-certificates && \\\n    node ${guard} capture-os ${manifest} /usr/local/share/veyra/builder-os-inputs.json && \\\n    rm -rf /var/lib/apt/lists/*`);
  replace('COPY . .\n', `COPY . .\nARG IMAGE_REVISION\nARG IMAGE_SOURCE_SHA256\nARG SOURCE_DATE_EPOCH\nRUN VEYRA_IMAGE_BUILD_CONTEXT=1 node ${guard} capture-source ${manifest} /usr/local/share/veyra/source-inputs.json\n`);
  replace('FROM node:22-slim AS runtime-base\n', `FROM ${lock.base.reference} AS runtime-base\n${bootstrap}`);
  replace('RUN apt-get update && apt-get install -y --no-install-recommends \\\n    supervisor nginx curl ca-certificates tzdata git acl libcap2-bin libssl3 openssl && \\\n    rm -rf /var/lib/apt/lists/*', `RUN export VEYRA_IMAGE_BUILD_CONTEXT=1; apt-get update --error-on=any && \\\n    node ${guard} verify-indexes ${manifest} && \\\n    apt-get install -y --no-install-recommends \\\n    supervisor nginx curl ca-certificates tzdata git acl libcap2-bin libssl3 openssl && \\\n    rm -rf /var/lib/apt/lists/*`);
  replace('RUN NPM_CONFIG_CACHE=/tmp/ingenium-runtime-npm-cache', `RUN export NPM_CONFIG_CACHE=/tmp/ingenium-runtime-npm-cache NPM_CONFIG_LOGS_DIR=/tmp/ingenium-runtime-npm-logs APPDATA=/tmp/ingenium-runtime-build-appdata LOCALAPPDATA=/tmp/ingenium-runtime-build-localappdata; curl --proto '=https' --tlsv1.2 -fsSL -o /tmp/veyra-npm.tgz '${lock.npm.tarball}' && \\\n    VEYRA_IMAGE_BUILD_CONTEXT=1 node ${guard} verify-npm ${manifest} /tmp/veyra-npm.tgz && \\\n    NPM_CONFIG_CACHE=/tmp/ingenium-runtime-npm-cache`);
  replace('npm install --global --ignore-scripts npm@12.2.1 &&', 'npm install --offline --global --ignore-scripts --no-audit --no-fund /tmp/veyra-npm.tgz &&');
  replace('rm -rf /tmp/ingenium-runtime-npm-cache /tmp/ingenium-runtime-npm-logs /tmp/ingenium-runtime-build-appdata /tmp/ingenium-runtime-build-localappdata', 'rm -rf /tmp/ingenium-runtime-npm-cache /tmp/ingenium-runtime-npm-logs /tmp/ingenium-runtime-build-appdata /tmp/ingenium-runtime-build-localappdata /tmp/veyra-npm.tgz');
  replace('RUN playwright_cli=', 'RUN export VEYRA_IMAGE_BUILD_CONTEXT=1; playwright_cli=');
  replace('node "$playwright_cli" install --with-deps chromium && \\\n', `node "$playwright_cli" install --with-deps chromium && \\\n    node ${guard} verify-indexes ${manifest} && \\\n    node ${guard} capture-os ${manifest} /usr/local/share/veyra/runtime-os-inputs.json && \\\n    rm -rf /var/lib/apt/lists/* && \\\n`);
  replace('# Fail the image build if the copied native binding cannot load on the runtime', 'COPY --from=builder --chown=root:root --chmod=0444 /usr/local/share/veyra/builder-os-inputs.json /usr/local/share/veyra/builder-os-inputs.json\nCOPY --from=builder --chown=root:root --chmod=0444 /usr/local/share/veyra/source-inputs.json /usr/local/share/veyra/source-inputs.json\n# Fail the image build if the copied native binding cannot load on the runtime');
  replace('RUN test -z "$IMAGE_SOURCE_SHA256" || { test "${#IMAGE_SOURCE_SHA256}" -eq 64 && printf \'%s\' "$IMAGE_SOURCE_SHA256" | grep -Eq \'^[0-9a-f]{64}$\'; }', 'RUN test "${#IMAGE_SOURCE_SHA256}" -eq 64 && printf \'%s\' "$IMAGE_SOURCE_SHA256" | grep -Eq \'^[0-9a-f]{64}$\'');
  return text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (![4, 5].includes(process.argv.length) || (process.argv[4] && process.argv[4] !== '--check')) throw new Error('Usage: node linux-recipe-patch.mjs COORDINATOR_DOCKERFILE BUILD_LOCK [--check]');
    const before = fs.readFileSync(process.argv[2]);
    const lock = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    const after = prepareDockerfile(before, lock);
    if (process.argv[4] === '--check') {
      const stages = text => text.split('\n').filter(line => line.startsWith('FROM ')).map(line => line.split(' AS ')[1]);
      if (JSON.stringify(stages(before.toString('utf8'))) !== JSON.stringify(stages(after))) throw new Error('Recipe stage graph changed');
      const scripts = recipeRunScripts(after);
      for (const script of scripts) execFileSync('sh', ['-n'], { input: script, maxBuffer: 1024 * 1024 });
      console.log(JSON.stringify({ sourceDockerfileSha256: sha256(before), stageCount: stages(after).length, shellScriptsSyntaxChecked: scripts.length, buildExecuted: false }));
    } else process.stdout.write(unifiedPatch(before.toString('utf8'), after));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
