# Conventions

## Naming

| What | Convention | Example |
|------|-----------|---------|
| Engagement directories | kebab-case, `{target-domain}` | `example-com/`, `internal-network/` |
| Evidence files | `{tool}-{target}-{timestamp}.{ext}` | `nmap-example-com-20260705.xml` |
| PoC scripts | snake_case, descriptive | `sql_injection_login.py` |
| Skill files | kebab-case, one topic per skill | `network-pentest/`, `web-app-scan/` |
| Agent definition files | `ingenium-{role}.md` | `ingenium-security-engineer.md` |
| Agent mentions | `@ingenium-{role}` | `@ingenium-security-engineer` |
| Documentation files | SCREAMING_CAPS.md | `ARCHITECTURE.md`, `CONVENTIONS.md` |

## File Organization

```
sec-ops/
├── .agents/
│   ├── skills/             # 54 skill directories (44 universal + 10 pentest)
│   ├── hooks/              # 3 lifecycle hooks (JSON)
│   └── scripts/            # Bootstrap scripts
├── .opencode/
│   ├── agents/             # 8 agent definitions (markdown)
│   └── plugins/            # 4 TypeScript lifecycle plugins
├── docs/
│   └── engagements/        # Engagement evidence and reports (created per engagement)
│       └── {target}/
│           ├── recon.md
│           ├── enumeration.md
│           ├── vulnerabilities.md
│           ├── exploitation.md
│           └── report.md
└── evidence/               # Raw tool output and collected artifacts
    └── {target}/
        ├── nmap/
        ├── dns/
        ├── web/
        └── exploits/
```

## Ethical Guidelines

### Core Principles
1. **Authorized Testing Only** — Never scan, enumerate, or exploit any target without explicit written authorization
2. **No Denial of Service** — No commands that cause service disruption, resource exhaustion, or system crashes. This includes: aggressive `nmap` timing flags (`-T5`), masscan with excessive rates, hydra without rate limiting
3. **No Data Destruction** — Never modify, delete, or corrupt target data. Read-only exploitation where possible
4. **Minimum Necessary Access** — If exploitation is authorized, access the minimum necessary to prove impact
5. **Stop on Unexpected Findings** — If you encounter unexpected production systems, PII, or sensitive data outside scope — stop immediately and notify the user
6. **Chain of Custody** — All evidence must be timestamped, labelled with target, and preserved in its original format

### Scope Validation Checklist
Before every engagement phase:
- [ ] Target IP/hostname confirmed with user
- [ ] Target is within authorized scope
- [ ] No production/live systems if testing is labeled as "staging"
- [ ] Testing window confirmed with user
- [ ] Rate limits and timing constraints confirmed
- [ ] Exploitation (if any) explicitly authorized

## Safety Boundaries

Tools and commands are categorized into three tiers:

### Tier 1: Auto-Approved (Safe Reconnaissance & Enumeration)
These tools are passive or minimally intrusive and can be run without additional approval:
- DNS enumeration: `dig`, `nslookup`, `host`, `dnsrecon` (with caution)
- Port scanning: `nmap -sS -sV` (no `-T5`, no aggressive timing)
- Technology detection: `whatweb`, `wappalyzer`
- SSL/TLS checking: `testssl.sh`, `openssl s_client`
- WHOIS lookups, certificate transparency queries
- Ping sweeps with limited parallelism

### Tier 2: Needs Approval (Intrusive Enumeration & Assessment)
These tools are more intrusive and require user confirmation before running:
- Directory enumeration: `ffuf`, `gobuster`, `dirb`
- Vulnerability scanners: `nikto`, `nmap --script vuln`
- SQL injection detection: `sqlmap` (in detection mode only)
- Brute force (non-destructive): `hydra` (with rate limiting, account lockout checks)
- Web spidering and crawling
- Version-specific vulnerability checks

### Tier 3: Never Allowed
These commands must NEVER be run in any engagement:
- Any Denial of Service tool or technique (`hping3 --flood`, `slowloris`, `LOIC`)
- Data destruction or modification (`DROP TABLE`, `rm -rf`, `dd if=/dev/zero`)
- Zero-day exploitation without explicit separate authorization
- Social engineering or phishing
- Physical security attacks
- Attacks on infrastructure you do not own or have written permission to test
- Any command with `--drop`, `--delete`, `--destroy`, or equivalent flags

## Tool Acquisition Patterns

1. **Check before installing** — Use `which`, `command -v`, or `dpkg -l` to verify the tool exists
2. **Prefer apt packages** — `sudo apt update && sudo apt install -y <tool>`
3. **Use pipx for Python tools** — `pipx install <tool>` to avoid polluting system Python
4. **GitHub releases for Go/Rust tools** — Download prebuilt binaries when apt is outdated
5. **Document installations** — Track what's installed and where in the engagement notes

## Evidence Management

### What to Save
- Raw tool output (STDOUT/STDERR) — save complete, not summarized
- Screenshots of web interfaces and exploit results
- Network captures (PCAP) when relevant
- Commands used with exact flags and timestamps
- False positive indicators and context

### Evidence Format
- Evidence files: `{tool}-{target}-{YYYYMMDD-HHMMSS}.{format}`
- Use `.txt` for text output, `.xml` for structured output, `.pcap` for captures
- Evidence directory mirrors engagement phases

### Evidence Verification
- Always verify false positives before reporting
- Run findings through `@ingenium-security-engineer` for review
- Correlate findings across tools (e.g., port scan + service scan + banner grab)
- Never report unverified findings

## Error Handling

| Error | Handling |
|-------|----------|
| Tool not found | Attempt installation via apt/pipx/go install. If fails, suggest alternative tool from the same domain skill |
| Permission denied | Check sudo requirements. Flag in findings if target blocks the tool |
| Rate limiting triggered | Reduce parallelism (-t flag), increase delays (--delay), switch to passive techniques |
| Scope violation detected | Stop immediately. Notify user. Log the finding without further action |
| Target timeout | Note in findings, try alternative approaches (different port, different protocol) |
| False positive detected | Document why it's false (contradicting evidence, lack of exploitability) |

## Stage-Gating

**Do not skip phases.** Each phase depends on the output of the previous phase:

| Phase | Prerequisites | Gate check |
|-------|---------------|------------|
| 1. Reconnaissance | Target domain/IP | — |
| 2. Enumeration | Completed recon (open ports, services identified) | Clear network map exists |
| 3. Vulnerability Assessment | Completed enumeration (service versions, configuration) | Service details documented |
| 4. Exploitation | Identified exploitable vulnerabilities | Vulnerability report reviewed, authorization confirmed |
| 5. Reporting | Completed exploitation or determined not exploitable | All evidence collected, false positives identified |

To skip a phase (e.g., going straight to exploitation from a CVE), you MUST:
1. Document why the phase is being skipped
2. Have direct evidence that justifies the skip
3. Get user confirmation

## Git Practices

- **Branch naming**: `engagement/{target}-{phase}` (e.g., `engagement/example-com-recon`)
- **Commit messages**: Conventional Commits: `{phase}({target}): {finding summary}`
- **Evidence commits**: Every finding gets its own commit with clear message
- **No secrets in commits**: Never commit real target credentials, session tokens, or exploitation output
- **Tag significant findings**: `git tag finding-{target}-{cve-id}` for important vulnerabilities

## Code Style (PoC Scripts)

- **Language**: Python 3 for PoC scripts (preferred for readability and library availability)
- **Error handling**: `try/except` with meaningful error messages, never silent failures
- **Configuration**: Target URL/IP as script argument or environment variable — never hardcoded
- **Output**: Machine-parseable output (JSON) with human-readable summary
- **Safety**: Always include a `--dry-run` or `--check` mode
- **Cleanup**: Release resources, close connections, clean up temporary files on exit
- **Rate limiting**: Include `time.sleep()` or other throttling in enumeration scripts

## Logging

- **Phase-level logging**: Timestamp, phase name, target, tool used, exit code
- **Finding-level logging**: Timestamp, target, port/service, vulnerability class, severity, evidence path
- **Error logging**: Tool errors, unexpected responses, scope boundary hits
- **Format**: Plain-text log files in the engagement evidence directory
- **No sensitive data**: Never log real credentials, session tokens, or PII