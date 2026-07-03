---
name: model-profiles
description: "Model-aware instruction tuning for local LLMs — Qwen and Gemma families across 2B–72B parameter ranges. Use when adapting prompts, choosing model-appropriate strategies, or diagnosing model-specific failure patterns."
---

# Model Profiles

## When to Use

- You are running a local LLM (Ollama, LM Studio, vLLM, llama.cpp) and want to know its capabilities
- A skill's generic guidance needs model-specific adaptation
- You're choosing which model to use for a particular task (coding, reasoning, chat, structured output)
- You're debugging why a model produced unexpectedly poor output
- You want to tailor prompts, chain-of-thought, or tool usage patterns to the specific model

## 🔴 HARD RULE — Know Your Model's Context Window

Every model has a maximum context length. Exceeding it silently truncates the oldest content, which can cause the model to lose track of instructions, file contents, or conversation history.

| Model | Max context | Effective working limit | Recommendation |
|-------|-------------|------------------------|----------------|
| Gemma 3 27B | 128K tokens | ~96K tokens before quality degrades | Safe for large files, multi-file projects |
| Gemma 3 9B / 7B | 128K tokens | ~64K tokens | Good for medium projects; degrade past 64K |
| Gemma 3 2B | 128K tokens | ~32K tokens | Small projects only beyond 32K |
| Gemma 2 27B | 8K tokens | ~6K tokens | Very limited — keep contexts short |
| Gemma 2 9B / 2B | 8K tokens | ~6K tokens | Same — short contexts only |
| Qwen2.5 72B | 128K tokens | ~96K tokens | Excellent for large contexts |
| Qwen2.5 32B | 128K tokens | ~96K tokens | Same as 72B in context handling |
| Qwen2.5 14B | 128K tokens | ~64K tokens | Good for medium projects |
| Qwen2.5 7B | 128K tokens | ~32K tokens | Keep prompts focused, avoid large files |
| Qwen2.5-Coder 7B/14B | 128K tokens | ~64K tokens | Good for code-heavy contexts |
| Qwen2 7B | 32K tokens | ~24K tokens | Moderate context; prefer Qwen2.5 |
| Qwen1.5 7B/14B | 32K tokens | ~16K tokens | Limited; upgrade to Qwen2.5 if possible |

**Practical rule of thumb**: If the skill or project files exceed half the model's max context, split the work into smaller turns or use a model with a larger context window.

---

## Qwen Family

### Qwen2.5 (September 2024 – present)

**Sizes**: 7B, 14B, 32B, 72B (+ Coder and Math variants)

The Qwen2.5 family is the strongest general-purpose open-weight family as of mid-2026, especially the 32B and 72B variants. Strong across coding, reasoning, and instruction-following.

#### Strengths

| Area | Notes |
|------|-------|
| **Coding** | Excellent across Python, JS/TS, Go, Rust. Qwen2.5-Coder variants match dedicated code models. |
| **Instruction following** | Top-tier among open models — reliably follows multi-step instructions, structured output formats, and constraint lists. |
| **Reasoning** | Strong chain-of-thought. The 32B and 72B can handle multi-step reasoning without degradation. |
| **Tool calling** | Qwen2.5 models (especially 32B+) are among the best open models for tool/function calling. |
| **Context utilization** | Makes good use of full 128K context — retrieves information from the middle of context better than most models. |

#### Weaknesses

| Area | Notes |
|------|-------|
| **Creative writing** | Tends toward formulaic or overly structured output. Not ideal for open-ended creative tasks. |
| **Very small sizes (7B)** | 7B variant struggles with nuanced reasoning and can be overly verbose without adding value. |
| **Hallucination in structured output** | May fabricate keys or fields in JSON/YAML when uncertain. Validate all structured output. |

#### Model-Aware Hints

- **Qwen2.5 72B / 32B**: These are the closest open models to GPT-3.5/Claude Haiku level. Use them for complex multi-step tasks, code generation, and any task requiring sustained reasoning over many turns. The 32B offers the best performance-per-parameter ratio in the family.
- **Qwen2.5 14B**: The sweet spot for 14B-class models. Use for most coding tasks, debugging, and refactoring. Handles full-file context well. Falls short on tasks requiring abstract reasoning across multiple files.
- **Qwen2.5 7B**: Good for simple code generation, basic debugging (bisect method preferred over hypothesis-driven), and reference lookups. Struggles with: multi-file refactoring, complex debugging, nuanced error interpretation. Always use the checklist format from `code-review-checklist` rather than open-ended review prompts.
- **Qwen2.5-Coder variants**: Prefer these over the base Qwen2.5 for ANY code task. They produce more idiomatic code, fewer hallucinated APIs, and better handle language-specific conventions. The 14B Coder variant approximates 32B base model performance on code tasks.
- **All Qwen2.5**: They benefit from explicit output formatting. Instead of "fix this bug", say "Return the corrected function with a one-line comment explaining the fix." Be specific about format.

### Qwen2 (June 2024 – superseded)

**Sizes**: 7B, 72B

Largely superseded by Qwen2.5. The 72B variant is still capable but the 7B variant is noticeably weaker than Qwen2.5 7B.

| Aspect | Guidance |
|--------|----------|
| Qwen2 72B | Still strong for coding. Prefer Qwen2.5 72B if available. |
| Qwen2 7B | Weak instruction following. Use only for simple, single-step tasks. Prefer Gemma 3 9B or Qwen2.5 7B instead. |

### Qwen1.5 (February 2024 – superseded)

**Sizes**: 7B, 14B, 72B

Early generation. Limited context window (32K, effectively ~16K). Mostly superseded but may still be in use.

| Aspect | Guidance |
|--------|----------|
| General | Prefer Qwen2.5 or Gemma 3 for any new work. |
| If you must use it | Keep prompts very short. No multi-file context. Use only for single-function code generation. |

---

## Gemma Family

### Gemma 3 (March 2025 – present)

**Sizes**: 2B, 7B, 9B, 27B

Google's latest open model family. The 27B variant is a standout: it competes with Qwen2.5 32B in many areas while being smaller and faster. The 9B variant is the strongest 9B-class model available.

#### Strengths

| Area | Notes |
|------|-------|
| **Reasoning** | Excellent step-by-step reasoning across all sizes. The 27B rivals Qwen2.5 32B on math and logic. |
| **Instruction quality** | Very good at following detailed, nuanced instructions without losing track. |
| **Multilingual** | Strong across many languages, not just English. Better than Qwen for non-English prompts. |
| **Safety / refusal** | Well-tuned — rarely refuses legitimate requests, appropriately declines unsafe ones. |
| **Conciseness** | Gemma 3 models (especially 9B and 27B) produce more concise output than equivalently-sized Qwen models. Less verbose. |
| **Creative tasks** | Better than Qwen at open-ended creative writing, brainstorming, and narrative tasks. |

#### Weaknesses

| Area | Notes |
|------|-------|
| **Tool calling** | Weaker than Qwen2.5 at structured function calling. May not format tool calls correctly. |
| **Code (vs specialized models)** | Good at code but behind Qwen2.5-Coder and dedicated code models. |
| **Very small sizes (2B)** | The 2B variant is impressive for its size but cannot handle complex multi-step tasks. |
| **Hallucination patterns** | When uncertain, Gemma tends to produce plausible-sounding but incorrect explanations rather than admitting uncertainty. |

#### Model-Aware Hints

- **Gemma 3 27B**: The best single model in the Gemma family. Use for reasoning tasks, debugging, code review, and general-purpose work. Its main advantage over Qwen2.5 32B is speed (smaller model, faster inference) and conciseness (less verbose output). Its main disadvantage is weaker tool calling.
- **Gemma 3 9B**: The strongest 9B model available. Use this as the default for everyday tasks — code generation (simple to moderate), debugging (bisect method), documentation, and question answering. It outperforms Qwen2.5 14B on reasoning but falls slightly behind on code quality.
- **Gemma 3 7B**: Similar to 9B but noticeably weaker at complex reasoning. Use for simple code generation, text processing, and reference lookups. Not recommended for debugging or multi-step tasks.
- **Gemma 3 2B**: Extremely limited. Acceptable for classification, simple formatting, and single-command generation. Do NOT use for debugging, refactoring, code review, or any task requiring sustained attention.
- **All Gemma 3**: Gemma's conciseness is an advantage for speed but can cause it to skip steps. Add explicit "show your reasoning" or "explain step by step" to prompts for complex tasks. This counteracts Gemma's tendency to jump to conclusions.
- **Gemma 3 + tool calling**: If you need reliable function calling, prefer Qwen2.5. Gemma 3 27B can handle simple tool calls but may fail on complex schemas.

### Gemma 2 (June 2024 – superseded)

**Sizes**: 2B, 9B, 27B

Predecessor to Gemma 3. The 27B variant was strong for its time but is now superseded by Gemma 3 27B. Limited 8K context window is the main constraint.

| Aspect | Guidance |
|--------|----------|
| Gemma 2 27B | Still capable for short-context tasks. Use Gemma 3 27B if available. |
| Gemma 2 9B | Decent but Gemma 3 9B is significantly better in every dimension. |
| Gemma 2 2B | Very limited. Prefer Gemma 3 2B or any larger model. |

**Critical constraint**: 8K context window means you cannot show full files or maintain long conversations. Work in short turns with focused prompts.

### Gemma 1 (February 2024 – superseded)

**Sizes**: 2B, 7B

First generation. Largely obsolete. Only relevant if you're running an older setup.

| Aspect | Guidance |
|--------|----------|
| Gemma 1 7B | Weak instruction following. Prefer Gemma 3 9B or Qwen2.5 7B. |
| Gemma 1 2B | Essentially unusable for coding or reasoning. |

---

## Cross-Model Strategy Guide

### Which Model for Which Task

| Task | Best model(s) | Why |
|------|--------------|-----|
| Complex code generation | Qwen2.5-Coder 14B / Qwen2.5 32B | Best code quality, tool calling |
| Debugging (bisect method) | Gemma 3 9B / Qwen2.5 14B | Strong reasoning, good with structured checklists |
| Debugging (hypothesis-driven) | Qwen2.5 32B / Gemma 3 27B | Sustained reasoning across multiple assumptions |
| Code review (5-lens) | Qwen2.5 32B / Gemma 3 27B | Breadth of analysis requires larger models |
| Code review (single lens) | Gemma 3 9B / Qwen2.5 14B | Focused pass on one lens is manageable |
| Refactoring (simple recipes) | Qwen2.5-Coder 7B / Gemma 3 9B | Pattern matching — small models can handle |
| Refactoring (multi-recipe chain) | Qwen2.5 32B / Gemma 3 27B | Chaining recipes needs sustained context |
| Error interpretation | Gemma 3 9B / Qwen2.5 14B | Table lookup + pattern matching |
| Documentation / README | Gemma 3 27B / Qwen2.5 32B | Creative writing + structure |
| API design | Qwen2.5 32B / Gemma 3 27B | Needs reasoning about trade-offs |
| Security audit (CI) | Qwen2.5-Coder 14B / Qwen2.5 32B | Best at structured checklist traversal |
| CLI / shell scripting | Qwen2.5-Coder 7B / Gemma 3 9B | Flag recall + command construction |
| Regex | Gemma 3 9B / Qwen2.5 14B | Pattern generation + escaping awareness |
| Git workflow recovery | Qwen2.5 14B / Gemma 3 9B | Mechanical + lookup — small models handle |
| Creative / narrative | Gemma 3 27B / Gemma 3 9B | Clearly better than Qwen at creative tasks |

### Prompt Adaptation by Model Size

| Parameter range | Prompt strategy | Checklist format? | Context handling |
|----------------|----------------|-------------------|------------------|
| **2B–7B** | Single-step, specific, formatted. No multi-step reasoning. | Always — structured lists outperform prose. | Show only the relevant 10-20 lines, not the full file. |
| **9B–14B** | Multi-step but sequential. One task at a time with explicit instructions. | Preferred — checklist works better than open-ended. | Can handle one full file at a time. Good for focused tasks. |
| **27B–32B** | Multi-step, complex reasoning. Can chain tasks across files. | Optional — can handle open-ended but still benefits. | Can handle multiple files and project-level context. |
| **72B** | Near cloud-model capability. Few constraints. | Rarely needed — use when you want exhaustive coverage. | Can handle full project context. Use freely. |

### When Skills Need Adaptation

| Skill | Model-specific adaptation |
|-------|-------------------------|
| `debugging-patterns` | 7B-9B models → force bisect method (mechanical). 27B+ → hypothesis-driven is viable. |
| `code-review-checklist` | 7B-14B → one lens per turn. 27B+ → two lenses per pass. 72B → full review. |
| `refactoring-recipes` | 7B-9B → one recipe per commit, show full context. 27B+ → can chain 2-3 recipes. |
| `self-correction-patterns` | 7B-9B → check Recognition Triggers before every output. 27B+ → can self-initiate backtracking. |
| `cli-toolkit` | All models → flag hallucination is universal. Always verify CLI flags against the reference. |
| `regex-reference` | 7B-14B → escaping mistakes are the most common error. 27B+ → backtracking prevention is the key risk. |
| `git-workflows` | 7B-14B → use the Situation → Command table (don't construct from memory). 27B+ → can handle multi-step workflows. |
| `error-interpretation` | 7B-14B → fix symptom not cause. Use the cross-language table to find root cause. 27B+ → trace error chains naturally. |

## Model Notes

- **This skill is self-referencing**: The guidance in this file follows the same principles it describes. The cross-model strategy tables are designed to be referenced mechanically — look up your model and task, get the recommendation.
- **Model comparisons are time-sensitive**: New model versions are released frequently. The rankings in this skill reflect mid-2026. If you are reading this later, the specific comparisons may be outdated but the framework (parameter size → capability mapping, prompt adaptation strategies) remains valid.
- **When in doubt, prefer the larger model**: If two models are available and one is larger, use it — unless the task is trivial. Larger models produce fewer errors, hallucinate less, and follow instructions more reliably. The inference cost difference is usually negligible for coding tasks.
- **The "9B sweet spot"**: Models in the 9B–14B range (Gemma 3 9B, Qwen2.5 14B) are the best performance-per-resource tradeoff for most coding tasks. They fit on consumer GPUs (8–16GB VRAM), run at usable speeds, and handle 90% of single-file tasks correctly.
