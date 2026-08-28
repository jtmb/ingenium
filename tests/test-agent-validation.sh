#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS_DIR="$REPO_ROOT/.opencode/agents"
CONFIG="$REPO_ROOT/opencode.json"
QA_PROFILE="$AGENTS_DIR/execution/ingenium-qa.md"
EXPECTED_LOGICAL_AGENT_COUNT=12
MAX_ACTIVE_SUBAGENTS=6
MAX_CONCURRENT_WRITERS=3
ROADMAP_FILE="$REPO_ROOT/docs/reference/ROADMAP.md"
ROADMAP_ARCHIVE_DIR="$REPO_ROOT/docs/reference/archive"
FAILED=0
ALLOCATION_FIXTURE_DIR=""

cleanup_allocation_fixtures() {
  if [[ -n "$ALLOCATION_FIXTURE_DIR" && -d "$ALLOCATION_FIXTURE_DIR" ]]; then
    rm -rf "$ALLOCATION_FIXTURE_DIR"
  fi
}

trap cleanup_allocation_fixtures EXIT

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1"; FAILED=1; }

# A profile is a writer when either edit or write grants any allow rule.  The
# permission may be a scalar (`edit: allow`) or a map (`edit: {"*": allow}`),
# so checking only the scalar form misses profiles such as ingenium-docs and
# browser-agent.
profile_has_writer_permission() {
  awk '
    NR == 1 && $0 != "---" { exit 1 }
    NR == 1 { in_frontmatter = 1; next }
    in_frontmatter && $0 == "---" { exit }
    !in_frontmatter { next }

    /^  (edit|write):[[:space:]]*("?allow"?)[[:space:]]*$/ { found = 1; next }
    /^  (edit|write):.*allow/ { found = 1; next }
    /^  (edit|write):[[:space:]]*$/ { nested_permission = 1; next }
    nested_permission && /^    / {
      if ($0 ~ /:[[:space:]]*"?allow"?[[:space:]]*$/) found = 1
      next
    }
    nested_permission { nested_permission = 0 }

    END { exit(found ? 0 : 1) }
  ' "$1"
}

profile_has_exact_ponytail_skill_permission() {
  awk '
    NR == 1 && $0 != "---" { exit 1 }
    NR == 1 { in_frontmatter = 1; next }
    in_frontmatter && $0 == "---" { exit }
    !in_frontmatter { next }

    /^  skill:[[:space:]]*$/ { in_skill = 1; next }
    in_skill && /^  [^[:space:]]/ { in_skill = 0 }
    in_skill && /^    "@ponytail":[[:space:]]*allow[[:space:]]*$/ {
      entries++
      allowed++
      next
    }
    in_skill && /^    "@ponytail":/ { entries++ }

    END { exit(entries == 1 && allowed == 1 ? 0 : 1) }
  ' "$1"
}

profile_has_exact_question_deny() {
  awk '
    NR == 1 && $0 != "---" { exit 1 }
    NR == 1 { in_frontmatter = 1; next }
    in_frontmatter && $0 == "---" { exit }
    !in_frontmatter { next }

    /^  question:[[:space:]]*deny[[:space:]]*$/ { denied++; next }
    /^  question:/ { other++ }

    END { exit(denied == 1 && other == 0 ? 0 : 1) }
  ' "$1"
}

profile_has_exact_todowrite_allow() {
  awk '
    NR == 1 && $0 != "---" { exit 1 }
    NR == 1 { in_frontmatter = 1; next }
    in_frontmatter && $0 == "---" { exit }
    !in_frontmatter { next }

    /^  todowrite:[[:space:]]*allow[[:space:]]*$/ { allowed++; next }
    /^  todowrite:/ { other++ }

    END { exit(allowed == 1 && other == 0 ? 0 : 1) }
  ' "$1"
}

profile_has_todowrite_permission() {
  awk '
    NR == 1 && $0 != "---" { exit 1 }
    NR == 1 { in_frontmatter = 1; next }
    in_frontmatter && $0 == "---" { exit }
    !in_frontmatter { next }

    /^  todowrite:/ { found = 1 }
    END { exit(found ? 0 : 1) }
  ' "$1"
}

profile_has_broker_wildcard_deny_only() {
  awk '
    NR == 1 && $0 != "---" { exit 1 }
    NR == 1 { in_frontmatter = 1; next }
    in_frontmatter && $0 == "---" { exit }
    !in_frontmatter { next }

    /^permission:[[:space:]]*$/ { in_permission = 1; next }
    in_permission && /^[^[:space:]]/ { in_permission = 0; next }
    !in_permission { next }
    /^[[:space:]]*$/ || /^  #/ { next }
    /^  "\*": deny[[:space:]]*$/ { wildcard_denies++; next }
    /^[[:space:]]/ { exceptions++ }

    END { exit(wildcard_denies == 1 && exceptions == 0 ? 0 : 1) }
  ' "$1"
}

mapfile -t AGENT_FILES < <(find "$AGENTS_DIR" -type f -name '*.md' -print | sort)
mapfile -t AGENT_FILES < <(for file in "${AGENT_FILES[@]}"; do [[ "$(head -n 1 "$file")" == '---' ]] && printf '%s\n' "$file"; done)

if [[ "${#AGENT_FILES[@]}" -eq 0 ]]; then
  fail "no active agent profiles found"
  exit 1
fi

# Every non-broker profile, including compatibility mirrors, explicitly opts in.
ponytail_permissions_valid=1
for file in "${AGENT_FILES[@]}"; do
  profile_name="$(grep -m1 '^name:' "$file" | sed 's/^name: *//')"
  [[ "$profile_name" == "ingenium-llm-broker" ]] && continue
  if ! profile_has_exact_ponytail_skill_permission "$file"; then
    fail "$profile_name must define exactly one allowed @ponytail skill permission"
    ponytail_permissions_valid=0
  fi
done
if [[ "$ponytail_permissions_valid" -eq 1 ]]; then
  pass "all non-broker profiles explicitly allow @ponytail"
fi

node - "$AGENTS_DIR" "$REPO_ROOT" <<'NODE' || FAILED=1
const fs = require("fs");
const path = require("path");
const [agentsDir, repoRoot] = process.argv.slice(2);
const canonical = [
  "development-conventions",
  "devops-conventions",
  "database-conventions",
  "engineering-workflow",
  "mcp-tooling",
  "local-models",
  "security-audit",
  "documentation",
  "self-learning",
  "skill-maintenance",
];
const allCanonical = [...canonical.map((name) => `@${name}`), "@ponytail"];
const expected = {
  "ingenium-orchestrator": allCanonical,
  "ingenium-software-engineer-fast": allCanonical,
  "ingenium-software-engineer-premium": allCanonical,
  "ingenium-qa": allCanonical,
  "ingenium-docs": allCanonical,
  "ingenium-security-auditor": allCanonical,
  "ingenium-chat": ["@ponytail"],
  "ingenium-explore": ["@local-models", "@ponytail"],
  "ingenium-scout": ["@local-models", "@mcp-tooling", "@documentation", "@ponytail"],
  "ingenium-qa-vision": ["@development-conventions", "@devops-conventions", "@engineering-workflow", "@mcp-tooling", "@local-models", "@ponytail"],
  "browser-agent": ["@development-conventions", "@devops-conventions", "@engineering-workflow", "@mcp-tooling", "@local-models", "@skill-maintenance", "@ponytail"],
  "ingenium-llm-broker": [],
};
const errors = [];
const skillsDir = path.join(repoRoot, ".opencode", "skills");
const consolidationMap = JSON.parse(fs.readFileSync(path.join(skillsDir, "consolidation-map.json"), "utf8"));
const legacy = new Set(consolidationMap.mappings.map((mapping) => `@${mapping.source}`));

for (const name of canonical) {
  const skillDir = path.join(skillsDir, name);
  const skillMd = path.join(skillDir, "SKILL.md");
  const stat = fs.lstatSync(skillDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !fs.statSync(skillMd).isFile()) {
    errors.push(`canonical skill must be a regular directory with SKILL.md: ${name}`);
  }
}

function profiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    return entry.isDirectory() ? profiles(fullPath) : entry.name.endsWith(".md") ? [fullPath] : [];
  });
}

function skillPermissions(frontmatter) {
  const values = [];
  let inSkill = false;
  for (const line of frontmatter.split("\n")) {
    if (/^  skill:\s*$/.test(line)) {
      inSkill = true;
      continue;
    }
    if (inSkill && /^  \S/.test(line)) break;
    if (!inSkill) continue;
    const match = line.match(/^    "(@[^"]+)":\s*allow\s*$/);
    if (match) values.push(match[1]);
  }
  return values;
}

const seen = new Set();
for (const profilePath of profiles(agentsDir)) {
  const source = fs.readFileSync(profilePath, "utf8");
  if (!source.startsWith("---\n")) continue;
  const frontmatter = source.split("\n---\n", 1)[0];
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  if (!name || !Object.hasOwn(expected, name)) {
    errors.push(`unexpected or unnamed active profile: ${profilePath}`);
    continue;
  }
  seen.add(name);
  const actual = skillPermissions(frontmatter);
  const wanted = expected[name];
  if (actual.some((skill) => legacy.has(skill))) errors.push(`${name} references a legacy skill`);
  if ([...actual].sort().join("\n") !== [...wanted].sort().join("\n")) {
    errors.push(`${name} skill permissions must be exactly [${wanted.join(", ")}], found [${actual.join(", ")}]`);
  }
}
for (const name of Object.keys(expected)) if (!seen.has(name)) errors.push(`missing active profile: ${name}`);

const chat = fs.readFileSync(path.join(agentsDir, "chat", "ingenium-chat.md"));
const mirror = fs.readFileSync(path.join(agentsDir, "ingenium-chat.md"));
if (!chat.equals(mirror)) errors.push("ingenium-chat compatibility mirror differs from canonical chat profile");

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("PASS: exact role skill matrices, canonical skill existence, no legacy grants, broker exception, and chat mirror parity");
NODE

question_permissions_valid=1
for file in "${AGENT_FILES[@]}"; do
  profile_name="$(grep -m1 '^name:' "$file" | sed 's/^name: *//')"
  [[ "$profile_name" == "ingenium-llm-broker" ]] && continue
  if ! profile_has_exact_question_deny "$file"; then
    fail "$profile_name must define exactly one scalar question: deny permission"
    question_permissions_valid=0
  fi
done
if [[ "$question_permissions_valid" -eq 1 ]]; then
  pass "all non-broker profiles explicitly deny the question tool"
fi

declare -A TODOWRITE_OWNER_NAMES=(
  [ingenium-orchestrator]=1
  [ingenium-software-engineer-fast]=1
  [ingenium-software-engineer-premium]=1
)
todowrite_permissions_valid=1
for file in "${AGENT_FILES[@]}"; do
  profile_name="$(grep -m1 '^name:' "$file" | sed 's/^name: *//')"
  if [[ -n "${TODOWRITE_OWNER_NAMES[$profile_name]:-}" ]]; then
    if ! profile_has_exact_todowrite_allow "$file"; then
      fail "$profile_name must define exactly one scalar todowrite: allow permission"
      todowrite_permissions_valid=0
    fi
  elif profile_has_todowrite_permission "$file"; then
    fail "$profile_name must not receive TodoWrite permission"
    todowrite_permissions_valid=0
  fi
done
if [[ "$todowrite_permissions_valid" -eq 1 ]]; then
  pass "TodoWrite is allowed only for the orchestrator and both software-engineer writers"
fi

node - \
  "$AGENTS_DIR/primary/ingenium-orchestrator.md" \
  "$AGENTS_DIR/execution/ingenium-software-engineer-fast.md" \
  "$AGENTS_DIR/execution/ingenium-software-engineer-premium.md" <<'NODE' || FAILED=1
const fs = require("fs");
const errors = [];
const requiredLanguage = [
  "Immediately on every nonterminal task, initialize a nonempty TodoWrite",
  "before any dispatch, edit, or command.",
  "Update TodoWrite after every implementation or evidence transition.",
  "Reconcile every item against retained evidence before any terminal response.",
  "If TodoWrite fails or is unavailable, report the exact failure explicitly; never silently replace unavailable TodoWrite with prose.",
];

for (const profilePath of process.argv.slice(2)) {
  const normalized = fs.readFileSync(profilePath, "utf8").replace(/\s+/g, " ");
  for (const phrase of requiredLanguage) {
    if (!normalized.includes(phrase)) errors.push(`${profilePath} is missing mandatory TodoWrite language: ${phrase}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("PASS: TodoWrite owners require initialize, update, reconcile, and explicit failure reporting");
NODE

BROKER_PROFILE="$AGENTS_DIR/execution/ingenium-llm-broker.md"
if [[ ! -r "$BROKER_PROFILE" ]] || ! profile_has_broker_wildcard_deny_only "$BROKER_PROFILE"; then
  fail "broker must retain exactly one wildcard deny permission with no exceptions"
else
  pass "broker retains its wildcard-denied permission boundary"
fi

if ! node - "$CONFIG" <<'NODE'
const fs = require("fs");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const errors = [];
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

if (!isRecord(config.permission) || config.permission.question !== "deny") {
  errors.push("root permission.question must be deny");
}

const plan = config.agent?.plan;
if (!isRecord(plan) || !isRecord(plan.permission) || plan.permission.question !== "allow") {
  errors.push("built-in plan permission.question must be allow");
}

for (const [name, projection] of Object.entries(config.agent ?? {})) {
  if (name === "plan" || !isRecord(projection)) continue;
  for (const [label, value] of [
    ["question", projection.question],
    ["permission.question", isRecord(projection.permission) ? projection.permission.question : undefined],
  ]) {
    if (value === "allow" || value === "ask") {
      errors.push(`custom agent ${name} must not ${label}=${value}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("PASS: root denies question, built-in Plan allows it, and custom projections do not grant it");
NODE
then
  FAILED=1
fi

# Old agent topology tolerates the duplicate root-level ingenium-chat.md
# (it mirrors chat/ingenium-chat.md for legacy OpenCode discovery).
declare -A NAMES=()
declare -A HIDDEN_NAMES=()
declare -A WRITER_NAMES=()
declare -A NON_WRITER_NAMES=()
for file in "${AGENT_FILES[@]}"; do
  name="$(basename "$file" .md)"

  fm_name="$(grep -m1 '^name:' "$file" | sed 's/^name: *//')"
  [[ -z "$fm_name" ]] && fm_name="$name"

  if grep -q '^hidden:.*true' "$file"; then
    HIDDEN_NAMES["$fm_name"]=1
  fi

  if profile_has_writer_permission "$file"; then
    WRITER_NAMES["$fm_name"]=1
  fi

  if [[ -n "${NAMES[$fm_name]:-}" && "$fm_name" == "ingenium-chat" ]]; then
    continue
  fi
  NAMES["$fm_name"]=1

  if ! grep -q '^name:' "$file" || ! grep -q '^description:' "$file" || ! grep -q '^permission:' "$file"; then
    fail "$fm_name has incomplete frontmatter"
  fi

  if grep -q '^model:' "$file"; then
    fail "$fm_name has markdown model frontmatter"
  fi
done

# Dispatchable agents are active subagents, excluding the two primary agents
# and the hidden system-internal broker.  Writer status is intentionally not
# hard-coded here: it is derived from each profile's edit/write permissions.
declare -A DISPATCHABLE_NAMES=()
for name in "${!NAMES[@]}"; do
  case "$name" in
    ingenium-orchestrator|ingenium-chat|ingenium-llm-broker) ;;
    *) DISPATCHABLE_NAMES["$name"]=1 ;;
  esac
  if [[ -z "${WRITER_NAMES[$name]:-}" ]]; then
    NON_WRITER_NAMES["$name"]=1
  fi
done

if [[ "$FAILED" -eq 0 ]]; then pass "active profiles have required frontmatter and no markdown models"; fi

# Writer classification is derived from every profile's permission block, not
# from a hard-coded list of implementation agents.  Keep explicit regression
# guards for the two profiles that previously got misclassified because they
# use nested permission maps.
for expected_writer in \
  ingenium-software-engineer-fast \
  ingenium-software-engineer-premium \
  ingenium-docs \
  browser-agent; do
  if [[ -n "${WRITER_NAMES[$expected_writer]:-}" ]]; then
    pass "$expected_writer is recognized as a write-capable profile"
  else
    fail "$expected_writer has edit/write permissions but was not recognized as a writer"
  fi
done
if [[ "${#WRITER_NAMES[@]}" -gt 0 ]]; then
  writer_list="$(printf '%s\n' "${!WRITER_NAMES[@]}" | sort | paste -sd ',' -)"
  pass "all edit/write-capable profiles are indexed as writers: $writer_list"
else
  fail "no edit/write-capable profiles were recognized"
fi

if [[ "${#NAMES[@]}" -ne "$EXPECTED_LOGICAL_AGENT_COUNT" ]]; then
  fail "expected $EXPECTED_LOGICAL_AGENT_COUNT logical agent profiles, found ${#NAMES[@]}"
else
  pass "$EXPECTED_LOGICAL_AGENT_COUNT logical agent profiles are preserved (chat compatibility mirror deduplicated)"
fi

for file in "${AGENT_FILES[@]}"; do
  base="$(basename "$file" .md)"
  if [[ "$base" == "ingenium-prompt-engineer" ]]; then
    fail "Prompt Engineer agent file found at $file — must be absent"
  fi
  if [[ "$base" == "ingenium-software-engineer-terra" ]]; then
    fail "Terra agent file found at $file — must be absent"
  fi
done
if [[ "$FAILED" -eq 0 ]]; then pass "Prompt Engineer and Terra agent files are absent"; fi

declare -a CHECK_NAMES=()
for name in "${!NAMES[@]}"; do
  [[ "$name" == "ingenium-llm-broker" ]] && continue
  CHECK_NAMES+=("$name")
done
if [[ "${#CHECK_NAMES[@]}" -gt 0 ]]; then
  if [[ "${#CHECK_NAMES[@]}" -ne $((EXPECTED_LOGICAL_AGENT_COUNT - 1)) ]]; then
    fail "expected $((EXPECTED_LOGICAL_AGENT_COUNT - 1)) centralized model mappings, found ${#CHECK_NAMES[@]}"
  else
    pass "$((EXPECTED_LOGICAL_AGENT_COUNT - 1)) non-broker profiles require centralized model mappings"
  fi
  node - "$CONFIG" "$REPO_ROOT" "${CHECK_NAMES[@]}" <<'NODE' || FAILED=1
const fs = require("fs");
const path = require("path");
const [configPath, repoRoot, ...activeNames] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const agent = config.agent || {};
const errors = [];
const expected = {
  "browser-agent": ["openai/gpt-5.6-luna", "max", ".opencode/agents/execution/browser-agent.md"],
  "ingenium-docs": ["openai/gpt-5.6-luna", "max", ".opencode/agents/execution/ingenium-docs.md"],
  "ingenium-qa": ["openai/gpt-5.6-terra", "high", ".opencode/agents/execution/ingenium-qa.md"],
  "ingenium-qa-vision": ["openai/gpt-5.6-luna", "max", ".opencode/agents/execution/ingenium-qa-vision.md"],
  "ingenium-software-engineer-fast": ["openai/gpt-5.6-luna", "max", ".opencode/agents/execution/ingenium-software-engineer-fast.md"],
  "ingenium-software-engineer-premium": ["openai/gpt-5.6-sol", "high", ".opencode/agents/execution/ingenium-software-engineer-premium.md"],
  "ingenium-orchestrator": ["openai/gpt-5.6-sol", "high", ".opencode/agents/primary/ingenium-orchestrator.md"],
  "ingenium-explore": ["openai/gpt-5.6-sol", "medium", ".opencode/agents/research/ingenium-explore.md"],
  "ingenium-scout": ["openai/gpt-5.6-luna", "max", ".opencode/agents/research/ingenium-scout.md"],
  "ingenium-chat": ["deepseek/deepseek-v4-flash", "max", ".opencode/agents/chat/ingenium-chat.md"],
  "ingenium-security-auditor": ["openai/gpt-5.6-sol", "high", ".opencode/agents/security/ingenium-security-auditor.md"],
};

if (activeNames.length !== Object.keys(expected).length || activeNames.some((name) => !expected[name])) {
  errors.push(`active non-broker agent set does not match the ${Object.keys(expected).length} canonical mappings`);
}
for (const [name, [model, variant, profilePath]] of Object.entries(expected)) {
  const projection = agent[name];
  const prompt = `{file:${profilePath}}`;
  if (!projection) {
    errors.push(`canonical agent "${name}" is missing from opencode.json`);
    continue;
  }
  if (projection.model !== model) errors.push(`${name} model must be ${model}, found ${projection.model}`);
  if (projection.variant !== variant) errors.push(`${name} variant must be ${variant}, found ${projection.variant}`);
  if (projection.prompt !== prompt) errors.push(`${name} prompt must reference ${profilePath}, found ${projection.prompt}`);
  if (!fs.statSync(path.join(repoRoot, profilePath)).isFile()) errors.push(`${name} canonical profile is not a file: ${profilePath}`);
}
if (agent.explore?.model !== "openai/gpt-5.6-luna" || agent.explore?.variant !== "max") {
  errors.push("built-in explore mapping must remain openai/gpt-5.6-luna/max");
}
if (agent["ingenium-llm-broker"] !== undefined) {
  errors.push("protected hidden broker must remain absent from root agent mappings");
}

// Allowed variants by provider (case-sensitive)
const VARIANT_RULES = {
  openai:  new Set(["low", "medium", "high", "xhigh", "max"]),
  deepseek: new Set(["high", "max"]),
};

for (const name of activeNames) {
  if (!agent[name]) {
    errors.push(`active agent "${name}" is missing from opencode.json agent config`);
    continue;
  }
  if (!agent[name].model) {
    errors.push(`active agent "${name}" lacks a model mapping in opencode.json`);
    continue;
  }

  // Case-sensitive variant validation by provider
  const model = agent[name].model;
  const variant = agent[name].variant;

  // Determine provider from model string
  const provider = model.startsWith("openai/") ? "openai"
    : model.startsWith("deepseek/") ? "deepseek"
    : model.startsWith("opencode/") && model.endsWith("-free") ? "opencode-free"
    : "other";

  if (provider === "opencode-free") {
    // OpenCode free models must NOT have a variant
    if (variant !== undefined) {
      errors.push(`active agent "${name}" uses opencode-free model "${model}" but has variant "${variant}" — opencode free must have no variant`);
    }
  } else if (provider !== "other") {
    // Known provider with variant rules
    const allowed = VARIANT_RULES[provider];
    if (!allowed) {
      errors.push(`active agent "${name}" uses unknown provider for model "${model}" — no variant rules defined`);
    } else if (variant !== undefined && !allowed.has(variant)) {
      errors.push(`active agent "${name}" has invalid variant "${variant}" for ${provider} model "${model}" — allowed: ${[...allowed].join(", ")}`);
    }
  }
  // "other" providers (e.g. qwen/): no variant restrictions
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("PASS: exact centralized model/variant/profile mappings, broker exception, and variant validation");
NODE
else
  pass "no active non-hidden agents to check (skipped)"
fi

ORCHESTRATOR="$AGENTS_DIR/primary/ingenium-orchestrator.md"
LOCAL_MODEL_GUIDANCE_SOURCES=(
  "$REPO_ROOT/.opencode/skills/local-models/SKILL.md"
  "$REPO_ROOT/.opencode/skills/local-models/references/deep-seek.md"
  "$REPO_ROOT/.opencode/skills/local-models/references/qwen-3.5-9b.md"
)
local_model_guidance_valid=1
for guidance_source in "${LOCAL_MODEL_GUIDANCE_SOURCES[@]}"; do
  if [[ ! -r "$guidance_source" ]]; then
    fail "canonical local-model guidance is missing or unreadable: $guidance_source"
    local_model_guidance_valid=0
  fi
done

if [[ "$local_model_guidance_valid" -eq 1 && "${#CHECK_NAMES[@]}" -gt 0 ]]; then
  node - "$CONFIG" "${LOCAL_MODEL_GUIDANCE_SOURCES[@]}" "${CHECK_NAMES[@]}" <<'NODE' || FAILED=1
const fs = require("fs");

const [configPath, skillPath, deepSeekPath, qwenPath, ...activeNames] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const configuredAgents = config.agent || {};
const active = new Set(activeNames);
const errors = [];

function modelFamily(model) {
  return String(model).split("/", 1)[0].toLowerCase();
}

function claimFor(label) {
  const normalized = String(label).toLowerCase();
  if (normalized.includes("deepseek")) {
    const hasFlash = normalized.includes("flash");
    const hasPro = normalized.includes("pro");
    return {
      family: "deepseek",
      requiredText: normalized.includes("v4") ? "deepseek-v4" : null,
      exactModel: hasFlash && !hasPro
        ? "deepseek/deepseek-v4-flash"
        : hasPro && !hasFlash
          ? "deepseek/deepseek-v4-pro"
          : null,
    };
  }
  if (normalized.includes("qwen")) {
    return {
      family: "qwen",
      requiredText: null,
      exactModel: /3\.5[^0-9]*9b/.test(normalized) || normalized.includes("qwen3.5-9b")
        ? "qwen/qwen3.5-9b"
        : null,
    };
  }
  return null;
}

function checkClaim(agentName, label, source, lineNumber) {
  if (!active.has(agentName)) return;
  const mapping = configuredAgents[agentName];
  if (!mapping || !mapping.model) return;

  const claim = claimFor(label);
  if (!claim) return;

  const actualModel = String(mapping.model).toLowerCase();
  if (modelFamily(actualModel) !== claim.family) {
    errors.push(
      `${source}:${lineNumber} claims ${agentName} uses ${claim.family}, ` +
      `but opencode.json assigns ${mapping.model}`,
    );
    return;
  }
  if (claim.requiredText && !actualModel.includes(claim.requiredText)) {
    errors.push(
      `${source}:${lineNumber} claims ${agentName} uses ${label.trim()}, ` +
      `but opencode.json assigns ${mapping.model}`,
    );
  } else if (claim.exactModel && actualModel !== claim.exactModel) {
    errors.push(
      `${source}:${lineNumber} claims ${agentName} uses ${label.trim()}, ` +
      `but opencode.json assigns ${mapping.model}`,
    );
  }
}

function checkActiveParityTable(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  let inTable = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes("### Active OpenCode agent assignments")) {
      inTable = true;
      continue;
    }
    if (inTable && line.startsWith("For model-specific")) {
      inTable = false;
      continue;
    }
    if (!inTable) continue;

    const row = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+)\s*\|/);
    if (row) checkClaim(row[1], row[2], filePath, index + 1);
  }
}

function checkNamedActiveAgents(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const modelLine = lines.find((line) => /^\s*>?\s*\*\*Model\*\*:/i.test(line));
  const modelLabel = modelLine ? modelLine.replace(/^.*?\*\*Model\*\*:\s*/i, "") : "";

  lines.forEach((line, index) => {
    const activeLine = line.match(/^\s*>?\s*\*\*Active agents using it\*\*:\s*(.*)$/i);
    if (!activeLine || activeLine[1].trim().toLowerCase() === "none") return;

    for (const name of activeLine[1].split(",").map((value) => value.trim())) {
      if (name) checkClaim(name, modelLabel, filePath, index + 1);
    }
  });
}

checkActiveParityTable(skillPath);
checkNamedActiveAgents(deepSeekPath);
checkNamedActiveAgents(qwenPath);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("PASS: canonical local-model active assignments match opencode.json");
NODE
elif [[ "$local_model_guidance_valid" -eq 1 ]]; then
  pass "no active non-hidden agents to check (skipped canonical model guidance)"
fi

QA_VISION_PROFILE="$AGENTS_DIR/execution/ingenium-qa-vision.md"
CANONICAL_AGENT_DOCS=(
  "$REPO_ROOT/AGENTS.md"
  "$REPO_ROOT/docs/configure/agents.md"
  "$ORCHESTRATOR"
  "$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/agent-workflow-patterns/references/agent-limits.md"
  "$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/configuring-opencode/source-index.md"
)
if [[ ! -r "$QA_VISION_PROFILE" ]]; then
  fail "canonical QA Vision profile is missing or unreadable: $QA_VISION_PROFILE"
elif ! grep -q '^  bash: deny$' "$QA_VISION_PROFILE"; then
  fail "QA Vision profile does not deny Bash"
else
  vision_bash_errors=0
  for canonical_agent_doc in "${CANONICAL_AGENT_DOCS[@]}"; do
    if [[ ! -r "$canonical_agent_doc" ]]; then
      fail "canonical agent doc is missing or unreadable: $canonical_agent_doc"
      vision_bash_errors=1
      continue
    fi

    stale_vision_bash_claim="$(grep -Ein \
      '(^|[[:space:]|])@?ingenium-qa-vision([[:space:]|]|$).*([[:space:]|])Bash([[:space:]+|]|$)|(^|[[:space:]|])Bash([[:space:]+|]|$).*@?ingenium-qa-vision([[:space:]|]|$)' \
      "$canonical_agent_doc" || true)"
    if [[ -n "$stale_vision_bash_claim" ]]; then
      fail "$(basename "$canonical_agent_doc") claims QA Vision has Bash despite its denied profile: $stale_vision_bash_claim"
      vision_bash_errors=1
    fi
  done
  if [[ "$vision_bash_errors" -eq 0 ]]; then
    pass "canonical agent docs do not grant Bash to QA Vision"
  fi
fi

WORKFLOW_POLICY_SOURCE="$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/agent-workflow-patterns/source-index.md"
AGENT_LIMITS_SOURCE="$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/agent-workflow-patterns/references/agent-limits.md"
DOCUMENTED_POLICY_SOURCES=(
  "$ORCHESTRATOR"
  "$REPO_ROOT/AGENTS.md"
  "$REPO_ROOT/docs/configure/agents.md"
  "$WORKFLOW_POLICY_SOURCE"
  "$AGENT_LIMITS_SOURCE"
)

extract_task_allow_names() {
  awk '
    /^  task:/ { in_task = 1; next }
    in_task && /^  [^[:space:]]/ { exit }
    in_task && /^    "[^"]+": *"allow"/ {
      name = $0
      sub(/^    "/, "", name)
      sub(/".*$/, "", name)
      print name
    }
  ' "$1"
}

validate_orchestrator_bash_permissions() {
  local errors=0
  local bash_header_count
  local rule command action
  local -a bash_rules=()
  declare -A expected_rules=(
    ["*"]='deny'
    ['git *']='deny'
    ['git status']='allow'
    ['git status *']='allow'
    ['git diff']='allow'
    ['git diff *']='allow'
    ['git log']='allow'
    ['git log *']='allow'
    ['git add *']='allow'
    ['git rev-parse --short HEAD']='allow'
    ['git commit -m *']='allow'
    ['gh *']='allow'
    ['git commit --amend*']='deny'
    ['git commit-tree']='deny'
    ['git commit-tree *']='deny'
    ['git update-ref']='deny'
    ['git update-ref *']='deny'
    ['git push']='deny'
    ['git push *']='deny'
    ['git reset']='deny'
    ['git reset *']='deny'
    ['git config']='deny'
    ['git config *']='deny'
    ['git hook']='deny'
    ['git hook *']='deny'
    ['git update-index']='deny'
    ['git update-index *']='deny'
    ['npm test*']='allow'
    ['npm run test*']='allow'
    ['npm run build*']='allow'
    ['npm run typecheck*']='allow'
    ['npx tsc*']='allow'
    ['npx playwright test*']='allow'
    ['python -m pytest*']='allow'
    ['pytest*']='allow'
    ['go test*']='allow'
    ['go build*']='allow'
    ['cargo test*']='allow'
    ['cargo check*']='allow'
    ['cargo build*']='allow'
  )
  declare -A seen_rules=()

  bash_header_count="$(awk '/^  bash:[[:space:]]*$/ { count++ } END { print count + 0 }' "$ORCHESTRATOR")"
  if [[ "$bash_header_count" -ne 1 ]]; then
    fail "orchestrator must define exactly one granular bash permission object"
    errors=1
  fi

  if ! awk '
    /^  bash:[[:space:]]*$/ { in_bash = 1; next }
    in_bash && /^  [^[:space:]]/ { exit }
    in_bash && /^    "\*"[[:space:]]*:[[:space:]]*"?deny"?[[:space:]]*$/ { found = 1 }
    END { exit(found ? 0 : 1) }
  ' "$ORCHESTRATOR"; then
    fail "orchestrator bash permissions must deny arbitrary commands with a wildcard rule"
    errors=1
  fi

  if ! awk '
    /^  edit:[[:space:]]*/ {
      edit_count++
      if ($0 ~ /^  edit:[[:space:]]*deny[[:space:]]*$/) edit_denied = 1
    }
    /^  write:[[:space:]]*/ {
      write_count++
      if ($0 ~ /^  write:[[:space:]]*deny[[:space:]]*$/) write_denied = 1
    }
    END {
      exit(edit_count == 1 && edit_denied && write_count == 1 && write_denied ? 0 : 1)
    }
  ' "$ORCHESTRATOR"; then
    fail "orchestrator edit and write permissions must remain scalar deny rules"
    errors=1
  fi

  mapfile -t bash_rules < <(awk '
    /^  bash:[[:space:]]*$/ { in_bash = 1; next }
    in_bash && /^  [^[:space:]]/ { exit }
    in_bash && /^[[:space:]]*$/ { next }
    in_bash && /^    "[^"]+":[[:space:]]*"?(allow|deny)"?[[:space:]]*$/ {
      key = $0
      sub(/^    "/, "", key)
      sub(/".*$/, "", key)
      value = $0
      sub(/^.*":[[:space:]]*/, "", value)
      gsub(/[[:space:]]/, "", value)
      gsub(/"/, "", value)
      print key "\t" value
      next
    }
    in_bash && /^    / { print "__MALFORMED__\t" $0 }
  ' "$ORCHESTRATOR")

  for rule in "${bash_rules[@]}"; do
    command="${rule%%$'\t'*}"
    action="${rule#*$'\t'}"
    if [[ "$command" == "__MALFORMED__" ]]; then
      fail "orchestrator bash permissions contain a malformed nested rule: $action"
      errors=1
    elif [[ "${expected_rules[$command]:-}" == "$action" ]]; then
      if [[ -n "${seen_rules[$command]:-}" ]]; then
        fail "orchestrator bash permissions contain duplicate rule: $command"
        errors=1
      else
        seen_rules["$command"]=1
      fi
    else
      fail "orchestrator bash permissions contain an unexpected rule: $command ($action)"
      errors=1
    fi
  done

  for command in "${!expected_rules[@]}"; do
    if [[ -z "${seen_rules[$command]:-}" ]]; then
      fail "orchestrator bash permissions are missing intended rule: $command (${expected_rules[$command]})"
      errors=1
    fi
  done

  if [[ "$errors" -eq 0 ]]; then
    pass "orchestrator has deny-by-default bash permissions limited to ordinary Git/GitHub coordination and verification"
    return 0
  fi
  return 1
}

# The root config denies questions globally. The orchestrator must retain its
# explicit profile denial and cannot regain it through its centralized projection.
validate_orchestrator_question_boundary() {
  local errors=0
  local -a question_rules=()

  mapfile -t question_rules < <(awk '
    NR == 1 && $0 != "---" { exit 1 }
    NR == 1 { in_frontmatter = 1; next }
    in_frontmatter && $0 == "---" { exit }
    in_frontmatter && /^  question:[[:space:]]*/ {
      value = $0
      sub(/^  question:[[:space:]]*/, "", value)
      gsub(/[[:space:]]/, "", value)
      gsub(/["'"'"']/, "", value)
      print value
    }
  ' "$ORCHESTRATOR")

  if [[ "${#question_rules[@]}" -ne 1 || "${question_rules[0]:-}" != "deny" ]]; then
    fail "orchestrator must define exactly one scalar question: deny permission"
    errors=1
  fi

  if ! node - "$ORCHESTRATOR" "$CONFIG" <<'NODE'
const fs = require("fs");
const [profilePath, configPath] = process.argv.slice(2);
const profile = fs.readFileSync(profilePath, "utf8");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const errors = [];
const frontmatter = profile.match(/^---\n([\s\S]*?)\n---/);

if (!frontmatter) {
  errors.push("orchestrator profile has no readable frontmatter");
} else {
  const permissionGrants = frontmatter[1].match(/^\s*question:\s*(?:allow|ask)\s*$/gmi) ?? [];
  if (permissionGrants.length > 0) {
    errors.push(`orchestrator profile grants question permission: ${permissionGrants.join(", ")}`);
  }
}

const projection = config.agent?.["ingenium-orchestrator"];
if (!projection || typeof projection !== "object") {
  errors.push("orchestrator is missing from the centralized agent config");
} else {
  const projectedQuestionPermissions = [
    ["agent.question", projection.question],
    ["agent.permission.question", projection.permission?.question],
  ];
  for (const [label, value] of projectedQuestionPermissions) {
    if (value !== undefined && value !== "deny") {
      errors.push(`${label} must be absent or deny, found ${JSON.stringify(value)}`);
    }
  }
  if (config.permission?.question !== "deny") {
    errors.push(`root permission.question must be deny, found ${JSON.stringify(config.permission?.question)}`);
  }
}

const body = profile.slice(profile.indexOf("---", 3) + 3);
for (const line of body.split(/\r?\n/)) {
  if (/question\s+tool/i.test(line) && !/\b(?:never|must not|does not|do not)\b/i.test(line)) {
    errors.push(`orchestrator contains a non-denial question-tool instruction: ${line.trim()}`);
  }
  if (/ask(?:s)?\s+(?:the\s+)?user\s+(?:for\s+)?permission/i.test(line)
    && /(?:test|verification|remediation)/i.test(line)
    && !/\b(?:never|must not|does not|do not)\b/i.test(line)) {
    errors.push(`orchestrator contains a permission-seeking verification instruction: ${line.trim()}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("PASS: orchestrator and config projections deny the question tool; no permissive instruction remains");
NODE
  then
    errors=1
  fi

  if [[ "$errors" -eq 0 ]]; then
    pass "orchestrator has an explicit non-interactive question-tool boundary"
    return 0
  fi
  return 1
}

validate_reporting_agent_task_denial() {
  local profile="$1"
  local label="$2"
  if awk '
    /^  task:[[:space:]]*$/ { in_task = 1; next }
    in_task && /^  [^[:space:]]/ { exit }
    in_task && /^    "\*"[[:space:]]*:[[:space:]]*"?deny"?[[:space:]]*$/ { found = 1 }
    END { exit(found ? 0 : 1) }
  ' "$profile"; then
    pass "$label denies task delegation"
  else
    fail "$label must deny task delegation to prevent automatic reviewer handoffs"
  fi
}

extract_declared_agent_list() {
  local source="$1"
  local heading="$2"
  awk -v heading="$heading" 'index($0, heading) == 1 { print; exit }' "$source" \
    | grep -Eo '@[[:alnum:]-]+' | sed 's/^@//' || true
}

if [[ ! -f "$ORCHESTRATOR" ]]; then
  fail "orchestrator profile not found at $ORCHESTRATOR"
else
  HAS_STALE=0
  if grep -q 'ingenium-software-engineer-terra' "$ORCHESTRATOR"; then
    fail "orchestrator has stale task allow entry for Terra (ingenium-software-engineer-terra)"
    HAS_STALE=1
  fi
  if grep -q 'ingenium-prompt-engineer' "$ORCHESTRATOR"; then
    fail "orchestrator has stale task allow entry for Prompt Engineer"
    HAS_STALE=1
  fi
  if [[ "$HAS_STALE" -eq 0 ]]; then
    pass "orchestrator has no stale Terra/Prompt Engineer task allow entries"
  fi
  # Still validate the standard delegation pattern and the granular bash
  # permission boundary independently.
  task_delegation_valid=0
  if ! grep -q '^  task:' "$ORCHESTRATOR" || ! grep -q '"\*": "deny"' "$ORCHESTRATOR"; then
    fail "orchestrator agent permissions or task delegation are invalid"
  else
    task_delegation_valid=1
  fi
  bash_permissions_valid=0
  if validate_orchestrator_bash_permissions; then
    bash_permissions_valid=1
  fi
  question_boundary_valid=0
  if validate_orchestrator_question_boundary; then
    question_boundary_valid=1
    pass "scenario: orchestrator has no question-tool permission"
  fi
  if [[ "$task_delegation_valid" -eq 1 && "$bash_permissions_valid" -eq 1 && "$question_boundary_valid" -eq 1 ]]; then
    pass "orchestrator has delegation permissions with task deny-all pattern"
  fi

  # The task allow-list, writer list, and read-only list are three views of
  # the same dispatchable topology.  Compare all three against the active
  # profiles and derive writer status from permissions rather than prose.
  declare -A TASK_ALLOW_NAMES=()
  declare -A DECLARED_WRITER_NAMES=()
  declare -A DECLARED_READ_ONLY_NAMES=()
  mapfile -t TASK_ALLOW_LIST < <(extract_task_allow_names "$ORCHESTRATOR")
  mapfile -t DECLARED_WRITER_LIST < <(
    extract_declared_agent_list "$ORCHESTRATOR" "Writers (count toward"
  )
  mapfile -t DECLARED_READ_ONLY_LIST < <(
    extract_declared_agent_list "$ORCHESTRATOR" "Read-only (count only toward"
  )
  for name in "${TASK_ALLOW_LIST[@]}"; do TASK_ALLOW_NAMES["$name"]=1; done
  for name in "${DECLARED_WRITER_LIST[@]}"; do DECLARED_WRITER_NAMES["$name"]=1; done
  for name in "${DECLARED_READ_ONLY_LIST[@]}"; do DECLARED_READ_ONLY_NAMES["$name"]=1; done

  topology_errors=0
  for name in "${!TASK_ALLOW_NAMES[@]}"; do
    if [[ -z "${NAMES[$name]:-}" ]]; then
      fail "orchestrator task allow-list contains stale or unknown agent: $name"
      topology_errors=1
    elif [[ -z "${DISPATCHABLE_NAMES[$name]:-}" ]]; then
      fail "orchestrator task allow-list contains non-dispatchable agent: $name"
      topology_errors=1
    fi
  done
  for name in "${!DISPATCHABLE_NAMES[@]}"; do
    if [[ -z "${TASK_ALLOW_NAMES[$name]:-}" ]]; then
      fail "orchestrator task allow-list is missing active dispatchable agent: $name"
      topology_errors=1
    fi
  done

  for name in "${!DISPATCHABLE_NAMES[@]}"; do
    if [[ -n "${WRITER_NAMES[$name]:-}" ]]; then
      if [[ -z "${DECLARED_WRITER_NAMES[$name]:-}" ]]; then
        fail "writer list is missing permissions-derived writer: $name"
        topology_errors=1
      fi
      if [[ -n "${DECLARED_READ_ONLY_NAMES[$name]:-}" ]]; then
        fail "$name appears in both writer and read-only lists"
        topology_errors=1
      fi
    else
      if [[ -z "${DECLARED_READ_ONLY_NAMES[$name]:-}" ]]; then
        fail "read-only list is missing permissions-derived non-writer: $name"
        topology_errors=1
      fi
      if [[ -n "${DECLARED_WRITER_NAMES[$name]:-}" ]]; then
        fail "$name is permission-derived non-writer but appears in writer list"
        topology_errors=1
      fi
    fi
  done
  for name in "${!DECLARED_WRITER_NAMES[@]}"; do
    if [[ -z "${DISPATCHABLE_NAMES[$name]:-}" ]]; then
      fail "writer list contains stale or non-dispatchable agent: $name"
      topology_errors=1
    fi
  done
  for name in "${!DECLARED_READ_ONLY_NAMES[@]}"; do
    if [[ -z "${DISPATCHABLE_NAMES[$name]:-}" ]]; then
      fail "read-only list contains stale or non-dispatchable agent: $name"
      topology_errors=1
    fi
  done

  # A documented dispatchable agent must also be task-allowed.  This explicit
  # browser guard keeps the permission boundary from regressing silently.
  if grep -q '@browser-agent' "$ORCHESTRATOR"; then
    if [[ -n "${TASK_ALLOW_NAMES[browser-agent]:-}" ]]; then
      pass "documented browser-agent dispatch is explicitly task-allowed"
    else
      fail "orchestrator documents browser-agent dispatch without task permission"
      topology_errors=1
    fi
  fi

  # Every task-allowed agent must appear in exactly one documented list, and
  # every listed agent must be task-allowed.  This catches stale list/task
  # drift even when both lists happen to contain plausible names.
  for name in "${!TASK_ALLOW_NAMES[@]}"; do
    listed=0
    [[ -n "${DECLARED_WRITER_NAMES[$name]:-}" ]] && listed=$((listed + 1))
    [[ -n "${DECLARED_READ_ONLY_NAMES[$name]:-}" ]] && listed=$((listed + 1))
    if [[ "$listed" -ne 1 ]]; then
      fail "task allow-list/list classification mismatch for $name"
      topology_errors=1
    fi
  done
  for name in "${!DECLARED_WRITER_NAMES[@]}" "${!DECLARED_READ_ONLY_NAMES[@]}"; do
    if [[ -z "${TASK_ALLOW_NAMES[$name]:-}" ]]; then
      fail "documented dispatch list contains agent not task-allowed: $name"
      topology_errors=1
    fi
  done
  if [[ "$topology_errors" -eq 0 ]]; then
    pass "task allow-list and permissions-derived writer/read-only lists agree"
  fi
fi

for policy_source in "${DOCUMENTED_POLICY_SOURCES[@]}"; do
  if [[ -r "$policy_source" ]]; then
    pass "canonical policy source is available for safe inspection: ${policy_source#"$REPO_ROOT"/}"
  else
    fail "canonical policy source is missing or unreadable: $policy_source"
  fi
done

policy_errors=0

check_policy_pattern() {
  local source="$1"
  local label="$2"
  local pattern="$3"
  local description="$4"
  if grep -qE "$pattern" "$source"; then
    pass "$label $description"
  else
    fail "$label is missing $description"
    policy_errors=1
  fi
}

check_normalized_policy_pattern() {
  local source="$1"
  local label="$2"
  local phrase="$3"
  local description="$4"
  local normalized_source
  local normalized_phrase

  normalized_source="$(tr -s '[:space:]' ' ' < "$source")"
  normalized_phrase="$(printf '%s\n' "$phrase" | tr -s '[:space:]' ' ')"
  if [[ "$normalized_source" == *"$normalized_phrase"* ]]; then
    pass "$label $description"
  else
    fail "$label is missing $description"
    policy_errors=1
  fi
}

check_normalized_policy_regex_pattern() {
  local source="$1"
  local label="$2"
  local pattern="$3"
  local description="$4"
  local normalized_source

  normalized_source="$(tr -s '[:space:]' ' ' < "$source" | tr '[:upper:]' '[:lower:]')"
  if [[ "$normalized_source" =~ $pattern ]]; then
    pass "$label $description"
  else
    fail "$label is missing $description"
    policy_errors=1
  fi
}

HUMAN_RESPONSE_POLICY_SOURCES=(
  "$ORCHESTRATOR"
  "$REPO_ROOT/AGENTS.md"
)
for policy_source in "${HUMAN_RESPONSE_POLICY_SOURCES[@]}"; do
  policy_label="${policy_source#"$REPO_ROOT"/}"
  if [[ ! -r "$policy_source" ]]; then
    fail "$policy_label is missing for human-readable response validation"
    policy_errors=1
    continue
  fi
  check_normalized_policy_regex_pattern "$policy_source" "$policy_label" \
    'plain-language[[:space:]-]+introduction|one[[:space:]]+to[[:space:]]+three[[:space:]]+plain[[:space:]]+sentences.{0,180}(goal|why).{0,120}immediate[[:space:]]+approach' \
    "a plain-language introduction"
  check_normalized_policy_regex_pattern "$policy_source" "$policy_label" \
    'plain-language[[:space:]-]+post-phase[[:space:]]+explanation|after every implementation or evidence transition.{0,240}what happened.{0,100}what changed.{0,100}(result|next dependency)' \
    "interpreted implementation/evidence transition summaries"
  check_normalized_policy_regex_pattern "$policy_source" "$policy_label" \
    'human-readable execution summary.{0,120}headings|terminal responses use.{0,220}status.{0,180}what i did.{0,180}where the proof is' \
    "terminal human-readable response headings"
  check_normalized_policy_regex_pattern "$policy_source" "$policy_label" \
    'source behavior.{0,180}(not deployed|runtime).{0,180}proof|distinguish evidence.{0,300}source tests prove.{0,300}deployed canaries prove.{0,300}actual model/session artifacts prove' \
    "the source/runtime/model proof boundary"
  check_normalized_policy_regex_pattern "$policy_source" "$policy_label" \
    'raw[[:space:]]+(subagent|agent)[[:space:]]+json.{0,120}(tool|output)|avoid raw[[:space:]]+agent[[:space:]]+json.{0,80}tool dumps|raw[[:space:]]+subagent[[:space:]]+json.{0,80}tool output' \
    "the prohibition on raw subagent/tool dumps as final responses"
  check_normalized_policy_regex_pattern "$policy_source" "$policy_label" \
    'pre-dispatch[[:space:]]+task contract|structured task contract.{0,100}mandatory' \
    "the structured task contract"
  check_normalized_policy_regex_pattern "$policy_source" "$policy_label" \
    'in_scope.{0,300}out_of_scope.{0,300}acceptance criteria.{0,300}stop_condition.{0,300}verification plan.{0,300}escalation rule' \
    "the structured task contract fields"
done

# Broad suites are safe only when the task names their acceptance role; these
# guards keep routine writer verification tied to the changed feature.
WRITER_VERIFICATION_PROFILES=(
  "$REPO_ROOT/.opencode/agents/execution/ingenium-software-engineer-fast.md"
  "$REPO_ROOT/.opencode/agents/execution/ingenium-software-engineer-premium.md"
)
for writer_profile in "${WRITER_VERIFICATION_PROFILES[@]}"; do
  writer_label="$(basename "$writer_profile")"
  check_policy_pattern "$writer_profile" "$writer_label" \
    '[Oo]rdinary work.*affected workspace.*typecheck/lint.*directly affected test file' \
    "affected-work verification scope"
  check_policy_pattern "$writer_profile" "$writer_label" \
    'FULL_ACCEPTANCE.*declared acceptance checks.*not every repository test' \
    "explicit full-acceptance boundary"
  check_policy_pattern "$writer_profile" "$writer_label" \
    '[Aa] focused Playwright.*fixture.*(containment[[:space:]-]+audit|suite-containment-audit)' \
    "fixture containment audit requirement"
  check_policy_pattern "$writer_profile" "$writer_label" \
    'Before source edits.*useful-comments/guidelines\.md' \
    "useful-comments guideline read requirement"
  check_policy_pattern "$writer_profile" "$writer_label" \
    'self-explanatory code.*comments only for non-obvious why/constraints' \
    "why-focused comment policy"
  check_policy_pattern "$writer_profile" "$writer_label" \
    'never to narrate what.*record history.*commented-out code' \
    "comment anti-pattern policy"
  if grep -Eqi 'after[[:space:]]+(any|every)[[:space:]]+implementation.*npm test' "$writer_profile"; then
    fail "$writer_label prescribes root npm test after implementation"
    policy_errors=1
  else
    pass "$writer_label does not prescribe root npm test after implementation"
  fi
done

check_policy_pattern "$QA_PROFILE" "QA profile" \
  'Review changed files only' \
  "changed-file-only review boundary"
check_policy_pattern "$QA_PROFILE" "QA profile" \
  '\.opencode/skills/development-conventions/references/useful-comments/guidelines\.md' \
  "useful-comments guideline path"
check_policy_pattern "$QA_PROFILE" "QA profile" \
  'not a separate or broad pass' \
  "no separate or broad comment pass"
check_policy_pattern "$REPO_ROOT/AGENTS.md" "AGENTS.md" \
  'writers and reviewers must read .*\.opencode/skills/development-conventions/references/useful-comments/guidelines\.md' \
  "useful-comments pre-flight reference for writers and reviewers"

# FULL_ACCEPTANCE must remain a named contract of checks, not a trigger for a
# repository-wide test sweep that ordinary feature work can inherit.
check_policy_pattern "$ORCHESTRATOR" "orchestrator" \
  'FULL_ACCEPTANCE.*declared acceptance checks.*not automatically all repository tests' \
  "declared-acceptance-not-all-tests rule"
check_policy_pattern "$ORCHESTRATOR" "orchestrator" \
  'Ordinary feature work must not expand into broad suites' \
  "ordinary-work broad-suite prohibition"

# Orchestration is non-interactive: it remediates reproducible in-scope defects
# autonomously and returns ESCALATE_USER only for the permitted hard boundaries.
AUTONOMY_POLICY_SOURCES=(
  "$ORCHESTRATOR"
  "$REPO_ROOT/AGENTS.md"
  "$REPO_ROOT/docs/configure/agents.md"
)
for policy_source in "${AUTONOMY_POLICY_SOURCES[@]}"; do
  policy_label="${policy_source#"$REPO_ROOT"/}"
  check_normalized_policy_pattern "$policy_source" "$policy_label" \
    'Orchestration executes declared scoped tests, standard verification, in-scope source fixes, and any declared deployment autonomously. It never asks the user for permission to test, diagnose, fix, retry, package, scan, configure, run, or deploy work that is already within the declared user scope.' \
    "autonomous scoped source-fix and deployment policy"
  check_policy_pattern "$policy_source" "$policy_label" \
    'Only Plan mode may use interactive decision questions\.|The built-in Plan mode is the sole explicit override and may use interactive decision questions; custom agents may not\.' \
    "Plan-mode-only interactive decision policy"
  check_policy_pattern "$policy_source" "$policy_label" \
    'Orchestration never invokes the `question` tool' \
    "question-tool prohibition"
  check_policy_pattern "$policy_source" "$policy_label" \
    'external credential.*access.*(attempted configured path|configured path was attempted)' \
    "configured credential/access escalation boundary"
done

# QA and security can report bounded findings, but their permissions and policy
# prose must not allow them to hand work to one another or revive a closed task.
QA_PROFILE="$AGENTS_DIR/execution/ingenium-qa.md"
SECURITY_PROFILE="$AGENTS_DIR/security/ingenium-security-auditor.md"
validate_reporting_agent_task_denial "$QA_PROFILE" "QA profile"
validate_reporting_agent_task_denial "$SECURITY_PROFILE" "security profile"

REVIEWER_HANDOFF_POLICY_SOURCES=(
  "$ORCHESTRATOR"
  "$REPO_ROOT/AGENTS.md"
  "$REPO_ROOT/docs/configure/agents.md"
  "$WORKFLOW_POLICY_SOURCE"
  "$AGENT_LIMITS_SOURCE"
  "$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/agent-workflow-patterns/references/finite-task-contract.md"
  "$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/orchestrator-primer/source-index.md"
  "$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/orchestrator-primer/references/orchestrator-flow.md"
  "$QA_PROFILE"
  "$SECURITY_PROFILE"
)
for policy_source in "${REVIEWER_HANDOFF_POLICY_SOURCES[@]}"; do
  policy_label="${policy_source#"$REPO_ROOT"/}"
  if [[ ! -r "$policy_source" ]]; then
    fail "$policy_label is missing for reviewer-handoff validation"
    policy_errors=1
    continue
  fi
  stale_handoff="$(grep -Ein \
    'QA[[:space:]]+and[[:space:]]+security[[:space:]]+(must|will|automatically)[[:space:]]+(spawn|dispatch|trigger|schedule)' \
    "$policy_source" || true)"
  if [[ -n "$stale_handoff" ]]; then
    fail "$policy_label contains unbounded QA/security handoff wording: $stale_handoff"
    policy_errors=1
  else
    pass "$policy_label contains no unbounded QA/security handoff wording"
  fi
done

for policy_source in "${AUTONOMY_POLICY_SOURCES[@]}"; do
  policy_label="${policy_source#"$REPO_ROOT"/}"
  check_normalized_policy_regex_pattern "$policy_source" "$policy_label" \
    'qa.{0,320}security.{0,320}(once.{0,160}(implementation|wave|review)|wait.{0,200}(finalized|implementation)|post[-[:space:]]+wave)' \
    "bounded QA/security post-wave reporting policy"
  check_policy_pattern "$policy_source" "$policy_label" \
    'minimum targeted regression' \
    "reviewer-blocker targeted-regression policy"
done

# These patterns intentionally vary by document format.  That makes this a
# real cross-source check instead of merely checking that the files exist.
check_policy_pattern "$ORCHESTRATOR" "orchestrator" \
  '6-Active / 3-Writer Phase Scheduler' \
  "the 6-active/3-writer scheduler declaration"
check_policy_pattern "$ORCHESTRATOR" "orchestrator" \
  '^\| \*\*Active subagents per phase\*\* \| 6 \|' \
  "the max-6 active concurrency table entry"
check_policy_pattern "$ORCHESTRATOR" "orchestrator" \
  '^\| \*\*Concurrent writers per wave\*\* \| 3 \|' \
  "the max-3 writer concurrency table entry"
check_policy_pattern "$ORCHESTRATOR" "orchestrator" \
  'Phase Declaration Protocol' \
  "the phase declaration protocol"

check_policy_pattern "$REPO_ROOT/AGENTS.md" "AGENTS.md" \
  '## 🔴 Orchestration Policy — 6-Active / 3-Writer Phase Scheduler' \
  "the 6-active/3-writer scheduler declaration"
check_policy_pattern "$REPO_ROOT/AGENTS.md" "AGENTS.md" \
  '^\| \*\*Active subagents per phase\*\* \| 6 \|' \
  "the max-6 active concurrency table entry"
check_policy_pattern "$REPO_ROOT/AGENTS.md" "AGENTS.md" \
  '^\| \*\*Concurrent writers per wave\*\* \| 3 \|' \
  "the max-3 writer concurrency table entry"
check_policy_pattern "$REPO_ROOT/AGENTS.md" "AGENTS.md" \
  'Phase Declaration Protocol' \
  "the phase declaration protocol"

check_normalized_policy_pattern "$REPO_ROOT/docs/configure/agents.md" "docs/configure/agents.md" \
  '6 active subagents max, 3 concurrent writers max' \
  "the max-6/max-3 behavioral policy"
check_policy_pattern "$REPO_ROOT/docs/configure/agents.md" "docs/configure/agents.md" \
  'Phase Declaration' \
  "the phase declaration protocol"
check_policy_pattern "$REPO_ROOT/docs/configure/agents.md" "docs/configure/agents.md" \
  'max 6' \
  "a max-6 phase limit"
check_policy_pattern "$REPO_ROOT/docs/configure/agents.md" "docs/configure/agents.md" \
  'max 3' \
  "a max-3 writer limit"

check_policy_pattern "$WORKFLOW_POLICY_SOURCE" "workflow source-index" \
  'Maximum 6 active subagents per phase' \
  "the max-6 active policy"
check_policy_pattern "$WORKFLOW_POLICY_SOURCE" "workflow source-index" \
  'Maximum 3 concurrent writers per wave' \
  "the max-3 writer policy"
check_policy_pattern "$WORKFLOW_POLICY_SOURCE" "workflow source-index" \
  'Mandatory phase declarations' \
  "the phase declaration requirement"

check_policy_pattern "$AGENT_LIMITS_SOURCE" "agent-limits.md" \
  'Canonical Policy: 6 Active / 3 Writers' \
  "the canonical max-6/max-3 policy heading"
check_policy_pattern "$AGENT_LIMITS_SOURCE" "agent-limits.md" \
  '^\| \*\*Max active subagents per phase\*\* \| 6 \|' \
  "the max-6 active limit"
check_policy_pattern "$AGENT_LIMITS_SOURCE" "agent-limits.md" \
  '^\| \*\*Max concurrent writers\*\* \| 3 \|' \
  "the max-3 writer limit"
check_policy_pattern "$AGENT_LIMITS_SOURCE" "agent-limits.md" \
  'Mandatory Phase Declarations' \
  "the phase declaration requirement"

# A stale policy claim must mention concurrency/phase/wave semantics.  This
# avoids confusing the valid 12 logical-profile count with a stale 12/6
# scheduling limit while still catching 12/6 and 6/6 policy variants.
STALE_POLICY_PATTERN='(^|[^[:alnum:]])12[[:space:]_-]*(active|concurrent)[[:space:]_-]*(sub)?agents?([^[:alnum:]]|$).*(phase|wave|limit|concurr|simultaneous|writer)|(^|[^[:alnum:]])(phase|wave|limit|concurr|simultaneous|writer).*(12[[:space:]_-]*(active|concurrent)[[:space:]_-]*(sub)?agents?|12[[:space:]_-]*writers?)|(^|[^[:alnum:]])12[[:space:]]*/[[:space:]]*6([^[:alnum:]]|$)|(^|[^[:alnum:]])6[[:space:]]*/[[:space:]]*6([^[:alnum:]]|$)|(^|[^[:alnum:]])6[[:space:]_-]*(concurrent[[:space:]_-]*)?writers?([^[:alnum:]]|$)|(^|[^[:alnum:]])max(imum)?[[:space:]]+(of[[:space:]]+)?6[[:space:]_-]*(concurrent[[:space:]_-]*)?writers?([^[:alnum:]]|$)'
for policy_source in "${DOCUMENTED_POLICY_SOURCES[@]}"; do
  stale_policy="$(grep -Ein "$STALE_POLICY_PATTERN" "$policy_source" || true)"
  if [[ -n "$stale_policy" ]]; then
    fail "$(basename "$policy_source") contains stale 12/6 or 6/6 policy text: $stale_policy"
    policy_errors=1
  else
    pass "$(basename "$policy_source") contains no stale 12/6 or 6/6 policy text"
  fi
done

# Writer references in policy prose are checked against the permissions-derived
# writer index.  This deliberately accepts ingenium-docs and browser-agent;
# hard-coding only the two software engineers was the original QA defect.
writer_agents="$(grep -Ei 'Writers[[:space:]]*\(count|\(writer([,)]|[[:space:]])' "$ORCHESTRATOR" | grep -Eo '@[[:alnum:]-]+' | sort -u || true)"
unexpected_writers=""
while IFS= read -r writer_ref; do
  [[ -z "$writer_ref" ]] && continue
  writer_name="${writer_ref#@}"
  if [[ -z "${WRITER_NAMES[$writer_name]:-}" ]]; then
    unexpected_writers+="$writer_ref\n"
  fi
done <<< "$writer_agents"
if [[ -n "$unexpected_writers" ]]; then
  fail "orchestrator references non-writer profiles as writers: $(printf '%b' "$unexpected_writers")"
  policy_errors=1
else
  pass "orchestrator writer references match permissions-derived writer profiles"
fi

capture_example() {
  local source="$1"
  local start_marker="$2"
  local end_marker="$3"
  awk -v start="$start_marker" -v end="$end_marker" '
    index($0, start) { capture = 1 }
    capture { print }
    capture && index($0, end) { exit }
  ' "$source"
}

allocation_is_valid() {
  local active_count="$1"
  local writer_count="$2"
  local non_writer_count="$3"
  local available_non_writer_slots

  if ! [[ "$active_count" =~ ^[0-9]+$ &&
          "$writer_count" =~ ^[0-9]+$ &&
          "$non_writer_count" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  available_non_writer_slots=$((MAX_ACTIVE_SUBAGENTS - writer_count))
  (( active_count <= MAX_ACTIVE_SUBAGENTS &&
     writer_count <= MAX_CONCURRENT_WRITERS &&
     non_writer_count <= available_non_writer_slots &&
     writer_count + non_writer_count == active_count ))
}

validate_wave_block() {
  local label="$1"
  local block="$2"
  local active_count=0
  local writer_count=0
  local non_writer_count=0
  local agent_line agent_ref agent_name
  local -a agent_lines=()
  mapfile -t agent_lines < <(
    printf '%s\n' "$block" | grep -E '^[[:space:]]+@[[:alnum:]-]+' || true
  )

  for agent_line in "${agent_lines[@]}"; do
    active_count=$((active_count + 1))
    while IFS= read -r agent_ref; do
      [[ -z "$agent_ref" ]] && continue
      agent_name="${agent_ref#@}"
      if [[ -z "${NAMES[$agent_name]:-}" ]]; then
        fail "$label references unknown agent $agent_ref"
        policy_errors=1
      elif [[ -n "${WRITER_NAMES[$agent_name]:-}" ]]; then
        writer_count=$((writer_count + 1))
        if [[ "$agent_line" != *"(writer"* ]]; then
          fail "$label omits writer annotation for permissions-derived writer $agent_ref"
          policy_errors=1
        fi
      elif [[ "$agent_line" == *"(writer"* ]]; then
        fail "$label marks permissions-derived non-writer $agent_ref as a writer"
        policy_errors=1
      else
        non_writer_count=$((non_writer_count + 1))
      fi
    done < <(printf '%s\n' "$agent_line" | grep -Eo '@[[:alnum:]-]+' || true)
  done

  if allocation_is_valid "$active_count" "$writer_count" "$non_writer_count"; then
    max_non_writer_count=$((MAX_ACTIVE_SUBAGENTS - writer_count))
    pass "$label stays within max 6 active agents, max 3 writers, and max $max_non_writer_count non-writers for $writer_count writers ($active_count/$writer_count/$non_writer_count)"
  else
    fail "$label exceeds max 6 active agents, max 3 writers, or the dynamic non-writer capacity of 6-writers, or has an unclassified agent ($active_count/$writer_count/$non_writer_count)"
    policy_errors=1
  fi

  local declared_active="" declared_writers="" declared_non_writers=""
  if [[ "$block" =~ \(([0-9]+)[[:space:]]+active,[[:space:]]*([0-9]+)[[:space:]]+writers?,[[:space:]]*([0-9]+)[[:space:]]+non[-[:space:]]writers? ]]; then
    declared_active="${BASH_REMATCH[1]}"
    declared_writers="${BASH_REMATCH[2]}"
    declared_non_writers="${BASH_REMATCH[3]}"
  elif [[ "$block" =~ Active:[[:space:]]*([0-9]+),[[:space:]]*Writers:[[:space:]]*([0-9]+),[[:space:]]*Non[-[:space:]]writers:[[:space:]]*([0-9]+) ]]; then
    declared_active="${BASH_REMATCH[1]}"
    declared_writers="${BASH_REMATCH[2]}"
    declared_non_writers="${BASH_REMATCH[3]}"
  fi
  if [[ -n "$declared_active" ]]; then
    if [[ "$declared_active" -eq "$active_count" && \
          "$declared_writers" -eq "$writer_count" && \
          "$declared_non_writers" -eq "$non_writer_count" ]]; then
      pass "$label declaration matches observed agents ($declared_active/$declared_writers/$declared_non_writers)"
    else
      fail "$label declares $declared_active/$declared_writers/$declared_non_writers but contains $active_count/$writer_count/$non_writer_count"
      policy_errors=1
    fi
  fi
  return 0
}

validate_example_block() {
  local source="$1"
  local label="$2"
  local start_marker="$3"
  local end_marker="$4"
  local block
  block="$(capture_example "$source" "$start_marker" "$end_marker")"

  if [[ -z "$block" ]]; then
    fail "$label is missing or unreadable"
    policy_errors=1
    return
  fi

  # A single captured example can contain several serialized waves.  Validate
  # each wave independently so the writer cap is measured concurrently, while
  # still checking every dispatch line in the example.
  local line wave_block="" wave_index=0 saw_wave=0
  while IFS= read -r line; do
    if [[ "$line" == Phase:*Wave* || "$line" == "Post-writer wave:"* || "$line" =~ ^[[:space:]]*Wave[[:space:]][0-9]+ || "$line" =~ ^[[:space:]]*Post-writer ]]; then
      if [[ "$saw_wave" -eq 1 ]]; then
        wave_index=$((wave_index + 1))
        validate_wave_block "$label wave $wave_index" "$wave_block"
      fi
      saw_wave=1
      wave_block="$line"
    elif [[ "$saw_wave" -eq 1 ]]; then
      wave_block+=$'\n'"$line"
    else
      wave_block+="$line"$'\n'
    fi
  done <<< "$block"
  if [[ "$saw_wave" -eq 1 ]]; then
    wave_index=$((wave_index + 1))
    validate_wave_block "$label wave $wave_index" "$wave_block"
  else
    validate_wave_block "$label" "$wave_block"
  fi
}

run_allocation_fixture_tests() {
  local fixture_file
  local label expected active_count writer_count non_writer_count actual

  ALLOCATION_FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ingenium-agent-validation.XXXXXX")"
  fixture_file="$ALLOCATION_FIXTURE_DIR/allocations.tsv"
  printf '%s\n' \
    'zero-writers-six-read-only|accept|6|0|6' \
    'one-writer-five-read-only|accept|6|1|5' \
    'two-writers-four-read-only|accept|6|2|4' \
    'three-writers-three-read-only|accept|6|3|3' \
    'three-writers-four-read-only|reject|7|3|4' \
    'four-writers|reject|4|4|0' \
    'unclassified-active-agent|reject|6|1|4' \
    > "$fixture_file"

  while IFS='|' read -r label expected active_count writer_count non_writer_count; do
    if allocation_is_valid "$active_count" "$writer_count" "$non_writer_count"; then
      actual='accept'
    else
      actual='reject'
    fi

    if [[ "$actual" == "$expected" ]]; then
      pass "allocation fixture $label is $actual"
    else
      fail "allocation fixture $label expected $expected but was $actual"
    fi
  done < "$fixture_file"

  ALLOCATION_FIXTURE_DIR=""
  cleanup_allocation_fixtures
}

run_allocation_fixture_tests

if [[ -f "$ORCHESTRATOR" ]]; then
  validate_example_block "$ORCHESTRATOR" \
    "orchestrator bounded dispatch example" \
    'Phase: "Validation message"' \
    '→ The writer completes the declared implementation and self-verification.'
fi
if [[ -f "$AGENT_LIMITS_SOURCE" ]]; then
  validate_example_block "$AGENT_LIMITS_SOURCE" \
    "agent-limits full-parallel example" \
    'Phase: "Implement auth + email + dashboard widgets"' \
    'Active:'
fi

if [[ "$policy_errors" -eq 0 ]]; then
  pass "all canonical policy sources and recognizable examples passed"
fi

CHAT_FILE="$AGENTS_DIR/chat/ingenium-chat.md"
if [[ ! -f "$CHAT_FILE" ]]; then
  fail "no chat agent profile found at $CHAT_FILE"
elif ! grep -q '^  edit: deny$' "$CHAT_FILE" || ! grep -q '^  write: deny$' "$CHAT_FILE" || ! grep -q '^  bash: deny$' "$CHAT_FILE" || ! grep -q '"\*": "deny"' "$CHAT_FILE"; then
  fail "canonical chat safety boundary is invalid"
else
  pass "canonical chat remains read-only and cannot delegate"
fi

FINITE_TASK_CONTRACT_SOURCE="$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/agent-workflow-patterns/references/finite-task-contract.md"
ORCHESTRATOR_PRIMER_SOURCE="$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/orchestrator-primer/source-index.md"
ORCHESTRATOR_FLOW_SOURCE="$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/orchestrator-primer/references/orchestrator-flow.md"
QA_PROFILE="$AGENTS_DIR/execution/ingenium-qa.md"
DOCS_PROFILE="$AGENTS_DIR/execution/ingenium-docs.md"
VISION_PROFILE="$AGENTS_DIR/execution/ingenium-qa-vision.md"
SECURITY_PROFILE="$AGENTS_DIR/security/ingenium-security-auditor.md"
SECURITY_POLICY="$REPO_ROOT/.opencode/skills/security-audit/SKILL.md"
CAUSAL_POLICY_SOURCES=(
  "$ORCHESTRATOR"
  "$REPO_ROOT/AGENTS.md"
  "$REPO_ROOT/docs/configure/agents.md"
  "$WORKFLOW_POLICY_SOURCE"
  "$AGENT_LIMITS_SOURCE"
  "$FINITE_TASK_CONTRACT_SOURCE"
  "$ORCHESTRATOR_PRIMER_SOURCE"
  "$ORCHESTRATOR_FLOW_SOURCE"
)
RECURSION_POLICY_SOURCES=(
  "${CAUSAL_POLICY_SOURCES[@]}"
  "$QA_PROFILE"
  "$DOCS_PROFILE"
  "$VISION_PROFILE"
  "$SECURITY_PROFILE"
  "$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/agent-workflow-patterns/references/visual-validation.md"
  "$SECURITY_POLICY"
)

causal_policy_errors=0

require_contract_pattern() {
  local source="$1"
  local label="$2"
  local pattern="$3"
  local description="$4"
  if grep -Eqi "$pattern" "$source"; then
    pass "$label $description"
  else
    fail "$label is missing $description"
    causal_policy_errors=1
  fi
}

require_normalized_contract_pattern() {
  local source="$1"
  local label="$2"
  local pattern="$3"
  local description="$4"
  local normalized_source

  normalized_source="$(tr '\n' ' ' < "$source" | tr -s '[:space:]' ' ' | tr '[:upper:]' '[:lower:]')"
  if [[ "$normalized_source" =~ $pattern ]]; then
    pass "$label $description"
  else
    fail "$label is missing $description"
    causal_policy_errors=1
  fi
}

# Roadmap terminal-state guard: an active append-only start marker means work is
# still open. The roadmap may describe per-task PASS criteria, but it must not
# claim final completion until every active marker is closed and reconciled.
validate_roadmap_terminal_state() {
  local active_ids
  active_ids="$(awk '
    /<!-- \(work-started\)/ { active[$3] = 1 }
    /<!-- \(work-complete\)/ { delete active[$3] }
    END { for (id in active) print id }
  ' "$ROADMAP_FILE" | sort)"

  if [[ -n "$active_ids" ]]; then
    if grep -Eqi 'final[[:space:]-]+completion|terminal[[:space:]-]+PASS|Only[[:space:]]+`?PASS`?' "$ROADMAP_FILE" && \
       ! grep -Eqi 'no final completion may be|does not end the turn with a progress or completion response' "$ROADMAP_FILE"; then
      fail "ROADMAP.md claims final completion while active work markers remain"
      causal_policy_errors=1
    else
      pass "ROADMAP.md blocks final PASS/completion while active markers remain"
    fi
    require_contract_pattern "$ROADMAP_FILE" "ROADMAP.md" 'TodoWrite.*(reconcil|live checklist)' 'active-marker/TodoWrite separation and reconciliation requirement'
  else
    pass "ROADMAP.md has no unreconciled active work markers"
  fi
  require_contract_pattern "$ROADMAP_FILE" "ROADMAP.md" \
    'explicit user.*STOP.*CANCELLED.*terminal|STOP.*CANCELLED.*only on an explicit user request|Only.*PASS.*ESCALATE_USER.*STOP.*CANCELLED' \
    'explicit-user-request STOP/CANCELLED task contracts'
  require_contract_pattern "$ROADMAP_FILE" "ROADMAP.md" \
    'Deployment owner|named authorized writer deployment owner.*Docker/Compose permission' \
    'task-level/runtime deployment owner requirement'
  require_contract_pattern "$ROADMAP_FILE" "ROADMAP.md" \
    'open-roadmap rule|active markers block terminal completion' \
    'open-roadmap terminal guard'
  require_contract_pattern "$ROADMAP_FILE" "ROADMAP.md" \
    'roadmap task or TodoWrite item is open' \
    'open-roadmap work detection'
  require_contract_pattern "$ROADMAP_FILE" "ROADMAP.md" \
    'immediately dispatches the next declared phase|autonomous resumption' \
    'open-roadmap synchronous resumption'
}

# Require a task-level deployment-owner field. Runtime tasks name an
# authorized Docker/Compose writer; documentation-only tasks explicitly use
# N/A rather than inheriting a document-wide statement.
validate_roadmap_task_deployment_owners() {
  local task=""
  local block=""
  local missing=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^#{3,4}[[:space:]]+[A-Z][A-Z0-9]*-[0-9]{3}[[:space:]]+[-—] ]]; then
      if [[ -n "$task" && "$block" != *"**Deployment owner:**"* ]]; then
        fail "ROADMAP.md task $task is missing a task-level Deployment owner"
        causal_policy_errors=1
        missing=1
      fi
      task="$line"
      block="$line"
    else
      block+=$'\n'$line
    fi
  done < "$ROADMAP_FILE"
  if [[ -n "$task" && "$block" != *"**Deployment owner:**"* ]]; then
    fail "ROADMAP.md task $task is missing a task-level Deployment owner"
    causal_policy_errors=1
    missing=1
  fi
  if [[ "$missing" -eq 0 ]]; then
    pass "ROADMAP.md declares a task-level Deployment owner for every task"
  fi
}

# The roadmap is the source of truth for task identity.  Do not maintain a
# second hard-coded allow-list here: new families (for example USAGE-*) must
# receive the same contract checks as the original BUG/MCP/CTX/DOC families.
validate_roadmap_task_contracts() {
  local task=""
  local block=""
  local line
  local errors=0
  local graph_block
  local token
  local prefix
  local start_number
  local end_number
  local number
  local next_task
  local -a required_fields=(
    '\*\*IN_SCOPE:\*\*'
    '\*\*OUT_OF_SCOPE:\*\*'
    '\*\*Owner:\*\*'
    '\*\*Dependencies:\*\*'
    '\*\*Acceptance:\*\*'
    '\*\*STOP_CONDITION:\*\*'
    '\*\*Escalation:\*\*'
    '\*\*Verification owner:\*\*'
    '\*\*Deployment owner:\*\*'
    '\*\*Rollback/safety:\*\*'
    '\*\*Tests:\*\*'
    '\*\*Docs:\*\*'
    '\*\*Exclusive writer territory:\*\*'
    '\*\*Phase/counts:\*\*'
    '\*\*Verification plan:\*\*'
    '\*\*Causal remediation rule:\*\*'
    '\*\*Finding classification:\*\*'
  )
  declare -A task_ids=()
  declare -A graph_task_ids=()

  validate_task_block() {
    local task_id="$1"
    local task_block="$2"
    local field
    for field in "${required_fields[@]}"; do
      if ! grep -Eqi -- "$field" <<<"$task_block"; then
        fail "ROADMAP.md task $task_id is missing contract field matching $field"
        causal_policy_errors=1
        errors=1
      fi
    done

    local phase_counts
    local phase_writers
    local phase_non_writers
    local max_phase_non_writers
    phase_counts="$(grep -Eio -- '-[[:space:]]+\*\*Phase/counts:\*\*[[:space:]]+.*' <<<"$task_block" | head -n 1 || true)"
    if [[ ! "$phase_counts" =~ ([0-9]+)[[:space:]]+writers?[[:space:]]*/[[:space:]]*([0-9]+)[[:space:]]+non[-[:space:]]*writers? ]]; then
      fail "ROADMAP.md task $task_id has an invalid Phase/counts allocation"
      causal_policy_errors=1
      errors=1
    else
      phase_writers="${BASH_REMATCH[1]}"
      phase_non_writers="${BASH_REMATCH[2]}"
      max_phase_non_writers=$((MAX_ACTIVE_SUBAGENTS - phase_writers))
      if [[ "$phase_writers" -gt "$MAX_CONCURRENT_WRITERS" || \
            "$phase_non_writers" -gt "$max_phase_non_writers" || \
            $((phase_writers + phase_non_writers)) -gt "$MAX_ACTIVE_SUBAGENTS" ]]; then
        fail "ROADMAP.md task $task_id exceeds the 6-active/3-writer/dynamic non-writer phase limits"
        causal_policy_errors=1
        errors=1
      fi
    fi
  }

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^#{3,4}[[:space:]]+([A-Z][A-Z0-9]*-[0-9]{3})([[:space:]]+[-—]) ]]; then
      next_task="${BASH_REMATCH[1]}"
      if [[ -n "$task" ]]; then
        validate_task_block "$task" "$block"
      fi
      task="$next_task"
      block="$line"
      if [[ -n "${task_ids[$task]:-}" ]]; then
        fail "ROADMAP.md repeats approved task ID $task"
        causal_policy_errors=1
        errors=1
      fi
      task_ids["$task"]=1
    elif [[ -n "$task" ]]; then
      block+=$'\n'"$line"
    fi
  done < "$ROADMAP_FILE"

  if [[ -n "$task" ]]; then
    validate_task_block "$task" "$block"
  fi
  if [[ "${#task_ids[@]}" -eq 0 ]]; then
    fail "ROADMAP.md has no approved task contracts"
    causal_policy_errors=1
    errors=1
  fi

  graph_block="$(awk '
    /^## Phase dependency graph and allocations$/ { capture = 1; next }
    capture && /^## / { exit }
    capture { print }
  ' "$ROADMAP_FILE")"
  if [[ -z "$graph_block" ]]; then
    fail "ROADMAP.md is missing the approved phase dependency graph"
    causal_policy_errors=1
    errors=1
  else
    while IFS= read -r token; do
      [[ -z "$token" ]] && continue
      if [[ "$token" =~ ^([A-Z][A-Z0-9]*)-([0-9]{3})\.\.([0-9]{3})$ ]]; then
        prefix="${BASH_REMATCH[1]}"
        start_number=$((10#${BASH_REMATCH[2]}))
        end_number=$((10#${BASH_REMATCH[3]}))
        if [[ "$start_number" -gt "$end_number" ]]; then
          fail "ROADMAP.md has a descending approved task range: $token"
          causal_policy_errors=1
          errors=1
          continue
        fi
        for ((number = start_number; number <= end_number; number++)); do
          graph_task_ids["$prefix-$(printf '%03d' "$number")"]=1
        done
      else
        graph_task_ids["$token"]=1
      fi
    done < <(grep -Eo '[A-Z][A-Z0-9]*-[0-9]{3}(\.\.[0-9]{3})?' <<<"$graph_block" | sort -u || true)

    if [[ "${#graph_task_ids[@]}" -eq 0 ]]; then
      fail "ROADMAP.md approved phase dependency graph declares no task IDs"
      causal_policy_errors=1
      errors=1
    fi
    for token in "${!graph_task_ids[@]}"; do
      if [[ -z "${task_ids[$token]:-}" ]]; then
        fail "ROADMAP.md phase graph references task without a contract: $token"
        causal_policy_errors=1
        errors=1
      fi
    done
    for token in "${!task_ids[@]}"; do
      if [[ -z "${graph_task_ids[$token]:-}" ]]; then
        fail "ROADMAP.md task is not present in the approved phase graph: $token"
        causal_policy_errors=1
        errors=1
      fi
    done
  fi

  if [[ "$errors" -eq 0 ]]; then
    pass "ROADMAP.md approved task IDs and contract fields are dynamic and complete (${#task_ids[@]} tasks)"
  fi
}

# The active roadmap may be replaced, but its dated archive and checksum sidecar
# must remain present.  Byte-level hash verification belongs to the append-only
# test; keep this policy test focused on the canonical artifact contract.
validate_roadmap_archive() {
  local archive
  local sidecar
  local recorded_hash
  local archive_errors=0
  local -a archives=()

  if [[ ! -d "$ROADMAP_ARCHIVE_DIR" ]]; then
    fail "roadmap archive directory is missing: $ROADMAP_ARCHIVE_DIR"
    causal_policy_errors=1
    return
  fi

  mapfile -t archives < <(find "$ROADMAP_ARCHIVE_DIR" -maxdepth 1 -type f -name 'ROADMAP-*.md' -print | sort)
  if [[ "${#archives[@]}" -eq 0 ]]; then
    fail "no canonical ROADMAP archive exists in $ROADMAP_ARCHIVE_DIR"
    causal_policy_errors=1
    return
  fi

  for archive in "${archives[@]}"; do
    sidecar="${archive}.sha256"
    if [[ ! -r "$sidecar" ]]; then
      fail "roadmap archive is missing its checksum sidecar: ${sidecar#"$REPO_ROOT"/}"
      causal_policy_errors=1
      archive_errors=1
      continue
    fi

    recorded_hash="$(awk 'NF { print $1; exit }' "$sidecar")"
    if [[ ! "$recorded_hash" =~ ^[[:xdigit:]]{64}$ ]]; then
      fail "roadmap archive checksum sidecar is malformed: ${sidecar#"$REPO_ROOT"/}"
      causal_policy_errors=1
      archive_errors=1
      continue
    fi

  done

  if [[ "$archive_errors" -eq 0 ]]; then
    pass "canonical roadmap archive(s) have SHA-256 sidecars (${#archives[@]})"
  fi
}

if [[ ! -r "$ROADMAP_FILE" ]]; then
  fail "ROADMAP.md is missing or unreadable"
else
  validate_roadmap_archive
  validate_roadmap_terminal_state
  validate_roadmap_task_deployment_owners
  validate_roadmap_task_contracts
fi

# The new phase contract is synchronous: a phase is a bounded six-agent
# barrier, with a dynamic read-only ceiling of six minus permission-derived
# writers.  Exclusive territories make the zero-overlap rule observable.
SYNCHRONOUS_PHASE_POLICY_SOURCES=(
  "$ROADMAP_FILE"
)
for policy_source in "${SYNCHRONOUS_PHASE_POLICY_SOURCES[@]}"; do
  if [[ ! -r "$policy_source" ]]; then
    fail "synchronous phase policy source is missing or unreadable: $policy_source"
    causal_policy_errors=1
    continue
  fi
  policy_label="${policy_source#"$REPO_ROOT"/}"
  require_contract_pattern "$policy_source" "$policy_label" \
    '(^|[^0-9])6[[:space:]-]+active|active[^[:alnum:]]+6' \
    'six-active phase ceiling'
  require_contract_pattern "$policy_source" "$policy_label" \
    '3[[:space:]-]+(concurrent[[:space:]-]+)?writers?' \
    'three-writer phase ceiling'
  require_contract_pattern "$policy_source" "$policy_label" \
    'synchron|serialized' \
    'synchronous phase execution'
  require_contract_pattern "$policy_source" "$policy_label" \
    'phase.*barrier|barrier.*(phase|wave|subwave)|(phase|wave).*(finish|complete|verif).*(before|prior to).*(next[[:space:]-]*)?(phase|wave)' \
    'synchronous phase barrier'
  require_contract_pattern "$policy_source" "$policy_label" \
    'zero[[:space:]-]+overlap|overlap.*zero|write territory overlap.*0|exclusive[[:space:]-]+territor' \
    'zero-overlap exclusive territory rule'
done

require_contract_pattern "$ROADMAP_FILE" "ROADMAP.md" \
  'Deployment owner' 'deployment-owner contract coverage'
require_contract_pattern "$ROADMAP_FILE" "ROADMAP.md" \
  'visual|1440x900|390x844|qa-vision' 'visual-gate contract coverage'
require_contract_pattern "$ROADMAP_FILE" "ROADMAP.md" \
  'QA/security.*once|QA.*security.*once|QA/security report' 'bounded QA/security review coverage'
require_contract_pattern "$ROADMAP_FILE" "ROADMAP.md" \
  'security-auditor|security' 'security-review contract coverage'

for policy_source in "${CAUSAL_POLICY_SOURCES[@]}"; do
  if [[ ! -r "$policy_source" ]]; then
    fail "causal policy source is missing or unreadable: $policy_source"
    causal_policy_errors=1
    continue
  fi
  policy_label="${policy_source#"$REPO_ROOT"/}"
  require_contract_pattern "$policy_source" "$policy_label" 'IN_SCOPE' 'IN_SCOPE declaration'
  require_contract_pattern "$policy_source" "$policy_label" 'OUT_OF_SCOPE' 'OUT_OF_SCOPE declaration'
  require_contract_pattern "$policy_source" "$policy_label" 'acceptance criteria' 'acceptance criteria declaration'
  require_contract_pattern "$policy_source" "$policy_label" 'STOP_CONDITION' 'STOP_CONDITION declaration'
  require_contract_pattern "$policy_source" "$policy_label" 'verification plan' 'verification plan declaration'
  require_contract_pattern "$policy_source" "$policy_label" 'escalation rule' 'escalation rule declaration'
  require_contract_pattern "$policy_source" "$policy_label" 'bounded diagnosis' 'bounded diagnosis declaration'
  require_contract_pattern "$policy_source" "$policy_label" 'external credential.*destructive.*mutually exclusive product.*genuinely ambiguous.*reproducible root cause' 'five-condition escalation taxonomy'
  require_contract_pattern "$policy_source" "$policy_label" 'root.?cause.*(regression|remediation)' 'causal remediation/proving-regression link'
  require_contract_pattern "$policy_source" "$policy_label" 'BLOCKING' 'BLOCKING finding classification'
  require_contract_pattern "$policy_source" "$policy_label" 'FOLLOW_UP' 'FOLLOW_UP finding classification'
  require_contract_pattern "$policy_source" "$policy_label" 'INFORMATIONAL' 'INFORMATIONAL finding classification'
  require_normalized_contract_pattern "$policy_source" "$policy_label" \
    'stop.{0,80}cancelled.{0,180}terminal' \
    'terminal STOP/CANCELLED handling'
done

# Autonomous-completion contract regressions: policy text must retain the
# roadmap state machine and all release gates, not merely source-test guidance.
for policy_source in "${CAUSAL_POLICY_SOURCES[@]}"; do
  policy_label="${policy_source#"$REPO_ROOT"/}"
  require_contract_pattern "$policy_source" "$policy_label" \
    'roadmap execution continues autonomously.*every scoped roadmap task.*evidence-backed completion' \
    'autonomous evidence-backed roadmap completion'
  require_contract_pattern "$policy_source" "$policy_label" \
    'never report completion from source tests alone' \
    'source-tests-alone completion prohibition'
  require_contract_pattern "$policy_source" "$policy_label" \
    'runtime-impacting changes require.*deployment owner.*deployment (owner|wave)' \
    'deployment owner/wave requirement'
  require_contract_pattern "$policy_source" "$policy_label" \
    'rebuild.*restart.*current merged source.*health-check.*actual routes' \
    'current-source deployment and route health-check loop'
  require_contract_pattern "$policy_source" "$policy_label" \
    'visual/ui gates and full acceptance are mandatory' \
    'visual/UI and full-acceptance terminal gates'
  require_contract_pattern "$policy_source" "$policy_label" \
    'roadmap markers.*TodoWrite' \
    'roadmap-marker/TodoWrite reconciliation'
done
require_contract_pattern "$ORCHESTRATOR" "orchestrator" \
  'QA and security each run once per declared review boundary' \
  'single QA/security boundary'
require_contract_pattern "$ORCHESTRATOR" "orchestrator" \
  'writer fix triggers only its targeted proving recheck' \
  'targeted-only writer recheck'
require_contract_pattern "$ORCHESTRATOR" "orchestrator" \
  'STOP.*CANCELLED.*only when explicitly requested.*remediation request' \
  'explicit-request STOP/CANCELLED boundary'
require_contract_pattern "$ORCHESTRATOR" "orchestrator" \
  'named.*authorized.*deployment owner.*writer.*Docker/Compose' \
  'named authorized writer Docker/Compose deployment owner'

# Open-roadmap turn boundary: open roadmap/TodoWrite work requires immediate
# continuation, and context pressure or partial/unverified work is not terminal.
OPEN_ROADMAP_TURN_SOURCES=(
  "$ORCHESTRATOR"
  "$REPO_ROOT/AGENTS.md"
  "$REPO_ROOT/.opencode/skills/engineering-workflow/SKILL.md"
  "$WORKFLOW_POLICY_SOURCE"
  "$AGENT_LIMITS_SOURCE"
  "$FINITE_TASK_CONTRACT_SOURCE"
  "$ORCHESTRATOR_PRIMER_SOURCE"
  "$ORCHESTRATOR_FLOW_SOURCE"
)
for policy_source in "${OPEN_ROADMAP_TURN_SOURCES[@]}"; do
  policy_label="${policy_source#"$REPO_ROOT"/}"
  require_contract_pattern "$policy_source" "$policy_label" \
    'roadmap task or.*TodoWrite.*item remains open.*must not emit a normal final/progress response.*end a turn as a status update.*require a user reprompt.*immediately dispatch the next declared phase' \
    'open-roadmap immediate-dispatch turn rule'
  require_contract_pattern "$policy_source" "$policy_label" \
    'token/turn pressure.*partial agent completion.*unverified source changes are never terminal reasons' \
    'non-terminal pressure/partial/unverified conditions'
  require_contract_pattern "$policy_source" "$policy_label" \
    'Only .*PASS.*ESCALATE_USER.*explicit user-requested.*STOP.*explicit user-requested.*CANCELLED.*end a turn' \
    'exclusive terminal response states'
done

require_contract_pattern "$ORCHESTRATOR" "orchestrator" 'Only an .*in-scope.*BLOCKING.*reopen' 'in-scope blocker-only reopening'
require_contract_pattern "$ORCHESTRATOR" "orchestrator" 'never auto-dispatch' 'out-of-scope dispatch prohibition'
require_contract_pattern "$QA_PROFILE" "QA profile" 'targeted QA invocation' 'single targeted QA invocation'
require_contract_pattern "$QA_PROFILE" "QA profile" 'sole owner.*full E2E.*container suite' 'single full-suite owner'
require_contract_pattern "$QA_PROFILE" "QA profile" 'never dispatch remediation, Docs, another QA pass' 'no recursive QA/Docs dispatch'
require_contract_pattern "$DOCS_PROFILE" "Docs profile" 'directly affected canonical documentation or the user explicitly requests' 'conditional documentation scope'
require_contract_pattern "$DOCS_PROFILE" "Docs profile" 'never dispatch or request QA, Docs' 'no recursive Docs dispatch'
require_contract_pattern "$VISION_PROFILE" "Vision profile" 'one changed-route visual gate.*final UI change' 'post-final-change route gate'
require_contract_pattern "$VISION_PROFILE" "Vision profile" 'one passive full-site sweep.*user-requested UI batch' 'one batch sweep'
require_contract_pattern "$VISION_PROFILE" "Vision profile" 'smallest route recheck.*root cause fixed' 'causal visual recheck'
require_contract_pattern "$VISION_PROFILE" "Vision profile" 'Docs-only and non-UI work never opens or reopens' 'non-UI visual-gate prohibition'
require_contract_pattern "$SECURITY_PROFILE" "security profile" 'current diff.*relevant dependency' 'current-diff/dependency default'
require_contract_pattern "$SECURITY_PROFILE" "security profile" 'history scan may run.*once' 'one-time history scan'
require_contract_pattern "$SECURITY_PROFILE" "security profile" 'confirmed secret exposure.*critical explicit trigger' 'history-scan trigger boundary'
require_contract_pattern "$SECURITY_PROFILE" "security profile" 'outside scope.*FOLLOW_UP.*immediately exploitable' 'out-of-scope security classification'
require_contract_pattern "$SECURITY_POLICY" "security policy" 'history scan may run.*once' 'one-time history scan'

# Documentation authority is repository-first. Direct Docs Workspace mutation is
# an explicit-user-request path, never an automatic post-change/session action.
DOC_AUTHORITY_SOURCES=(
  "$REPO_ROOT/AGENTS.md"
  "$REPO_ROOT/.opencode/skills/mcp-tooling/SKILL.md"
  "$REPO_ROOT/.opencode/skills/documentation/SKILL.md"
  "$DOCS_PROFILE"
  "$REPO_ROOT/.opencode/agents/execution/ingenium-software-engineer-fast.md"
  "$REPO_ROOT/.opencode/agents/execution/ingenium-software-engineer-premium.md"
  "$REPO_ROOT/docs/configure/agents.md"
  "$REPO_ROOT/docs/reference/docs-workspace.md"
)
for policy_source in "${DOC_AUTHORITY_SOURCES[@]}"; do
  policy_label="${policy_source#"$REPO_ROOT"/}"
  require_contract_pattern "$policy_source" "$policy_label" 'normal documentation authority' 'repository-first documentation authority'
  require_contract_pattern "$policy_source" "$policy_label" 'explicit(ly)? (user )?request' 'explicit-request Workspace boundary'
done

if grep -Eqi 'save context to the Ingenium Docs workspace|Full Export at Session End|MUST:.*session summary|Do NOT ask permission.*save' "$REPO_ROOT/.opencode/skills/mcp-tooling/SKILL.md"; then
  fail "mcp-tooling retains an automatic Docs Workspace write/session-export mandate"
  causal_policy_errors=1
else
  pass "mcp-tooling has no automatic Docs Workspace write/session-export mandate"
fi

for engineer_profile in \
  "$REPO_ROOT/.opencode/agents/execution/ingenium-software-engineer-fast.md" \
  "$REPO_ROOT/.opencode/agents/execution/ingenium-software-engineer-premium.md"; do
  if grep -Eq '^  ingenium_docs_(create|update|delete|restore|move|save_draft|import_pages|add_tag|remove_tag|create_comment|resolve_comment|delete_comment|create_space):' "$engineer_profile"; then
    fail "$(basename "$engineer_profile") grants unnecessary direct Docs Workspace mutation"
    causal_policy_errors=1
  else
    pass "$(basename "$engineer_profile") denies direct Docs Workspace mutation by default"
  fi
done

# Scenario regressions: ordinary in-scope failures must remain actionable, while
# the five real decision/access boundaries remain the only normal escalation.
require_contract_pattern "$ORCHESTRATOR" "scenario: scanner rejection auto-fix" \
  'compile, test, package, scanner, configuration, or runtime defect.*concrete reproducible root cause' \
  'recognizes scanner rejection as autonomous remediation work'
require_contract_pattern "$ORCHESTRATOR" "scenario: scanner rejection auto-fix" \
  'source fix.*targeted test.*deploy.*acceptance' \
  'continues the planned feature pipeline after a source fix'
require_contract_pattern "$ORCHESTRATOR" "scenario: reviewer blocker fixed once" \
  'After a writer fixes an in-scope reviewer blocker.*minimum targeted regression' \
  'runs only the proving regression'
require_contract_pattern "$ORCHESTRATOR" "scenario: reviewer blocker fixed once" \
  'Do not rerun QA or security unless.*review boundary' \
  'prevents a second reviewer chain'
require_contract_pattern "$ORCHESTRATOR" "scenario: unavailable external credential" \
  'required external credential or access.*attempted configured path' \
  'is a permitted ESCALATE_USER boundary'
require_contract_pattern "$ORCHESTRATOR" "scenario: permitted escalation taxonomy" \
  'destructive or irreversible.*authorization' \
  'covers unauthorized destructive work'
require_contract_pattern "$ORCHESTRATOR" "scenario: permitted escalation taxonomy" \
  'mutually exclusive product decision' \
  'covers product decisions'
require_contract_pattern "$ORCHESTRATOR" "scenario: permitted escalation taxonomy" \
  'genuinely ambiguous' \
  'covers genuine ambiguity'
require_contract_pattern "$ORCHESTRATOR" "scenario: permitted escalation taxonomy" \
  'bounded diagnosis.*reproducible root cause' \
  'covers unreproduced causes after diagnosis'
require_contract_pattern "$SECURITY_PROFILE" "scenario: unrelated security finding" \
  'outside scope.*FOLLOW_UP.*immediately exploitable' \
  'is classified FOLLOW_UP rather than blocking release'

# Reject both recursive reviewer instructions and the old retry-count terminal
# rule. Keep this narrowly scoped to policy language; historical/security
# terminology outside these canonical sources is not an execution instruction.
STALE_POLICY_PATTERNS=(
  'after[[:space:]]+every[[:space:]]+(subagent[[:space:]]+)?(task|change)'
  'mandatory[[:space:]]+after[[:space:]]+every[[:space:]]+change'
  'all[[:space:]]+sub-agent[[:space:]]+outputs[[:space:]]+must[[:space:]]+be[[:space:]]+audited'
  'every[[:space:]]+sub-agent[[:space:]]+finding[[:space:]]+must[[:space:]]+be[[:space:]]+added'
  'iterative[[:space:]]+testing[[:space:]]+required[[:space:]]+until'
  'before[[:space:]]+final[[:space:]]+completion[[:space:]]+or[[:space:]]+commit.*full-site'
  'automatically[[:space:]]+escalate.*git[[:space:]-]*history'
  'automatically[[:space:]]+scan[[:space:]]+git[[:space:]-]*history'
  'maximum[[:space:]]+(of[[:space:]]+)?3[[:space:]]+verification[[:space:]]+phases'
  'each[[:space:]]+individual[[:space:]]+check.*(at[[:space:]]+most|may[[:space:]]+execute).*2'
  'one[[:space:]]+writer[[:space:]]+remediation[[:space:]]+round'
  'second[[:space:]]+failed.*is[[:space:]]+terminal'
  'second[[:space:]]+failed.*return.*ESCALATE_USER'
  'if[[:space:]]+the[[:space:]]+recheck.*ESCALATE_USER'
  'STOP[[:space:]]+and[[:space:]]+CANCELLED[[:space:]]+are[[:space:]]+terminal:'
)
for policy_source in "${RECURSION_POLICY_SOURCES[@]}"; do
  [[ -r "$policy_source" ]] || continue
  for stale_pattern in "${STALE_POLICY_PATTERNS[@]}"; do
    stale_match="$(grep -Ein "$stale_pattern" "$policy_source" || true)"
    if [[ -n "$stale_match" ]]; then
      fail "$(basename "$policy_source") contains stale recursive or premature-escalation policy text: $stale_match"
      causal_policy_errors=1
    fi
  done
done

if [[ "$causal_policy_errors" -eq 0 ]]; then
  pass "causal task contracts, bounded diagnosis, cancellation, and non-recursive policy invariants hold"
fi

for removed_phase_path in \
  "$REPO_ROOT/scripts/phase-commit.sh" \
  "$REPO_ROOT/config/phase-commit.conf" \
  "$REPO_ROOT/tests/test-phase-commit.sh"; do
  if [[ -e "$removed_phase_path" ]]; then
    fail "obsolete phase commit path still exists: ${removed_phase_path#"$REPO_ROOT"/}"
  fi
done

ORDINARY_GIT_POLICY_SOURCES=(
  "${DOCUMENTED_POLICY_SOURCES[@]}"
  "$REPO_ROOT/docs/develop/testing.md"
  "$REPO_ROOT/.opencode/skills/engineering-workflow/SKILL.md"
  "$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/agent-workflow-patterns/references/finite-task-contract.md"
  "$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/orchestrator-primer/source-index.md"
  "$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/orchestrator-primer/references/orchestrator-flow.md"
)

if grep -Eqi 'phase-commit|Phase ID|Begin SHA|Expected end commit owner|verify-history|active phase|phase boundary' "${ORDINARY_GIT_POLICY_SOURCES[@]}"; then
  fail "active workflow authority still contains obsolete phase commit machinery"
elif ! grep -Fq "Manual and user-created commits are valid" "${DOCUMENTED_POLICY_SOURCES[@]}" || \
     ! grep -Fq "ordinary non-interactive Git" "${DOCUMENTED_POLICY_SOURCES[@]}" || \
     ! grep -Fq '`gh`' "${DOCUMENTED_POLICY_SOURCES[@]}" || \
     ! grep -Fq "never block continued" "${DOCUMENTED_POLICY_SOURCES[@]}"; then
  fail "active workflow authority does not document the ordinary Git/GitHub workflow"
else
  pass "phase commit machinery is removed and ordinary Git/GitHub workflow is authoritative"
fi

if [[ "$FAILED" -ne 0 ]]; then exit 1; fi
