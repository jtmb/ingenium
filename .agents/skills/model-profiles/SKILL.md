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

## Qwen Family

### Qwen2.5 (September 2024 – succeeded by Qwen 3.5)

**Sizes**: 7B, 14B, 32B, 72B (+ Coder and Math variants)

The Qwen2.5 family was the strongest general-purpose open-weight family through late 2025, now succeeded by Qwen 3.5 and Qwen 3.6. Still relevant for many tasks, especially the 32B and 72B variants. Strong across coding, reasoning, and instruction-following.

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

### Qwen 3.6 (Early 2026 – present)

**Sizes**: 27B

The latest Qwen generation as of mid-2026. The 27B variant represents a major leap — it matches or exceeds Qwen2.5 72B on most benchmarks while being dramatically smaller and faster. Likely uses MoE or advanced architecture to achieve this efficiency.

#### Strengths

| Area | Notes |
|------|-------|
| **Reasoning** | Best-in-class for its size. Matches Qwen2.5 72B on math, logic, and multi-step reasoning. |
| **Coding** | Excellent code generation and understanding. Competes with dedicated 32B–70B code models. |
| **Instruction following** | Top-tier — handles complex, nested instructions reliably. |
| **Tool calling** | Superior function calling, on par with GPT-3.5. Handles complex tool schemas. |
| **Context utilization** | Full 256K context with strong middle-context retrieval. |

#### Weaknesses

| Area | Notes |
|------|-------|
| **Creative writing** | Good but not exceptional. Still prefers formulaic structure over creativity. |
| **Availability** | May require newer inference engines; not supported by older Ollama/vLLM versions. |

#### Model-Aware Hints

- **Qwen 3.6 27B**: This is the go-to model when you need close-to-cloud quality locally. Use for complex multi-file refactoring, code review (full 5-lens), hypothesis-driven debugging, and any task requiring sustained reasoning. Its 256K context means you can load entire project directories.
- **All Qwen 3.6**: Treat this model similarly to how you would treat GPT-3.5 or Claude Haiku — it can handle nearly anything you throw at it. Only reach for larger cloud models for tasks requiring extremely long (200K+) context or specialized domain knowledge.

### Qwen 3.5 (Late 2025 – present)

**Sizes**: 9B, 35B

The bridge generation between Qwen2.5 and Qwen 3.6. The 35B variant is a standout — it outperforms Qwen2.5 72B on coding and reasoning while using half the parameters. The 9B variant significantly improves over Qwen2.5 7B.

#### Strengths (35B)

| Area | Notes |
|------|-------|
| **Coding** | Superior to Qwen2.5 72B across all languages. The 35B is the best non-3.6 Qwen for coding. |
| **Reasoning** | Strong chain-of-thought. Handles multi-step reasoning with few errors. |
| **Tool calling** | Reliable function calling. Good with complex schemas. |
| **Context utilization** | 256K context, excellent retention across the full window. |

#### Strengths (9B)

| Area | Notes |
|------|-------|
| **Coding** | Strong for 9B class. Outperforms Qwen2.5 7B and Gemma 3 9B on code tasks. |
| **Reasoning** | Good step-by-step reasoning. Handles single-file debugging well. |
| **Efficiency** | Runs comfortably on 8GB VRAM. Fast inference. |

#### Weaknesses

| Area | Notes |
|------|-------|
| **Creative writing** (both) | Still formulaic. Qwen 3.6 improves this somewhat. |
| **9B context** | 128K is generous for the size; quality degrades past ~80K tokens. |

#### Model-Aware Hints

- **Qwen 3.5 35B**: The best performance-per-parameter in the Qwen 3.5 lineup. Use for anything you'd use Qwen2.5 72B for — complex code generation, multi-file analysis, code review. Runs at ~2x the speed of Qwen2.5 72B on the same hardware.
- **Qwen 3.5 9B**: A strong upgrade over Qwen2.5 7B. Use for everyday coding, debugging (bisect method), documentation, and single-file tasks. It outperforms Gemma 3 9B on code but Gemma 3 9B still leads on reasoning and creative tasks.
- **All Qwen 3.5**: Like Qwen2.5, they benefit from explicit output formatting. Be specific about expected output format.

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

### Gemma 3 (March 2025 – succeeded by Gemma 4)

**Sizes**: 2B, 7B, 9B, 27B

Google's previous-generation open model family. The 27B variant was a standout in its time, now succeeded by Gemma 4. The 9B variant is still the strongest 9B-class model available among the Gemma 3 generation.

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

### Gemma 4 (Late 2025 – present)

**Sizes**: 12B

Google's next-generation open model. The 12B variant is a significant leap over Gemma 3 — it addresses Gemma 3's main weakness (tool calling) while improving every other dimension. The 12B size point is new and fills the gap between 9B (too small for complex tasks) and 27B (too large for some hardware).

#### Strengths

| Area | Notes |
|------|-------|
| **Reasoning** | Outstanding — matches Gemma 3 27B while being half the size. |
| **Tool calling** | Massively improved over Gemma 3. Now competitive with Qwen3.5 35B for function calling. |
| **Code quality** | Significantly better than Gemma 3 9B. Approaches Qwen3.5 35B on most code tasks. |
| **Conciseness** | Gemma 4 maintains Gemma 3's conciseness while being more thorough — a rare combination. |
| **Multilingual** | Excellent across many languages. |
| **Creative tasks** | Best-in-class for open-ended writing among 12B models. |
| **Safety / refusal** | Well-tuned — very low false refusal rate. |

#### Weaknesses

| Area | Notes |
|------|-------|
| **Raw parameter count** | At 12B, still limited for tasks requiring vast knowledge recall. Qwen 3.5 35B has more raw knowledge. |
| **Very long contexts** | 256K supported but quality degrades past ~160K. Qwen 3.6 27B handles extreme contexts better. |

#### Model-Aware Hints

- **Gemma 4 12B**: The best model in its size class. Use as the default for essentially all tasks — it is equally strong at reasoning, coding, tool calling, and creative work. Its main limitation is raw knowledge capacity compared to much larger models.
- **Gemma 4 vs Qwen 3.5 35B**: For most coding tasks, they are competitive. Choose Gemma 4 when you need: better reasoning, creative work, or multilingual support. Choose Qwen 3.5 35B when you need: maximum code quality, complex tool chains, or raw knowledge recall.
- **All Gemma 4**: Unlike Gemma 3, Gemma 4 does not need explicit "show your reasoning" prompting — it does this naturally. However, it still benefits from structured output formats for complex tasks.

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

## DeepSeek Family

### DeepSeek-V4 (April 2026 – present)

**Sizes**: V4-Flash (284B total / 13B activated), V4-Pro (1.6T total / 49B activated)

DeepSeek's fourth-generation model series, released in April 2026. Both models use Mixture-of-Experts (MoE) architecture with a novel Hybrid Attention mechanism combining Compressed Sparse Attention (CSA) and Heavily Compressed Attention (HCA). The V4-Pro-Max is widely regarded as the best open-weight model family available as of mid-2026, bridging the gap with leading closed-source models.

Both models are available as open weights (MIT license) and via API (`deepseek-v4-flash`, `deepseek-v4-pro`) at `api.deepseek.com` using an OpenAI-compatible or Anthropic-compatible format.

#### Architecture

| Property | V4-Flash | V4-Pro |
|----------|----------|--------|
| **Total params** | 284B | 1.6T |
| **Active params** | 13B | 49B |
| **Architecture** | MoE (Hybrid Attention: CSA + HCA) | MoE (Hybrid Attention: CSA + HCA) |
| **Pre-training** | 32T+ tokens | 32T+ tokens |
| **License** | MIT | MIT |

#### Strengths

| Area | Notes |
|------|-------|
| **Coding** | Top-tier. V4-Pro-Max achieves 93.5 LiveCodeBench, 80.6% SWE-bench Verified, 3206 Codeforces rating — competitive with the best closed-source models. |
| **Reasoning** | Outstanding. V4-Pro-Max scores 94.3 GPQA Diamond, 44.4 HLE, 95.2 HMMT 2026 Feb. Three reasoning modes: Non-think (fast), Think High (balanced), Think Max (maximum reasoning budget). |
| **Knowledge** | V4-Pro is the best open model for world knowledge — 91.0 MMLU-Pro, 75.6 SimpleQA-Verified. |
| **Agentic tasks** | Excellent tool calling and agentic workflows. Terminal Bench 2.0: 67.9, SWE Pro: 55.4, BrowseComp: 83.4, MCPAtlas: 73.6. |
| **Long context** | Supports up to 1M tokens with efficient hybrid attention. MRCR 1M: 83.5 MMR, CorpusQA 1M: 62.0 ACC. |
| **Efficiency (Flash)** | Only 13B activated parameters — runs on consumer hardware while delivering near-frontier performance. |

#### Weaknesses

| Area | Notes |
|------|-------|
| **Hardware requirements (Pro)** | 49B activated is demanding. Requires multiple GPUs or high-RAM setup for local inference at reasonable speed. |
| **Inference complexity** | MoE + hybrid attention means specialized inference code. Not as straightforward as dense models. Requires the `deepseek_v4` Transformers integration or dedicated inference engines. |
| **Availability** | Very recent (April 2026). May not yet be supported by all inference frameworks. Ollama/LM Studio support may require updates. |
| **V4-Flash knowledge** | At 13B activated, Flash lags behind Pro on pure knowledge benchmarks and complex agentic workflows. |

#### Model-Aware Hints

- **DeepSeek-V4-Pro**: Use this when you need the absolute best open model for complex multi-file refactoring, full 5-lens code review, hypothesis-driven debugging, security audits, and any task requiring sustained reasoning with high accuracy. Enable Think Max mode for the hardest problems. This is a cloud-scale model — expect to use API access or a powerful multi-GPU setup.
- **DeepSeek-V4-Flash**: The best efficiency-to-performance ratio in open models. At only 13B activated parameters, it delivers coding and reasoning performance that rivals or exceeds 70B+ dense models. Use as your default for most coding tasks when you want local inference. Enable Think High mode for complex debugging or Think Max for the hardest reasoning tasks (with a larger thinking budget).
- **Both models**: They support three reasoning effort modes. Adjust `reasoning_effort` in API calls or configure thinking budget in local inference. Use Non-think for simple/chatty tasks, Think High for standard coding, Think Max for the hardest reasoning problems.
- **V4-Flash vs. Qwen 3.5 35B**: V4-Flash (13B active) is broadly competitive with Qwen 3.5 35B on coding and reasoning while being much smaller and faster. Qwen wins on raw knowledge recall; V4-Flash wins on long-context and agentic tasks.
- **V4-Pro vs. Qwen 3.6 27B**: V4-Pro (49B active) outperforms Qwen 3.6 27B on knowledge, coding benchmarks, and agentic tasks. Qwen 3.6 27B is a more practical choice for local deployment.
- **All DeepSeek V4**: They work best with explicit instruction formatting and structured output. They follow system prompts very precisely. Use the Non-Think → Think High → Think Max progression: start with the lowest sufficient mode to save compute and time.

---

## Cross-Model Strategy Guide

### Which Model for Which Task

| Task | Best model(s) | Why |
|------|--------------|-----|
| Complex code generation | DeepSeek-V4-Pro / Qwen3.6 27B | Best code quality, tool calling, reasoning |
| Debugging (bisect method) | Gemma 4 12B / Qwen3.5 9B | Strong reasoning, structured checklist adherence |
| Debugging (hypothesis-driven) | DeepSeek-V4-Pro / Qwen3.6 27B | Sustained reasoning across multiple assumptions |
| Code review (5-lens) | DeepSeek-V4-Pro / Qwen3.6 27B | Breadth of analysis requires larger models |
| Code review (single lens) | DeepSeek-V4-Flash / Gemma 4 12B | Focused pass on one lens |
| Refactoring (simple recipes) | DeepSeek-V4-Flash / Qwen3.5 9B | Pattern matching — small efficient models handle |
| Refactoring (multi-recipe chain) | DeepSeek-V4-Pro / Qwen3.6 27B | Chaining recipes needs sustained context |
| Error interpretation | DeepSeek-V4-Flash / Gemma 4 12B | Table lookup + pattern matching |
| Documentation / README | Qwen3.6 27B / Gemma 4 12B | Strong structure + creative writing |
| API design | DeepSeek-V4-Pro / Qwen3.5 35B | Needs deep reasoning about trade-offs |
| Security audit (CI) | DeepSeek-V4-Pro / Qwen3.5 35B | Best at structured checklist traversal |
| CLI / shell scripting | DeepSeek-V4-Flash / Qwen3.5 9B | Flag recall + command construction |
| Regex | Gemma 4 12B / DeepSeek-V4-Flash | Pattern generation + escaping awareness |
| Git workflow recovery | Qwen3.5 9B / Gemma 4 12B | Mechanical + lookup — small models handle |
| Creative / narrative | Qwen3.6 27B / Gemma 4 12B | Best creative output in the lineup |

### Prompt Adaptation by Model Size

| Parameter range | Prompt strategy | Checklist format? | Context handling |
|----------------|----------------|-------------------|------------------|
| **2B–7B** | Single-step, specific, formatted. No multi-step reasoning. | Always — structured lists outperform prose. | Show only the relevant 10-20 lines, not the full file. |
| **9B–12B** | Multi-step but sequential. One task at a time with explicit instructions. | Preferred — checklist works better than open-ended. | Can handle one full file at a time. Good for focused tasks. |
| **12B–35B** | Multi-step, complex reasoning. Can chain tasks across files. | Optional — can handle open-ended but still benefits. | Can handle multiple files and project-level context. |
| **35B–72B** | Near cloud-model capability. Few constraints. | Rarely needed — use when you want exhaustive coverage. | Can handle full project context. Use freely. |
| **256K context models** | Full project awareness. Can process entire directories. | Not needed — but use for exhaustive coverage checks. | Load entire project directories; excellent retrieval across full window. |

### When Skills Need Adaptation

| Skill | Model-specific adaptation |
|-------|-------------------------|
| `debugging-patterns` | 7B-9B → force bisect method (mechanical). 12B+ (Gemma 4) → hypothesis-driven viable. 27B+ → full hypothesis-driven. |
| `code-review-checklist` | 7B-12B → one lens per turn. 12B-35B → two lenses per pass. 35B+ → full review. |
| `refactoring-recipes` | 7B-9B → one recipe per commit, show full context. 12B+ → can chain 2-3 recipes. 35B+ → chain entire refactoring. |
| `self-correction-patterns` | 7B-9B → check Recognition Triggers before every output. 12B+ → can self-initiate backtracking. |
| `cli-toolkit` | All models → flag hallucination is universal. Always verify CLI flags against the reference. |
| `regex-reference` | 7B-12B → escaping mistakes are the most common error. 12B+ → backtracking prevention is the key risk. |
| `git-workflows` | 7B-12B → use the Situation → Command table (don't construct from memory). 12B+ → can handle multi-step workflows. |
| `error-interpretation` | 7B-12B → fix symptom not cause. Use the cross-language table to find root cause. 12B+ → trace error chains naturally. |

## Model Notes

- **This skill is self-referencing**: The guidance in this file follows the same principles it describes. The cross-model strategy tables are designed to be referenced mechanically — look up your model and task, get the recommendation.
- **Context size is set by the user or harness**: The context window is configured by the inference engine (Ollama, vLLM, llama.cpp) or API provider — not baked into the model. A model that *supports* 256K context may be run with only 8K if the user chooses. Always check the running configuration rather than assuming a model's full capability.
- **Model comparisons are time-sensitive**: New model versions are released frequently. The rankings in this skill reflect mid-2026. If you are reading this later, the specific comparisons may be outdated but the framework (parameter size → capability mapping, prompt adaptation strategies) remains valid.
- **When in doubt, prefer the larger model OR the newer generation**: If two models are available, prefer the newer generation (DeepSeek-V4 > Qwen 3.6 > Qwen 3.5 > Qwen2.5; Gemma 4 > Gemma 3 > Gemma 2). Newer generations consistently outperform older larger models. A Qwen 3.5 35B beats Qwen2.5 72B on most tasks.
- **The "12B sweet spot"**: With the release of Gemma 4 12B and Qwen 3.5 9B, the sweet spot has shifted upward from 9B to 9B–12B. These models fit on consumer GPUs (8–16GB VRAM), run at usable speeds, and handle 95% of typical coding tasks correctly. DeepSeek-V4-Flash (13B active) extends this further — near-frontier performance at consumer-friendly active parameter counts.
- **MoE models change the efficiency calculus**: DeepSeek-V4-Flash uses only 13B activated parameters out of 284B total. When comparing models, compare **active parameters** (what runs at inference time), not total parameters. A 13B-active MoE model can outperform a 35B dense model while using less memory and compute.
- **Reasoning effort modes are the new knob**: DeepSeek-V4 (Non-think / Think High / Think Max) and other recent models offer adjustable reasoning budgets. Start with the fastest mode that works, and escalate only for difficult problems. This is more efficient than changing models for every task.
