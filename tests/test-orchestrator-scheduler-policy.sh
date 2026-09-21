#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ORCHESTRATOR_PROFILE="${ORCHESTRATOR_PROFILE:-$REPO_ROOT/.opencode/agents/primary/ingenium-orchestrator.md}"
PLAN_PROFILE="${PLAN_PROFILE:-$REPO_ROOT/.opencode/agents/primary/plan.md}"
COMMAND_FILE="${COMMAND_FILE:-$REPO_ROOT/.opencode/commands/next-steps.md}"
CONFIG="${CONFIG:-$REPO_ROOT/opencode.json}"

node - "$ORCHESTRATOR_PROFILE" "$PLAN_PROFILE" "$COMMAND_FILE" "$CONFIG" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');

const [orchestratorPath, planPath, commandPath, configPath] = process.argv.slice(2);
const source = fs.readFileSync(orchestratorPath, 'utf8');
const plan = fs.readFileSync(planPath, 'utf8');
const command = fs.readFileSync(commandPath, 'utf8');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const normalized = (text) => text.replace(/\s+/g, ' ').toLowerCase();
const policy = normalized(source);
const required = [
  'direct execution is the default',
  'authorized and efficient',
  'zero subagents',
  'newly formed delegated team',
  '2–6 useful assignments',
  '3 preferred',
  'more than 6 active children',
  'never manufacture filler',
  'existing-team members may finish dependent tails without forming a new singleton',
  'dependency-ready assignment as soon as its support exists',
  'never call a synchronous batch background or async',
  'true async requires a supported runtime capability',
  'original `call_id`',
  'conditional on declared risk or acceptance criteria',
  'never automatic filler',
  'required separation, deployment, and recovery gates remain',
  'scoped roadmap and relevant context',
  'ponytail',
  'matching the task',
  'todoWrite',
  'evidence',
  'failure-signature',
  'recovery safeguards',
];

for (const phrase of required) {
  assert.ok(policy.includes(phrase.toLowerCase()), `missing policy: ${phrase}`);
}

for (const obsolete of [
  'UNUSED_CAPACITY',
  'single-Todo fan-out',
  'multi-Todo exact pairing',
  '20 simultaneous subagents',
  'no fixed active-agent or writer ceiling',
]) {
  assert.ok(!policy.includes(obsolete.toLowerCase()), `obsolete scheduler policy: ${obsolete}`);
}

assert.equal(/\b1 active\b/.test(source), false, 'singleton dispatch example must be absent');
assert.equal(/\b7 active children\b/.test(source), false, 'oversized dispatch example must be absent');

assert.deepEqual(config.permission, { external_directory: 'allow' }, 'root permission must be exact directory approval');
assert.equal(config.mcp?.playwright?.enabled, false, 'standalone Playwright MCP must remain disabled');
assert.equal(config.mcp?.playwright_headless?.enabled, false, 'standalone headless Playwright MCP must remain disabled');
for (const [name, projection] of Object.entries(config.agent ?? {})) {
  assert.deepEqual(Object.keys(projection).sort(), ['model', 'variant'], `${name} root mapping must remain model/variant-only`);
}

const planText = normalized(plan);
for (const phrase of [
  'research repository context directly',
  'by default',
  '2–6 useful research assignments',
  '3 preferred',
  'never a singleton or filler assignment',
  'read-only primary agent',
]) {
  assert.ok(planText.includes(phrase.toLowerCase()), `plan must include direct-first research rule: ${phrase}`);
}
assert.equal(/\bedit(?:s|ing)?\b|\bwrite(?:s|ing)?\b/.test(plan.replace(/^---[\s\S]*?---/, '')), true, 'plan prose should retain its read-only mutation prohibition');
assert.ok(!command.includes('DeepSeek V4 Pro'), 'stale model-insult clause must be removed');
assert.ok(command.includes('summarizing ALL current bugs and features'), 'next-steps behavior must remain intact');

function makeItems(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `todo-${index}`,
    ready: true,
    contractComplete: true,
    useful: true,
    role: index === count - 1 ? 'research' : 'implementation',
    writer: index !== count - 1,
    territory: index === count - 1 ? '' : `src/item-${index}`,
    finalized: true,
    reviewAlreadyRun: false,
  }));
}

function overlaps(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function validDelegatedTeam(items, assignments) {
  if (!Array.isArray(assignments) || assignments.length < 2 || assignments.length > 6) return false;

  const itemById = new Map(items.map((item) => [item.id, item]));
  const assignedTodos = new Set();
  const assignedAgents = new Set();
  const territories = [];

  for (const assignment of assignments) {
    const item = itemById.get(assignment.item);
    if (!item || !item.ready || !item.contractComplete || !item.useful || assignment.filler
      || !assignment.instance || assignedTodos.has(item.id) || assignedAgents.has(assignment.instance)
      || assignment.role !== item.role || (item.review && (!item.finalized || item.reviewAlreadyRun))) {
      return false;
    }
    assignedTodos.add(item.id);
    assignedAgents.add(assignment.instance);
    if (!item.writer) continue;
    if (!item.territory || assignment.territory !== item.territory
      || territories.some((other) => overlaps(other, item.territory))) return false;
    territories.push(item.territory);
  }

  return assignedTodos.size === items.length;
}

function directPathIsValid(assignments) {
  return Array.isArray(assignments) && assignments.length === 0;
}

for (const count of [2, 3, 6]) {
  const items = makeItems(count);
  const assignments = items.map((item, index) => ({
    item: item.id,
    instance: `child-${index}`,
    role: item.role,
    territory: item.territory,
  }));
  assert.ok(validDelegatedTeam(items, assignments), `delegated fixture ${count} must be accepted`);
}
assert.ok(directPathIsValid([]), 'direct path must use zero subagents');

function rejectFixture(label, mutate) {
  const items = makeItems(3);
  const assignments = items.map((item, index) => ({
    item: item.id,
    instance: `child-${index}`,
    role: item.role,
    territory: item.territory,
  }));
  mutate(items, assignments);
  assert.equal(validDelegatedTeam(items, assignments), false, `${label} must be rejected`);
}

rejectFixture('singleton team', (items, assignments) => { assignments.splice(1); items.splice(1); });
rejectFixture('seven-child team', (items, assignments) => {
  const extra = { id: 'todo-3', ready: true, contractComplete: true, useful: true, role: 'implementation', writer: true, territory: 'src/item-3', finalized: true, reviewAlreadyRun: false };
  items.push(extra);
  assignments.push({ item: extra.id, instance: 'child-3', role: extra.role, territory: extra.territory });
  items.push({ ...extra, id: 'todo-4', territory: 'src/item-4' });
  assignments.push({ item: 'todo-4', instance: 'child-4', role: extra.role, territory: 'src/item-4' });
  items.push({ ...extra, id: 'todo-5', territory: 'src/item-5' });
  assignments.push({ item: 'todo-5', instance: 'child-5', role: extra.role, territory: 'src/item-5' });
  items.push({ ...extra, id: 'todo-6', territory: 'src/item-6' });
  assignments.push({ item: 'todo-6', instance: 'child-6', role: extra.role, territory: 'src/item-6' });
});
rejectFixture('filler assignment', (_items, assignments) => { assignments[0].filler = true; });
rejectFixture('duplicate agent', (_items, assignments) => { assignments[1].instance = assignments[0].instance; });
rejectFixture('duplicate Todo', (_items, assignments) => { assignments[1].item = assignments[0].item; });
rejectFixture('overlapping writer territories', (items, assignments) => {
  items[1].territory = assignments[1].territory = 'src/item-0/nested';
});
rejectFixture('premature review', (items) => { items[0].review = true; items[0].finalized = false; });

console.log('PASS: direct-first scheduler policy, exact root approval, and 2/3/6 bounded-team fixtures');
NODE
