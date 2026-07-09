---
title: "Cross-Model Strategy — Task Selection, Prompt Adaptation"
impact: MEDIUM
impactDescription: Enables informed model selection per task; prevents using the wrong prompt strategy for the model size
tags: [qwen, strategy, comparison, prompt-adaptation, model-selection]
---

## Cross-Model Strategy — Task Selection, Prompt Adaptation

### Model Comparison Table (mid-2026)

| Model | Reasoning | Coding | Tool Call Stability | Recommended For |
|-------|-----------|--------|---------------------|-----------------|
| Qwen 3.6 27B | Excellent | Excellent | Medium-High | Heavy reasoning, large context |
| Qwen 3.5 35B | Very Good | Excellent | Medium-High | Coding + moderate tool use |
| Qwen 3.5 9B | Good | Very Good | Medium-High | Everyday coding, single-file tasks |
| Qwen 2.5 32B/14B | Good | Very Good | High | Stable coding, debugging |

> Qwen 3.5+ may add trailing text in OpenAI-compatible format. Always provide clean JSON with no explanatory content after `arguments` object.

### Which Qwen Model for Which Task

| Task | Recommended Model | Why |
|------|-------------------|-----|
| Debugging (bisect method) | Qwen 3.5 9B / Qwen 2.5 14B | Structured checklist adherence |
| Debugging (hypothesis-driven) | Qwen 3.6 27B / Qwen 3.5 35B | Sustained reasoning across multiple assumptions |
| Code review (full) | Qwen 3.6 27B / Qwen 3.5 35B | Breadth of analysis requires larger models |
| Code review (single lens) | Qwen 3.5 9B | Focused pass on one lens |
| Refactoring (simple) | Qwen 3.5 9B | Pattern matching handles small models |
| Refactoring (complex multi-file) | Qwen 3.6 27B / Qwen 3.5 35B | Chaining refactors needs sustained context |
| Error interpretation | Qwen 3.5 9B / Qwen 3.5 35B | Table lookup + pattern matching |
| Documentation / README | Qwen 3.6 27B / Qwen 3.5 35B | Strong structure + creative writing |
| API design | Qwen 3.6 27B / Qwen 3.5 35B | Deep reasoning about trade-offs |
| Security audit | Qwen 3.6 27B / Qwen 3.5 35B | Structured checklist traversal |
| CLI / shell scripting | Qwen 3.5 9B | Flag recall + command construction |
| Regex | Qwen 3.5 9B / Qwen 3.5 35B | Pattern generation + escaping awareness |
| Git workflow recovery | Qwen 3.5 9B | Mechanical + lookup — small models handle |
| Creative / narrative | Qwen 3.6 27B | Best creative output in the lineup |

### Prompt Adaptation by Model Size

| Parameter range | Prompt strategy | Checklist format? | Context handling |
|----------------|----------------|-------------------|------------------|
| **2B–7B** | Single-step, specific, formatted. No multi-step reasoning. | Always — structured lists outperform prose. | Show only relevant 10–20 lines, not full file. |
| **9B** | Multi-step but sequential. One task at a time with explicit instructions. | Preferred — checklist works better than open-ended. | Can handle one full file at a time. |
| **14B–35B** | Multi-step, complex reasoning. Can chain tasks across files. | Optional — can handle open-ended but still benefits. | Can handle multiple files and project-level context. |
| **27B+** | Near cloud-model capability. Few constraints. | Rarely needed. | Full project context. |
| **256K context models** | Full project awareness. Can process entire directories. | Not needed. | Load entire project directories. |

### When Skills Need Adaptation

| Skill | Qwen model-specific adaptation |
|-------|-------------------------|
| `debugging-patterns` | 7B-9B → force bisect method (mechanical). 14B+ → hypothesis-driven viable. 27B+ → full hypothesis-driven. |
| `development-conventions` | 7B-9B → one lens per turn. 14B-35B → two lenses per pass. 35B+ → full review. |
| `local-models` | 9B → checklist format. 14B+ → can self-initiate backtracking. All → flag hallucination is universal. |
| `devops-conventions` | 7B-12B → escaping mistakes are common. 12B+ → backtracking prevention is key. |
