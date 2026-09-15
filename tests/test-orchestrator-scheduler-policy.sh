#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ORCHESTRATOR_PROFILE="${ORCHESTRATOR_PROFILE:-$REPO_ROOT/.opencode/agents/primary/ingenium-orchestrator.md}"

node - "$ORCHESTRATOR_PROFILE" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(process.argv[2], 'utf8');
const required = [
  'one distinct subagent per open TodoWrite/roadmap item',
  'explicit user concurrency request',
  'no fixed active-agent or writer ceiling',
  '20 simultaneous subagents',
  'every contract field below is present',
  'exclusive non-overlapping writer territories',
  'Dependent items wait on prerequisites',
  'Never manufacture roles',
  'No subagent may delegate, spawn, or reassign another subagent',
  'QA, security, and visual review run once per applicable finalized boundary',
  'never before relevant implementation and declared verification are final',
  'Security additionally requires a predeclared changed security surface',
  'Deny-default permissions and broker protection remain unchanged',
  'Dispatch one parallel call',
  'Independent work streams',
  'immediately dispatch the next declared phase',
  'Waiting items',
  'Plain-language introduction',
  'Plain-language post-phase explanation',
  'raw subagent JSON or tool output',
  'source behavior; it is not deployed-runtime proof',
  'IN_SCOPE', 'OUT_OF_SCOPE', 'Acceptance criteria', 'STOP_CONDITION',
  'Deployment owner', 'Verification plan', 'Escalation rule',
  'What I did', 'What changed', 'How I verified it', 'Where the proof is',
];

function validatePolicy(text) {
  const normalized = text.replace(/\s+/g, ' ').toLowerCase();
  for (const phrase of required) {
    assert.ok(normalized.includes(phrase.toLowerCase()), `missing policy: ${phrase}`);
  }
  for (const obsolete of ['UNUSED_CAPACITY', 'single-Todo fan-out', 'multi-Todo exact pairing']) {
    assert.ok(!normalized.includes(obsolete.toLowerCase()), `obsolete allocation: ${obsolete}`);
  }
}

validatePolicy(source);

// This fixture model checks the declared allocation contract, not runtime enforcement.
function validAllocation(items, assignments) {
  const ready = items.filter(item => item.ready);
  if (assignments.length !== ready.length) return false;
  const assignedItems = new Set();
  const instances = new Set();
  const territories = [];
  for (const assignment of assignments) {
    const item = ready.find(candidate => candidate.id === assignment.item);
    if (!item || !item.contractComplete || !assignment.instance ||
        assignedItems.has(item.id) || instances.has(assignment.instance) ||
        assignment.role !== item.role || assignment.delegates ||
        (item.review && (!item.finalized || item.reviewAlreadyRun)) ||
        (item.role === 'security' && !item.securitySurface)) return false;
    assignedItems.add(item.id);
    instances.add(assignment.instance);
    if (item.writer) {
      const territory = assignment.territory;
      if (!territory || territory !== item.territory) return false;
      if (territories.some(other => territory === other ||
          territory.startsWith(`${other}/`) || other.startsWith(`${territory}/`))) return false;
      territories.push(territory);
    }
  }
  return true;
}

const items = Array.from({ length: 20 }, (_, index) => ({
  id: `todo-${index}`, ready: true, contractComplete: true,
  role: 'implementation', writer: true, territory: `src/item-${index}`,
}));
const assignments = items.map(item => ({
  item: item.id, instance: `child-${item.id}`, role: item.role, territory: item.territory,
}));
assert.ok(validAllocation(items, assignments), '20 ready items permit 20 simultaneous writers');
assert.ok(validAllocation(items.slice(0, 1), assignments.slice(0, 1)), 'one item needs one agent');
assert.ok(!validAllocation(items, assignments.slice(0, -1)), 'ready item cannot be silently omitted');
assert.ok(!validAllocation(items, [...assignments, assignments[0]]), 'duplicate assignment rejected');

function rejectFixture(label, mutate) {
  const fixture = JSON.parse(JSON.stringify({ items, assignments }));
  mutate(fixture);
  assert.equal(validAllocation(fixture.items, fixture.assignments), false, label);
}

rejectFixture('overlapping writers', fixture => {
  fixture.items[1].territory = fixture.assignments[1].territory = 'src/item-0/nested';
});
rejectFixture('manufactured roles', fixture => { fixture.assignments[0].role = 'invented'; });
rejectFixture('premature review', fixture => {
  fixture.items[0].review = true;
  fixture.items[0].finalized = false;
});
rejectFixture('review rerun', fixture => {
  fixture.items[0].review = fixture.items[0].finalized = fixture.items[0].reviewAlreadyRun = true;
});
rejectFixture('undeclared security surface', fixture => {
  fixture.items[0].role = fixture.assignments[0].role = 'security';
  fixture.items[0].review = fixture.items[0].finalized = true;
});
rejectFixture('subagent delegation', fixture => { fixture.assignments[0].delegates = true; });
rejectFixture('unready dependency', fixture => { fixture.items[0].ready = false; });
rejectFixture('incomplete contract', fixture => { fixture.items[0].contractComplete = false; });
rejectFixture('shared child instance', fixture => {
  fixture.assignments[1].instance = fixture.assignments[0].instance;
});
const waitingItems = [...items, { id: 'dependent-review', ready: false }];
assert.ok(validAllocation(waitingItems, assignments), 'dependent item waits without reducing ready concurrency');

if (process.env.SCHEDULER_POLICY_SKIP_FIXTURES !== '1') {
  const normalized = source.replace(/\s+/g, ' ').toLowerCase();
  for (const phrase of required) {
    const fixture = normalized.split(phrase.toLowerCase()).join('REMOVED_POLICY');
    assert.notEqual(fixture, normalized, `negative fixture must alter source: ${phrase}`);
    assert.throws(() => validatePolicy(fixture), `missing invariant rejected: ${phrase}`);
  }
}
console.log('PASS: user-requested scheduler policy and bounded allocation fixtures');
NODE
