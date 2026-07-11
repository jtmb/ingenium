# Observation Guide — What to Observe

## User Behavior (LOG as observation)
| Type | Example | When |
|------|---------|------|
| preference | "User prefers 2-space indentation" | User explicitly states or implies a preference |
| correction | "User corrected snake_case to camelCase" | User fixes agent output |
| feedback | "User accepted the suggestion without changes" | User accepts/rejects agent work |
| behavior | "User asks for alternatives before accepting" | Interaction pattern |
| terminology | "User says 'deploy' not 'release'" | Distinct terminology |
| workflow | "User always runs lint before commit" | Repeated workflow step |
| error | "User hit TypeScript strict mode error" | User encounters blocker |
| goal | "User wants to improve test coverage" | User states objective |

## Implementation Notes (do NOT log as observation)
- Any description of code that was written/changed
- Architecture decisions
- Bug fixes
- Feature additions
- Refactoring work
- These belong in pipeline events (logEvent) and git commits, not personality observations
