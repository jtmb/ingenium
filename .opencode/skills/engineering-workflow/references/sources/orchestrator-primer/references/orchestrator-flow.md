# Orchestrator Execution Flow

1. Declare `IN_SCOPE`, `OUT_OF_SCOPE`, acceptance criteria, `STOP_CONDITION`, verification budget, and escalation rule.
2. Declare the phase's active/writer counts, exclusive territories, dependencies, and targeted verification owner.
3. Delegate only in-scope work within the 6-active/3-writer limit.
4. The verification budget permits a maximum of **3 verification phases**; each individual check may execute at most **2 times**; and maximum of **1 writer remediation round**.
5. Classify findings as **BLOCKING**, **FOLLOW_UP**, or **INFORMATIONAL**. Only an in-scope BLOCKING finding may reopen implementation; the second failed blocking check returns **ESCALATE_USER** with evidence.
6. QA performs one targeted pass after an implementation wave; Docs runs only for directly affected canonical documentation or explicit user request. Neither recursively triggers QA/Docs work.
7. STOP and CANCELLED are terminal: preserve evidence, report skipped work, and dispatch no new work.
