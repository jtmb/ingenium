# Detection Prompts at Each Step

## Purpose
Apply detection prompts systematically throughout agent execution to catch concerns, bugs, or missed edge cases before proceeding.

## Requirements
- Detection prompt must be applied at each step of agent execution (importance: 9)
- Sub-agent outputs audited for concerns, recommendations, findings, and bugs
- Issues converted into new todo tasks with appropriate importance levels
- Verification gates require detection prompts to pass before phase progression

## Implementation Notes
User consistently requires this pattern across all agent operations, indicating they value thoroughness in catching issues early rather than relying on post-execution debugging.
