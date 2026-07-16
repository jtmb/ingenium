# Consolidated Security Reporting

All security audit findings must be combined into ONE consolidated report.

## Requirements

1. **Single Source of Truth**: All findings from all audit sources must appear in one report
2. **No Fragmentation**: Do not create separate reports for docker, api, services, etc.
3. **Priority Ordering**: Critical issues first, then high, medium, low
4. **Actionable Items**: Each finding must include remediation steps

## Format

```
# Security Audit Report

## Critical Issues
- [Issue description]
  - Location: [file:line]
  - Impact: [description]
  - Remediation: [steps]

## High Priority Issues
...
```

## User Preference
User wants security audit findings consolidated into one report from all sources without spawning subagents.