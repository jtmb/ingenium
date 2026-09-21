#!/usr/bin/env bash
set -euo pipefail

# Human audits maintain the small guards and their positive/negative examples below.
# Scan canonical docs, root/package/service READMEs, AGENTS, and the model table;
# do not whitelist current drift to make this pass. Historical denial/removal prose
# is not a current barrier claim. Extend claim patterns when an audit finds new wording.
# Catalog parity currently exports no counts: derive canonical and active counts from
# its source catalog, using the same name/category-entry convention checked by
# catalog-parity.test.ts.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node - "$REPO_ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.argv[2];
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const errors = [];
const report = (file, line, expected, actual) =>
  errors.push(`${file}:${line}: expected ${expected}; actual ${actual}`);
const lineAt = (text, index) => text.slice(0, index).split('\n').length;
const plain = text => text.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
const historicalRoadmapCountRanges = [
  ['### Consolidated session summary — 2026-09-09', '#### Current-state consolidation overlay — 2026-09-10', '- **Standing instructions:**'],
  ['#### Governance and memory-boundary remediation notes (no new task IDs)', '**Partner-report reconciliation:**', '**Standing instructions (2026-09-09, owner):**'],
];

function isHistoricalRoadmapCountClaim(file, text, index) {
  if (file !== 'docs/reference/ROADMAP.md') return false;
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const lineEnd = text.indexOf('\n', index);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd).trim();
  return historicalRoadmapCountRanges.some(([startMarker, endMarker, claimMarker]) => {
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker, start + startMarker.length);
    return start >= 0 && end > start && lineStart > start && lineStart < end && line.startsWith(claimMarker);
  });
}

function proseFindings(text, counts) {
  const value = plain(text);
  const findings = [];
  const countClaim = /\b(?:291|289)[ -]+(?:[a-z_-]+[ -]+){0,5}(?:tools?|catalog\w*|registrations?|entries|ingenium_)\b|\b31[ -]+(?:baseline[ -]+)?categor(?:y|ies)\b|\b300\s+catalog\w*|\bcatalog\b[^.\n]{0,40}\b291\b/i;
  const retainedEvidence = /\bpass(?:ed|es)?\b[^.\n]{0,200}\b(?:291|289|31)\b/i.test(value);
  if (countClaim.test(value) && !retainedEvidence) findings.push(`${counts.entries} catalog entries / ${counts.server} server registrations / ${counts.categories} categories`);
  const pluginList = /\bships\s+(?:\w+\s+){0,3}plugins\b|\b(?:shipped|registered|configured|loaded|enabled|root)\s+plugins\s*(?:are|include|:|—)|\bplugin list\s*(?:is|includes|:)|\bplugins\s*\((?:observer|resource-sync|auto-observer)/i;
  if (pluginList.test(value)
      && (!value.includes('lifecycle') || !value.includes('ponytail'))) {
    findings.push('plugin list includes lifecycle and ponytail');
  }
  if (/session-id-tui\.ts/.test(value) && /\b(?:registered|loaded|enabled)\b/i.test(value)
      && !/\b(?:not|never|unregistered|removed|absent)\b/i.test(value)) {
    findings.push('session-id-tui.ts is not registered');
  }
  if (/\b(?:lease|credential)\b/i.test(value) && !value.includes('memory:read')
      && (/\b(?:four|4)[ -]scopes?\b/i.test(value)
        || (/\blease\b/i.test(value) && new Set(value.match(/\b[a-z]+:(?:read|write|sync)\b/g)).size === 4
          && ['coordination:read', 'coordination:write', 'projects:read', 'repository:sync'].every(scope => value.includes(scope))))) {
    findings.push('lease scopes include memory:read');
  }
  if (/managed[ -]command.{0,100}(?:denial|deny|denies|barrier|block)/i.test(value)
      && !/\b(?:former|historical|superseded|removed|no|not|never)\b/i.test(value)) {
    findings.push('profile-governed execution, no managed-command denial barrier');
  }
  return findings;
}

function auditModels(text, agents, emit) {
  const seen = new Set();
  let columns;
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim().startsWith('|')) return;
    const cells = line.split('|').slice(1, -1).map(plain);
    if (cells.includes('Agent') && cells.includes('Model') && cells.includes('Variant')) {
      columns = ['Agent', 'Model', 'Variant'].map(name => cells.indexOf(name));
      return;
    }
    if (!columns || cells.every(cell => /^[-:]+$/.test(cell))) return;
    const name = cells[columns[0]]?.replace(/\s*\(built-in\)$/, '');
    const actual = `${cells[columns[1]]} / ${cells[columns[2]]}`;
    if (!Object.hasOwn(agents, name)) emit(index + 1, 'agent present in opencode.json', name);
    else {
      const expected = `${agents[name].model} / ${agents[name].variant ?? '—'}`;
      if (actual !== expected) emit(index + 1, expected, actual);
    }
    if (seen.has(name)) emit(index + 1, 'one model row per agent', `duplicate ${name}`);
    seen.add(name);
  });
  for (const name of Object.keys(agents)) {
    if (!seen.has(name)) emit(1, `model/variant row for ${name}`, 'missing row');
  }
}

const retiredCoordinationCatalogNames = new Set([
  'ingenium_coordination_status',
  'ingenium_coordination_memory_read',
  'ingenium_coordination_update',
  'ingenium_coordination_claim',
  'ingenium_coordination_release',
  'ingenium_coordination_handoff',
]);
const fixtureCounts = { entries: 292, server: 290, categories: 32 };
for (const [startMarker, endMarker, claimMarker] of historicalRoadmapCountRanges) {
  const roadmapFixture = [startMarker, `${claimMarker} Retained 291/289 evidence.`, endMarker, `${claimMarker} Active 291/289 claim.`].join('\n');
  assert.equal(isHistoricalRoadmapCountClaim('docs/reference/ROADMAP.md', roadmapFixture, roadmapFixture.indexOf('Retained 291/289')), true);
  assert.equal(isHistoricalRoadmapCountClaim('docs/reference/ROADMAP.md', roadmapFixture, roadmapFixture.indexOf('Active 291/289')), false);
}
for (const text of [
  '291 tools', '289 server registrations', '289 `ingenium_` entries', '31 baseline categories', '300 catalog entries',
  'Registered plugins: observer, resource-sync',
  'session-id-tui.ts is registered.',
  'The lease has four scopes: coordination:read, coordination:write, projects:read, repository:sync.',
  'The managed-command denial barrier blocks execution.',
]) assert.ok(proseFindings(text, fixtureCounts).length, text);
for (const text of [
  '292 tools / 290 server registrations plus 2 extension tools across 32 baseline categories', 'Timeout: 28800000',
  'The audit passed with 291 catalog entries / 289 server registrations across 31 categories.',
  'Registered plugins: observer, lifecycle, ponytail',
  'session-id-tui.ts is not registered.',
  'The lease scopes include coordination:read, coordination:write, memory:read, projects:read, repository:sync.',
  'The former managed-command denial barrier was removed.',
  'TTL 300,000 ms, claim batches limited to 128 entries.',
  'Root mapping, plugin or MCP changes require restart; load ponytail.',
  'Configured extension plugins call Ingenium MCP from auto-observer.',
  'Observer Plugin (observer.ts) monitors sessions.',
  'The credential scopes are coordination:read, coordination:write, projects:read, repository:sync, documentation:read, rag:read.',
]) assert.deepEqual(proseFindings(text, fixtureCounts), [], text);
const modelFixture = '| Agent | Model | Variant |\n|---|---|---|\n| `plan` (built-in) | `provider/model` | `max` |';
const modelErrors = [];
auditModels(modelFixture, { plan: { model: 'provider/model', variant: 'max' } }, (...error) => modelErrors.push(error));
assert.equal(modelErrors.length, 0);
auditModels(modelFixture, { plan: { model: 'provider/model', variant: 'medium' } }, (...error) => modelErrors.push(error));
assert.equal(modelErrors.length, 1);

function markdownFiles(directory, readmesOnly = false) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !['node_modules', 'dist', '.git', '.next'].includes(entry.name)) return markdownFiles(file, readmesOnly);
    return entry.isFile() && (readmesOnly ? entry.name === 'README.md' : entry.name.endsWith('.md')) ? [file] : [];
  });
}

try {
  const configText = read('opencode.json');
  const config = JSON.parse(configText);
  assert.ok(config.agent && typeof config.agent === 'object' && !Array.isArray(config.agent), 'root agent map must be an object');
  if (Object.hasOwn(config.agent, 'ingenium-llm-broker')) {
    report('opencode.json', lineAt(configText, configText.indexOf('"ingenium-llm-broker"')), 'broker absent from root agent mappings', 'ingenium-llm-broker mapping');
  }
  const catalog = [...read('packages/ingenium-core/lib/tools/mcp-tool-catalog.ts').matchAll(/\bname: "([^"]+)",\s*category: "([^"]+)"/g)]
    .map(([, name, category]) => ({ name, category }));
  assert.ok(catalog.length > 0, 'catalog name/category entries must be readable');
  const counts = {
    entries: catalog.length,
    server: catalog.filter(({ name }) => name.startsWith('ingenium_')).length,
    categories: new Set(catalog.map(({ category }) => category)).size,
  };
  const activeServer = catalog.filter(({ name }) => name.startsWith('ingenium_') && !retiredCoordinationCatalogNames.has(name)).length;
  assert.deepEqual(
    catalog.filter(({ name }) => retiredCoordinationCatalogNames.has(name)),
    [],
    'retired coordination names must stay out of the active catalog',
  );
  assert.equal(activeServer, 284, 'active server registration count must remain 284');
  assert.equal(activeServer + (counts.entries - counts.server), 286, 'active built-in tool count must include two extension tools');
  assert.equal(counts.entries - counts.server, 2, 'catalog must retain 2 extension tools');
  const files = ['README.md', 'AGENTS.md', '.opencode/models.md', ...markdownFiles('docs'), ...markdownFiles('packages', true), ...markdownFiles('services', true)];
  for (const file of files) {
    const text = read(file);
    for (const block of text.matchAll(/\S[^\n]*(?:\n(?!\s*\n)[^\n]*)*/g)) {
      for (const expected of proseFindings(block[0], counts)) {
        const lines = block[0].split('\n');
        const localLine = lines.findIndex(line => proseFindings(line, counts).includes(expected));
        const localIndex = localLine < 1 ? 0 : lines.slice(0, localLine).join('\n').length + 1;
        const findingIndex = block.index + localIndex;
        if (expected === `${counts.entries} catalog entries / ${counts.server} server registrations / ${counts.categories} categories`
            && isHistoricalRoadmapCountClaim(file, text, findingIndex)) continue;
        const actual = localLine < 0 ? plain(block[0]) : plain(lines[localLine]);
        report(file, lineAt(text, findingIndex), expected, actual.length > 500 ? `${actual.slice(0, 500)}…` : actual);
      }
    }
    for (const match of text.matchAll(/"plugins?"\s*:\s*\[([^\]]*)\]/g)) {
      const list = match[1];
      if (!list.includes('lifecycle') || !list.includes('ponytail') || list.includes('session-id-tui.ts')) {
        report(file, lineAt(text, match.index), 'plugin array includes lifecycle and ponytail, excludes session-id-tui.ts', plain(list));
      }
    }
    if (file === '.opencode/models.md') auditModels(text, config.agent, (line, expected, actual) => report(file, line, expected, actual));
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log(`PASS: doc-config audit (${counts.entries} catalog entries / ${activeServer} active server registrations / ${counts.categories} categories / ${activeServer + (counts.entries - counts.server)} active tools)`);
} catch (error) {
  console.error(`tests/test-doc-config-audit.sh:1: expected readable authority and documentation inputs; actual ${error.message}`);
  process.exitCode = 1;
}
NODE
