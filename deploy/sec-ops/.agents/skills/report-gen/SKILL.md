---
name: report-gen
description: "Penetration test report generation: finding documentation, CVSS scoring, evidence packaging, executive summaries, remediation roadmaps, and professional report formatting. Use when documenting findings, creating deliverables, or finalizing engagement reports."
---

# Report Generation Skill

You are generating a **penetration test report** — the primary deliverable of the engagement. A well-structured report bridges the gap between technical findings and business risk. Every finding must be actionable, evidence-backed, and clearly communicated.

## Report Structure

### Executive Summary
The executive summary is read by C-level stakeholders who need to understand risk without technical detail.

```markdown
## Executive Summary

From {start date} to {end date}, {company} engaged {tester/team} to perform a
penetration test of {scope}. The assessment identified {N} vulnerabilities:

| Severity | Count |
|----------|-------|
| Critical | {N} |
| High     | {N} |
| Medium   | {N} |
| Low      | {N} |
| Info     | {N} |

**Overall Risk Rating: {Critical / High / Medium / Low}**

### Key Findings
- {Critical finding 1 — one-liner impact}
- {Critical finding 2 — one-liner impact}
- {Positive finding — what was done well}

### Strategic Recommendations
1. {Top priority fix} — {expected effort}
2. {Second priority fix} — {expected effort}
3. {Third priority fix} — {expected effort}
```

### Findings Table
```markdown
| # | Vulnerability | Severity | CVSS | Asset | Status |
|---|--------------|----------|------|-------|--------|
| 1 | SQL Injection in login.php | Critical | 9.8 | https://app.example.com | Open |
| 2 | Weak TLS Cipher Suites | High | 7.4 | https://api.example.com | Open |
| 3 | Missing HSTS Header | Medium | 5.9 | https://example.com | Open |
| 4 | Information Disclosure in /robots.txt | Low | 2.5 | https://example.com | Open |
```

### Individual Finding Template
```markdown
## Finding {N}: {Title}

**Severity:** {Critical / High / Medium / Low / Info}
**CVSS Score:** {X.X} (CVSS:3.1/{Vector String})
**Asset:** {URL / IP / Hostname}
**Status:** {Open / Resolved / Accepted Risk}

### Description
{A clear, concise description of the vulnerability. What is it?
Why is it a problem? What is the business impact?}

### Steps to Reproduce
\`\`\`bash
# Exact commands to reproduce the finding
# Include the full command and truncated output
nmap -sV --script ssl-enum-ciphers -p 443 example.com
\`\`\`

**Expected result:** {What should happen in a secure configuration}
**Actual result:** {What actually happened — the vulnerability}

### Evidence
\`\`\`
Relevant log output, screenshots, or response data.
Keep evidence concise — reference appendices for full logs.
\`\`\`

### Remediation
{Step-by-step instructions to fix the vulnerability. Be specific.}

### References
- CVE-XXXX-XXXX: {link}
- OWASP: {link}
- CWE-XXX: {link}
```

## CVSS Scoring (v3.1)

### Base Metrics
| Metric | Value | Score |
|--------|-------|-------|
| Attack Vector (AV) | N=Network, A=Adjacent, L=Local, P=Physical |
| Attack Complexity (AC) | L=Low, H=High |
| Privileges Required (PR) | N=None, L=Low, H=High |
| User Interaction (UI) | N=None, R=Required |
| Scope (S) | U=Unchanged, C=Changed |
| Confidentiality (C) | H=High, L=Low, N=None |
| Integrity (I) | H=High, L=Low, N=None |
| Availability (A) | H=High, L=Low, N=None |

### Severity Thresholds
| Score Range | Severity |
|-------------|----------|
| 0.0 | None |
| 0.1–3.9 | Low |
| 4.0–6.9 | Medium |
| 7.0–8.9 | High |
| 9.0–10.0 | Critical |

### CVSS Calculator Function
```python
#!/usr/bin/env python3
"""Calculate CVSS v3.1 base score from vector string."""
import cvss  # pip install cvss

vector = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
c = cvss.CVSS3(vector)
print(f"Score: {c.base_score}")  # 9.8
print(f"Severity: {c.base_severity}")  # CRITICAL
print(f"Vector: {c.clean_vector()}")
```

## Evidence Management

### Directory Structure for Evidence
```bash
engagement/
├── reports/
│   ├── pentest-report-v1.0.md        # Final report (markdown)
│   ├── pentest-report-v1.0.pdf       # Final report (PDF)
│   └── artifacts/
│       ├── screenshots/               # PNG of each finding
│       ├── logs/                      # Command output files
│       ├── captures/                  # PCAP, hash files
│       └── poc/                       # Proof-of-concept scripts
├── recon/
│   ├── nmap-full-scan.txt
│   ├── subdomains.txt
│   └── tech-fingerprint.txt
├── enumeration/
│   ├── directory-busting.txt
│   ├── service-versions.txt
│   └── users.txt
├── exploitation/
│   ├── sqlmap-results.txt
│   └── hashcat-results.txt
└── logs/
    ├── session-090215.log
    └── session-143022.log
```

### Evidence Integrity
```bash
# Hash evidence files for integrity verification
sha256sum screenshot.png >> evidence-hashes.txt
sha256sum logfile.txt >> evidence-hashes.txt
gpg --clearsign evidence-hashes.txt  # sign with your key
```

## Remediation Roadmap

```markdown
## Remediation Roadmap

### Immediate (0–30 days)
| Priority | Finding | Effort | Owner |
|----------|---------|--------|-------|
| P1 | SQL Injection in login.php | 2 days | Dev Team |
| P2 | Default admin credentials | 1 hour | Ops Team |

### Short-term (30–90 days)
| Priority | Finding | Effort | Owner |
|----------|---------|--------|-------|
| P3 | Weak TLS ciphers | 1 day | Ops Team |
| P4 | Missing security headers | 2 days | Dev Team |

### Long-term (90+ days)
| Priority | Finding | Effort | Owner |
|----------|---------|--------|-------|
| P5 | No MFA on admin portal | 1 week | Dev+Ops |
| P6 | No rate limiting on API | 3 days | Dev Team |
```

## Report Generation Automation

### Using Pandoc (Markdown → PDF)
```bash
# Convert markdown to professional PDF
pandoc pentest-report.md \
    --pdf-engine=xelatex \
    -V geometry:margin=1in \
    -V title="Penetration Test Report" \
    -V subtitle="Target Company — June 2026" \
    -V author="PentestAgent" \
    -V date="$(date +%B-%Y)" \
    -o pentest-report.pdf

# With custom template
pandoc pentest-report.md --template=pentest-template.tex -o pentest-report.pdf
```

### Markdown Standards for Reports
```markdown
# Report Title
## Executive Summary
## Methodology
## Findings Summary
### Finding 1: Title
#### Description
#### Steps to Reproduce
#### Evidence
#### Remediation
#### References
## Detailed Findings
## Remediation Roadmap
## Appendices
### A — Scope
### B — Tools Used
### C — Raw Logs
```

### Python Report Generator
```python
#!/usr/bin/env python3
"""Generate pentest report from structured findings data."""
import json
import datetime

def generate_report(findings, scope, tester):
    """Generate a markdown pentest report from structured data."""
    report = []
    report.append(f"# Penetration Test Report")
    report.append(f"**Tester:** {tester}")
    report.append(f"**Date:** {datetime.date.today()}")
    report.append(f"**Scope:** {scope}\n")
    report.append("## Executive Summary\n")
    # Count by severity
    severities = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0}
    for f in findings:
        severities[f["severity"]] += 1
    report.append("| Severity | Count |")
    report.append("|----------|-------|")
    for sev, count in severities.items():
        report.append(f"| {sev} | {count} |")
    report.append(f"\n**Total Findings:** {len(findings)}\n")
    report.append("## Findings\n")
    for i, f in enumerate(findings, 1):
        report.append(f"### Finding {i}: {f['title']}\n")
        report.append(f"**Severity:** {f['severity']}")
        report.append(f"**CVSS:** {f['cvss']}")
        report.append(f"**Asset:** {f['asset']}\n")
        report.append(f"{f['description']}\n")
        report.append(f"#### Remediation\n{f['remediation']}\n")
        report.append(f"---\n")
    return "\n".join(report)

# Usage
findings = [
    {
        "title": "SQL Injection in login.php",
        "severity": "Critical",
        "cvss": "9.8",
        "asset": "https://app.example.com",
        "description": "The login endpoint is vulnerable...",
        "remediation": "Use parameterized queries..."
    }
]
report = generate_report(findings, "example.com", "PentestAgent")
with open("pentest-report.md", "w") as f:
    f.write(report)
```

## Communication Guidelines

### Technical vs. Non-Technical
| Audience | Focus | Language |
|----------|-------|----------|
| Developers | Root cause, code-level fix | Technical, specific |
| IT/Security Ops | Configuration, patches | Operational |
| Management | Risk, business impact, cost | Business-oriented |
| Executives | Overall risk posture, bottom line | Non-technical, brief |

### Severity Communication
- **Critical**: "Immediate threat — exploitation likely causes significant breach."
- **High**: "Serious risk — should be prioritized in next sprint."
- **Medium**: "Moderate risk — address in normal planning cycle."
- **Low**: "Minor issue — address when convenient, or accept risk."
- **Info**: "Informational — no immediate risk, but good to address."

## Tool Installation
```bash
# Report generation tools
sudo apt update && sudo apt install -y \
    pandoc texlive-xetex \
    graphviz  # for diagrams

# Python packages
pip install cvss  # CVSS calculator

# Optional — for professional PDF output
sudo apt install -y \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-fonts-extra
```
