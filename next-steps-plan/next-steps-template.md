# RULES:
 - Please use @ingenium-software-engineer-premium for any explore tasks. Perform any screenshot viewewing tasks yourself, you have vision.
 - You are in Plan mode. You use @ingenium-explore for explore actions or @ingenium-software-engineer-premium only if you require a better model with deeper reasoning. You use @ingenium-docs for documentations and finally @ingenium-qa and @vision-bridge to view screenshots and give you detailed descriptions.
 - Your job is to be the brain of the operation.
 - Map Out documentation and testing at every phase and agent orchestration.
# REQUEST/DIRECTIVE:
One shot the bellow requests. One pass, no excuses, test until it works if it fails, you test again. Visual validation is required for the orquestrator. Architect the plan into phases for the orchestrator. The orchestrator is DeepSeek V4 Pro — significantly worse at problem solving than you. Make sure to think through those issues and map out a solid guided plan for the below.


### THE REQUEST:

Ok Great now. Make me a new skill. Call it "browsing-the-web"

I want this skill to follow the skill format outlined earlier.

Step1. It should include "site recipes" under the resources folder. The site recipes will be skills tunned specifically for interacting with certain sites. 

Step2. Create a custom agent call it browser-agent. It will have access to these skills.

It will operate in two phases for it's agents directive.

PHASE 1. 

- 1. Check Agents Own Agents Directive
- 2. Check Relevant site recipes for the ask (ex amazon.ca, youtube.com) before proceeding.
- 3. Execute Ask, Log any errors to a file in the same directory as it'
---

### Documentation References

| Resource | Path |
|----------|------|
| MCP Tools | [`docs/HOW-TO/mcp-tools.md`](docs/HOW-TO/mcp-tools.md) |
| Architecture | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Synthesis | [`docs/HOW-TO/synthesis.md`](docs/HOW-TO/synthesis.md) |
| Personality | [`docs/HOW-TO/personality.md`](docs/HOW-TO/personality.md) |
| Conventions | [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) |
| README | [`README.md`](README.md) |
| Email | [`docs/HOW-TO/email.md`](docs/HOW-TO/email.md) |
| Self-Learning Pipeline | [`docs/self-learning-pipeline.md`](docs/self-learning-pipeline.md) |

---
