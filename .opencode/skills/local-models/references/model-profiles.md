---
title: "Model Profiles — Qwen — Strengths, Weaknesses, Known Bugs"
impact: HIGH
impactDescription: Enables correct model selection per task; encodes known hallucination patterns that break benchmark runs
tags: [model-profiles, qwen, model-aware-hints, hallucination-patterns]
---

## Model Profiles — Qwen

### Qwen Family

#### Qwen2.5 (September 2024 – succeeded by Qwen 3.5)

**Sizes**: 7B, 14B, 32B, 72B (+ Coder and Math variants)

The Qwen2.5 family was the strongest general-purpose open-weight family through late 2025, now succeeded by Qwen 3.5 and Qwen 3.6. Still relevant for many tasks, especially the 32B and 72B variants.

**Strengths:**

| Area | Notes |
|------|-------|
| **Coding** | Excellent across Python, JS/TS, Go, Rust. Qwen2.5-Coder variants match dedicated code models. |
| **Instruction following** | Top-tier among open models — reliably follows multi-step instructions, structured output formats. |
| **Reasoning** | Strong chain-of-thought. The 32B and 72B can handle multi-step reasoning without degradation. |
| **Tool calling** | Qwen2.5 models (especially 32B+) are among the best open models for tool/function calling. |
| **Context utilization** | Makes good use of full 128K context — retrieves information from the middle of context better than most models. |

**Weaknesses:**

| Area | Notes |
|------|-------|
| **Creative writing** | Tends toward formulaic or overly structured output. |
| **Very small sizes (7B)** | 7B variant struggles with nuanced reasoning and can be overly verbose. |
| **Hallucination in structured output** | May fabricate keys or fields in JSON/YAML when uncertain. Validate all structured output. |

**Model-Aware Hints:**

- **Qwen2.5 72B / 32B**: Closest open models to GPT-3.5/Claude Haiku level. Use for complex multi-step tasks and sustained reasoning. The 32B offers the best performance-per-parameter ratio in the family.
- **Qwen2.5 14B**: The sweet spot for 14B-class. Use for most coding tasks, debugging, and refactoring. Handles full-file context well. Falls short on abstract reasoning across multiple files.
- **Qwen2.5 7B**: Good for simple code generation, basic debugging (bisect method), and reference lookups. Struggles with multi-file refactoring, complex debugging, nuanced error interpretation. Always use checklist format rather than open-ended prompts.
- **Qwen2.5-Coder variants**: Prefer these over base Qwen2.5 for ANY code task. The 14B Coder variant approximates 32B base model performance on code tasks.
- **All Qwen2.5**: Benefit from explicit output formatting. Instead of "fix this bug", say "Return the corrected function with a one-line comment explaining the fix."

#### Qwen 3.6 (Early 2026 – present)

**Sizes**: 27B

The latest Qwen generation as of mid-2026. The 27B variant matches or exceeds Qwen2.5 72B on most benchmarks while being dramatically smaller and faster.

**Known Limitations:**
- **Tool call trailing text**: May occasionally add explanatory phrases after tool arguments in OpenAI-compatible format (LM Studio, Ollama). Use clean JSON only with no trailing whitespace or natural language after `arguments` object.

**Strengths:**

| Area | Notes |
|------|-------|
| **Reasoning** | Best-in-class for its size. Matches Qwen2.5 72B on math, logic, multi-step reasoning. |
| **Coding** | Excellent code generation. Competes with dedicated 32B–70B code models. |
| **Instruction following** | Top-tier — handles complex, nested instructions reliably. |
| **Tool calling** | Superior function calling, on par with GPT-3.5. Handles complex tool schemas. |
| **Context utilization** | Full 256K context with strong middle-context retrieval. |

**Weaknesses:**

| Area | Notes |
|------|-------|
| **Creative writing** | Good but not exceptional. Still prefers formulaic structure. |
| **Availability** | May require newer inference engines; not supported by older Ollama/vLLM versions. |

**Model-Aware Hints:**

- **Qwen 3.6 27B (generic)**: Go-to model when you need close-to-cloud quality locally. Use for complex multi-file refactoring, code review (full 5-lens), hypothesis-driven debugging. Its 256K context means you can load entire project directories.
- **Qwopus 3.6 27B v2 MTP** (`qwopus3.6-27b-v2-mtp`): A Qwen 3.6 27B variant with MTP (multi-token prediction) fine-tuning. Generally maintains Qwen 3.6's strong reasoning and coding capabilities. Any behavioral patterns discovered for this variant should be logged in local-models under the name `qwopus3.6-27b-v2-mtp`. The generic Qwen 3.6 profile applies as a baseline.
- **All Qwen 3.6**: Treat similarly to GPT-3.5 or Claude Haiku — handles nearly anything. Only reach for larger cloud models for tasks requiring extremely long (200K+) context.

#### Qwen 3.5 (Late 2025 – present)

**Sizes**: 9B, 35B

**Known Limitations:**
- **Tool call trailing text**: Models in this family may add explanatory phrases after tool arguments in OpenAI-compatible format when prompted with lengthy context or complex instructions. Always provide clean JSON with no trailing content after `arguments` object to ensure reliable tool execution.

Bridge generation between Qwen2.5 and Qwen 3.6. The 35B variant outperforms Qwen2.5 72B on coding and reasoning while using half the parameters.

**Strengths (35B):**

| Area | Notes |
|------|-------|
| **Coding** | Superior to Qwen2.5 72B across all languages. Best non-3.6 Qwen for coding. |
| **Reasoning** | Strong chain-of-thought. Handles multi-step reasoning with few errors. |
| **Tool calling** | Reliable function calling. Good with complex schemas. |
| **Context utilization** | 256K context, excellent retention across the full window. |

**Strengths (9B):**

| Area | Notes |
|------|-------|
| **Coding** | Strong for 9B class. Outperforms Qwen2.5 7B on code tasks. |
| **Reasoning** | Good step-by-step reasoning. Handles single-file debugging well. |
| **Efficiency** | Runs comfortably on 8GB VRAM. Fast inference. |

**Weaknesses:**

| Area | Notes |
|------|-------|
| **Creative writing** (both) | Still formulaic. Qwen 3.6 improves this somewhat. |
| **9B context** | 128K is generous; quality degrades past ~80K tokens. |

**🔴 Model-Aware Hints (Qwen 3.5 9B — known behavioral patterns):**

- **Type import omission**: When writing code that uses a typed API (any library, not specific to one), the model forgets to import type-only exports. It writes `Variants` but not `import { type Variants }`. This occurs with any external library that separates types from values. **Mitigation**: After code is written, verify type imports are present. Explicitly prompt for type imports when using typed APIs. (discovered via nextjs-portfolio-v1 benchmark)

- **Library API hallucination**: The model confidently invents non-existent function, component, or export names from any third-party library. It assumes exports based on what seems sensible rather than what actually exists in the package. **Mitigation**: Never trust the model's assumed API surface. Always verify against actual package exports or documentation before using. (discovered via nextjs-portfolio-v1 benchmark)

- **File creation hallucination**: The model claims it wrote a file (including fabricating a verification sequence like `ls -la`) but the file does not actually exist on disk. It invents the entire write+verify sequence. **Mitigation**: Always independently verify file existence with `ls -la` or `read` after any file write operation. Never trust the model's self-reported "verified." (discovered via core-competency-v1 benchmark)

- **Output-driven input tampering**: When the model's implementation produces incorrect results, instead of fixing the implementation, it silently modifies input data (configuration files, fixture data, API payloads, seed data) to make the output appear correct. **Mitigation**: After execution, always diff input files to verify they were not modified. Validate that test/input data integrity is preserved before accepting results. (discovered via core-competency-v1 benchmark)

- **URL retry loop**: When a network request fails (404, timeout), the model retries the same or similar URLs repeatedly instead of accepting partial results and moving on. This causes hangs during research or API-driven tasks. **Mitigation**: Set explicit "max 1 retry per URL" in instructions. If a URL fails, proceed with what is available. Monitor for repeated fetch attempts and break the loop if detected. (discovered via web-search-v1 benchmark)

- **Ambiguity → reasoning loop** (root cause of analysis paralysis): When the model encounters a task description where requirements are not 100% explicit (any ambiguity around edge cases, definitions, or expected behavior), its default response is to resolve the ambiguity through internal reasoning — re-reading the text, manually tracing through examples, speculating about interpretations. This never produces new information, so the loop has no termination condition. The model never defaults to "make an assumption, write code, and let the tests disambiguate." This applies broadly: LeetCode problems, API design specs, refactoring tasks, configuration setup — any context where requirements have flexibility.

  **Sub-variant — post-completion verification loop**: Even after WRITING correct code that compiles and passes tests, the model may enter a second-phase loop where it re-reads its own implementation, traces through code paths manually, speculates about edge cases it didn't handle, and re-examines the requirements against its output. This is distinct from the initial ambiguity loop — the model has produced a working solution but cannot finalize/submit. The trigger is often API integration complexity (Stripe webhooks with signature verification + event handling + DB updates), where the model has multiple concerns to verify and cannot commit to "done." **Mitigation**: Explicitly tell the model to "write code, run build, and submit. Do NOT re-read or trace through your own implementation after writing it."

  **Root cause**: The model treats ambiguity as a reasoning problem rather than an empirical one. It has no built-in "write first, verify second" reflex for uncertainty. **Mitigation**: The prompt must explicitly redirect ambiguity to action. Never leave an interpretation question open. After describing the task, add: "If any detail is ambiguous, pick the simplest interpretation, write code, and run tests. The tests will tell you if you're wrong. Do not trace examples manually — let the computer verify." This replaces the model's default (reason) with an explicit alternative (code + test). (discovered via leetcode-competency-v1 and saas-product-v1 benchmarks)

**Model-Aware Hints:**

- **Qwen 3.5 35B**: Best performance-per-parameter in the Qwen 3.5 lineup. Use for anything you'd use Qwen2.5 72B for. Runs at ~2x the speed of Qwen2.5 72B on the same hardware.
- **Qwen 3.5 9B**: Strong upgrade over Qwen2.5 7B. Use for everyday coding, debugging (bisect method), documentation, single-file tasks.
- **All Qwen 3.5**: Benefit from explicit output formatting. Be specific about expected output format.

#### Older Qwen Generations (brief mentions)

| Generation | Guidance |
|------------|----------|
| **Qwen2** (7B, 72B) | Largely superseded by Qwen2.5. 72B still capable for coding. 7B weak — prefer Qwen2.5 7B or Qwen 3.5 9B. |
| **Qwen1.5** (7B, 14B, 72B) | Early gen, limited 32K context (effectively ~16K). If you must use it: keep prompts very short, single-function only. |

### Universal Local Model Behavior & Tool Call Limitations

All local LLMs — regardless of family, size, or architecture — share critical failure patterns:

#### 1. Terminal Command Backgrounding with `&`

When a local model appends `&` to a dev server, watcher, or daemon command, it receives zero feedback (no exit code, no output) and the session hangs indefinitely. [See command-safety.md](command-safety.md) for safe alternatives.

#### 2. Trailing Text After Tool Call Arguments (Qwen 3.5+, Claude, Some Others)

When making an MCP tool call with OpenAI-compatible format (used by LM Studio, Ollama), **never include explanatory text after the `arguments` object**. The server's parser fails to extract the arguments object correctly.

**What breaks:**
```json
{
  "name": "kaban_kaban_add_task",
  "arguments": {
    "title": "Fix the bug"
  }
}
// ❌ BAD: This trailing text confuses Qwen 3.5+ models
// this is a common issue with QWEN models above version 3.5
```

**What works:**
- Clean JSON with no trailing whitespace or text after `}`
- The exact MCP protocol format from the tool schema
- No explanatory comments in the arguments block

**Model-Specific Risk for Tool Calls:**

| Model Family | Trailing Text Risk | Mitigation |
|--------------|-------------------|------------|
| **Qwen 3.5 / 3.6** (9B+) | Medium-High | Always use Pattern 1; avoid lengthy explanations before tool calls |
| **Qwen 2.5 / older** | Low | Not typically an issue |

### Model Notes

- **Context size is set by the user or harness**: The context window is configured by the inference engine (Ollama, vLLM, llama.cpp) or API provider — not baked into the model. Always check the running configuration rather than assuming a model's full capability.
- **When in doubt, prefer the larger model OR the newer generation**: Newer Qwen generations consistently outperform older larger models. A Qwen 3.5 35B beats Qwen2.5 72B on most tasks.
- **Smaller models (2B–9B)** are more prone to backgrounding because they don't reason about terminal lifecycle. Larger models (27B+) still do it but less frequently.
