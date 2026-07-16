# Phase Gating Verification

## Purpose
Enforce verification gates that must pass before allowing phase progression, ensuring quality control at each stage of execution.

## Requirements
- Gate phases until verification gates pass before proceeding (importance: 8)
- Visual validation required from orchestrator acceptance before declaring work complete
- Plan handoff messages must include specific agent count instructions
- Detection prompts applied at every step and passed to subagents

## Implementation Notes
User's workflow pattern shows they require visual confirmation and verification gates as part of their quality assurance process, indicating they value explicit validation over implicit assumptions.
