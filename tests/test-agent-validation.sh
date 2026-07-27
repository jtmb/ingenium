#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS_DIR="$REPO_ROOT/.opencode/agents"
CONFIG="$REPO_ROOT/opencode.json"
EXPECTED_LOGICAL_AGENT_COUNT=12
MAX_ACTIVE_SUBAGENTS=6
MAX_CONCURRENT_WRITERS=3
FAILED=0

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

# Collect active agent files (YAML frontmatter only)
mapfile -t AGENT_FILES < <(find "$AGENTS_DIR" -type f -name '*.md' -print | sort)
mapfile -t AGENT_FILES < <(for file in "${AGENT_FILES[@]}"; do [[ "$(head -n 1 "$file")" == '---' ]] && printf '%s\n' "$file"; done)

if [[ "${#AGENT_FILES[@]}" -eq 0 ]]; then
  fail "no active agent profiles found"
  exit 1
fi

# Check frontmatter completeness and no Markdown model field.
# Old agent topology tolerates the duplicate root-level ingenium-chat.md
# (it mirrors chat/ingenium-chat.md for legacy OpenCode discovery).
declare -A NAMES=()
declare -A HIDDEN_NAMES=()
declare -A WRITER_NAMES=()
declare -A NON_WRITER_NAMES=()
for file in "${AGENT_FILES[@]}"; do
  name="$(basename "$file" .md)"

  # Read name from frontmatter for accurate dedup
  fm_name="$(grep -m1 '^name:' "$file" | sed 's/^name: *//')"
  [[ -z "$fm_name" ]] && fm_name="$name"

  # Detect hidden agents
  if grep -q '^hidden:.*true' "$file"; then
    HIDDEN_NAMES["$fm_name"]=1
  fi

  if profile_has_writer_permission "$file"; then
    WRITER_NAMES["$fm_name"]=1
  fi

  # Tolerate duplicate root-level ingenium-chat (canonical copy in chat/ subdirectory)
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

# ============================================================
# 1. Validate Prompt Engineer and Terra agent files are absent
# ============================================================
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

# ============================================================
# 2. Verify non-hidden active agents (except hidden ingenium-llm-broker)
#    have model mappings in centralized opencode.json with case-sensitive
#    variant validation by provider
# ============================================================
# Build list of active agent names, excluding hidden ingenium-llm-broker
declare -a CHECK_NAMES=()
for name in "${!NAMES[@]}"; do
  # Skip hidden ingenium-llm-broker — system-internal agent, no model mapping required
  [[ "$name" == "ingenium-llm-broker" ]] && continue
  CHECK_NAMES+=("$name")
done
if [[ "${#CHECK_NAMES[@]}" -gt 0 ]]; then
  if [[ "${#CHECK_NAMES[@]}" -ne $((EXPECTED_LOGICAL_AGENT_COUNT - 1)) ]]; then
    fail "expected $((EXPECTED_LOGICAL_AGENT_COUNT - 1)) centralized model mappings, found ${#CHECK_NAMES[@]}"
  else
    pass "$((EXPECTED_LOGICAL_AGENT_COUNT - 1)) non-broker profiles require centralized model mappings"
  fi
  node - "$CONFIG" "${CHECK_NAMES[@]}" <<'NODE' || FAILED=1
const fs = require("fs");
const [configPath, ...activeNames] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const agent = config.agent || {};
const errors = [];

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
console.log("PASS: centralized config model mappings + case-sensitive variant validation");
NODE
else
  pass "no active non-hidden agents to check (skipped)"
fi

# ============================================================
# 2b. Canonical active-model guidance must match opencode.json.
#     Only inspect the explicit local-model active-assignment references;
#     historical examples, drafts, and archived material are not authority.
# ============================================================
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

# ============================================================
# 2c. Canonical agent docs must respect QA Vision's denied Bash permission.
#     Keep this an explicit allow-list so drafts and archives cannot affect it.
# ============================================================
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

# ============================================================
# 3. Validate no stale Terra/Prompt Engineer task allow entries
#    in orchestrator
# ============================================================
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
  local -a expected_rules=(
    'git add *'
    'git commit *'
    'git push *'
    'git rev-parse --short HEAD'
    'npm test*'
    'npm run test*'
    'npm run build*'
    'npm run typecheck*'
    'npx tsc*'
    'npx playwright test*'
    'python -m pytest*'
    'pytest*'
    'go test*'
    'go build*'
    'cargo test*'
    'cargo check*'
    'cargo build*'
  )
  local -a bash_rules=()
  declare -A expected_rules_set=()
  declare -A seen_rules=()

  for rule in "${expected_rules[@]}"; do
    expected_rules_set["$rule"]=1
  done

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
    elif [[ "$action" == "allow" && -n "${expected_rules_set[$command]:-}" ]]; then
      if [[ -n "${seen_rules[$command]:-}" ]]; then
        fail "orchestrator bash permissions contain duplicate allow rule: $command"
        errors=1
      else
        seen_rules["$command"]=1
      fi
    elif [[ "$command" == "*" && "$action" == "deny" ]]; then
      if [[ -n "${seen_rules['*|deny']:-}" ]]; then
        fail "orchestrator bash permissions contain duplicate wildcard deny rules"
        errors=1
      else
        seen_rules['*|deny']=1
      fi
    else
      fail "orchestrator bash permissions contain an unexpected rule: $command ($action)"
      errors=1
    fi
  done

  for rule in "${expected_rules[@]}"; do
    if [[ -z "${seen_rules[$rule]:-}" ]]; then
      fail "orchestrator bash permissions are missing intended rule: $rule"
      errors=1
    fi
  done

  if [[ "$errors" -eq 0 ]]; then
    pass "orchestrator has deny-by-default bash permissions limited to git coordination and test/build verification"
    return 0
  fi
  return 1
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
  if [[ "$task_delegation_valid" -eq 1 && "$bash_permissions_valid" -eq 1 ]]; then
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

# ============================================================
# 4. Validate every canonical policy source and recognizable examples.
#    Policy copies must agree on the 6-active/3-writer limits.  Examples are
#    checked by observed @agent lines, rather than trusting their prose.
# ============================================================
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

validate_wave_block() {
  local label="$1"
  local block="$2"
  local active_count=0
  local writer_count=0
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
      fi
    done < <(printf '%s\n' "$agent_line" | grep -Eo '@[[:alnum:]-]+' || true)
  done

  if [[ "$active_count" -le "$MAX_ACTIVE_SUBAGENTS" && "$writer_count" -le "$MAX_CONCURRENT_WRITERS" ]]; then
    pass "$label stays within max 6 active agents and max 3 permission-derived writers ($active_count/$writer_count)"
  else
    fail "$label exceeds max 6 active/3 permission-derived writers ($active_count/$writer_count)"
    policy_errors=1
  fi

  local declared_active="" declared_writers=""
  if [[ "$block" =~ \(([0-9]+)[[:space:]]+active,[[:space:]]*([0-9]+)[[:space:]]+writers ]]; then
    declared_active="${BASH_REMATCH[1]}"
    declared_writers="${BASH_REMATCH[2]}"
  elif [[ "$block" =~ Active:[[:space:]]*([0-9]+),[[:space:]]*Writers:[[:space:]]*([0-9]+) ]]; then
    declared_active="${BASH_REMATCH[1]}"
    declared_writers="${BASH_REMATCH[2]}"
  fi
  if [[ -n "$declared_active" ]]; then
    if [[ "$declared_active" -eq "$active_count" && "$declared_writers" -eq "$writer_count" ]]; then
      pass "$label declaration matches observed agents ($declared_active/$declared_writers)"
    else
      fail "$label declares $declared_active/$declared_writers but contains $active_count/$writer_count"
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

# ============================================================
# 5. Chat read-only safety boundary — canonical profile in chat/ subdirectory
# ============================================================
CHAT_FILE="$AGENTS_DIR/chat/ingenium-chat.md"
if [[ ! -f "$CHAT_FILE" ]]; then
  fail "no chat agent profile found at $CHAT_FILE"
elif ! grep -q '^  edit: deny$' "$CHAT_FILE" || ! grep -q '^  write: deny$' "$CHAT_FILE" || ! grep -q '^  bash: deny$' "$CHAT_FILE" || ! grep -q '"\*": "deny"' "$CHAT_FILE"; then
  fail "canonical chat safety boundary is invalid"
else
  pass "canonical chat remains read-only and cannot delegate"
fi

# ============================================================
# 6. Finite-execution policy contract.  These checks intentionally inspect
#    canonical profiles and policy references, not archives or historical
#    examples. They make recursive QA/Docs/security/visual execution a static
#    regression rather than a runtime surprise.
# ============================================================
FINITE_TASK_CONTRACT_SOURCE="$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/agent-workflow-patterns/references/finite-task-contract.md"
ORCHESTRATOR_PRIMER_SOURCE="$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/orchestrator-primer/source-index.md"
ORCHESTRATOR_FLOW_SOURCE="$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/orchestrator-primer/references/orchestrator-flow.md"
QA_PROFILE="$AGENTS_DIR/execution/ingenium-qa.md"
DOCS_PROFILE="$AGENTS_DIR/execution/ingenium-docs.md"
VISION_PROFILE="$AGENTS_DIR/execution/ingenium-qa-vision.md"
SECURITY_PROFILE="$AGENTS_DIR/security/ingenium-security-auditor.md"
SECURITY_POLICY="$REPO_ROOT/.opencode/skills/security-audit/SKILL.md"
FINITE_POLICY_SOURCES=(
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
  "${FINITE_POLICY_SOURCES[@]}"
  "$QA_PROFILE"
  "$DOCS_PROFILE"
  "$VISION_PROFILE"
  "$SECURITY_PROFILE"
  "$REPO_ROOT/.opencode/skills/engineering-workflow/references/sources/agent-workflow-patterns/references/visual-validation.md"
  "$SECURITY_POLICY"
)

finite_policy_errors=0

require_contract_pattern() {
  local source="$1"
  local label="$2"
  local pattern="$3"
  local description="$4"
  if grep -Eqi "$pattern" "$source"; then
    pass "$label $description"
  else
    fail "$label is missing $description"
    finite_policy_errors=1
  fi
}

for policy_source in "${FINITE_POLICY_SOURCES[@]}"; do
  if [[ ! -r "$policy_source" ]]; then
    fail "finite policy source is missing or unreadable: $policy_source"
    finite_policy_errors=1
    continue
  fi
  policy_label="${policy_source#"$REPO_ROOT"/}"
  require_contract_pattern "$policy_source" "$policy_label" 'IN_SCOPE' 'IN_SCOPE declaration'
  require_contract_pattern "$policy_source" "$policy_label" 'OUT_OF_SCOPE' 'OUT_OF_SCOPE declaration'
  require_contract_pattern "$policy_source" "$policy_label" 'acceptance criteria' 'acceptance criteria declaration'
  require_contract_pattern "$policy_source" "$policy_label" 'STOP_CONDITION' 'STOP_CONDITION declaration'
  require_contract_pattern "$policy_source" "$policy_label" 'verification budget' 'verification budget declaration'
  require_contract_pattern "$policy_source" "$policy_label" 'escalation rule' 'escalation rule declaration'
  require_contract_pattern "$policy_source" "$policy_label" 'maximum( of)? .*3.*verification phases' 'maximum three verification phases'
  require_contract_pattern "$policy_source" "$policy_label" 'each individual check.*(at most|may execute).*2' 'two executions per individual check'
  require_contract_pattern "$policy_source" "$policy_label" 'maximum( of)? .*1.*writer remediation' 'one writer remediation round'
  require_contract_pattern "$policy_source" "$policy_label" 'second failed.*ESCALATE_USER' 'second-failure escalation'
  require_contract_pattern "$policy_source" "$policy_label" 'BLOCKING' 'BLOCKING finding classification'
  require_contract_pattern "$policy_source" "$policy_label" 'FOLLOW_UP' 'FOLLOW_UP finding classification'
  require_contract_pattern "$policy_source" "$policy_label" 'INFORMATIONAL' 'INFORMATIONAL finding classification'
  require_contract_pattern "$policy_source" "$policy_label" 'STOP.*CANCELLED.*terminal' 'terminal STOP/CANCELLED handling'
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
require_contract_pattern "$VISION_PROFILE" "Vision profile" 'one visual writer-fix/recheck maximum' 'single visual recheck'
require_contract_pattern "$VISION_PROFILE" "Vision profile" 'Docs-only and non-UI work never opens or reopens' 'non-UI visual-gate prohibition'
require_contract_pattern "$SECURITY_PROFILE" "security profile" 'current diff.*relevant dependency' 'current-diff/dependency default'
require_contract_pattern "$SECURITY_PROFILE" "security profile" 'history scan may run.*once' 'one-time history scan'
require_contract_pattern "$SECURITY_PROFILE" "security profile" 'confirmed secret exposure.*critical explicit trigger' 'history-scan trigger boundary'
require_contract_pattern "$SECURITY_PROFILE" "security profile" 'outside scope.*FOLLOW_UP.*immediately exploitable' 'out-of-scope security classification'
require_contract_pattern "$SECURITY_POLICY" "security policy" 'history scan may run.*once' 'one-time history scan'

# Reject phrasing that previously made downstream work automatic or unbounded.
# Keep this narrowly scoped to policy language; historical/security terminology
# outside these canonical sources is not an execution instruction.
STALE_RECURSION_PATTERNS=(
  'after[[:space:]]+every[[:space:]]+(subagent[[:space:]]+)?(task|change)'
  'mandatory[[:space:]]+after[[:space:]]+every[[:space:]]+change'
  'all[[:space:]]+sub-agent[[:space:]]+outputs[[:space:]]+must[[:space:]]+be[[:space:]]+audited'
  'every[[:space:]]+sub-agent[[:space:]]+finding[[:space:]]+must[[:space:]]+be[[:space:]]+added'
  'iterative[[:space:]]+testing[[:space:]]+required[[:space:]]+until'
  'before[[:space:]]+final[[:space:]]+completion[[:space:]]+or[[:space:]]+commit.*full-site'
  'automatically[[:space:]]+escalate.*git[[:space:]-]*history'
  'automatically[[:space:]]+scan[[:space:]]+git[[:space:]-]*history'
)
for policy_source in "${RECURSION_POLICY_SOURCES[@]}"; do
  [[ -r "$policy_source" ]] || continue
  for stale_pattern in "${STALE_RECURSION_PATTERNS[@]}"; do
    stale_match="$(grep -Ein "$stale_pattern" "$policy_source" || true)"
    if [[ -n "$stale_match" ]]; then
      fail "$(basename "$policy_source") contains unbounded recursive policy text: $stale_match"
      finite_policy_errors=1
    fi
  done
done

if [[ "$finite_policy_errors" -eq 0 ]]; then
  pass "finite task contracts, bounded gates, cancellation, and non-recursive policy invariants hold"
fi

if [[ "$FAILED" -ne 0 ]]; then exit 1; fi
