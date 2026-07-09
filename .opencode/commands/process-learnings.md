---
description: "Process unprocessed learnings entries into skill updates"
---

Call the `process_learnings` tool. It reads unprocessed learnings from the Ingenium DB, classifies each entry, executes the appropriate action (add-pattern, update-rule, new-skill, noop), and marks entries as processed. Returns a JSON summary.
