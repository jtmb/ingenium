# Orchestrator Execution Flow

1. **Plan parsing** — Read plan from conversation context
2. **Task decomposition** — Split into independent work units
3. **Parallel spawn** — Fire all subagents simultaneously
4. **Independent verification** — Run build/tests after each subagent
5. **Failure analysis** — Classify failure, encode pattern into skill
6. **Documentation** — Spawn @ingenium-docs after every change
