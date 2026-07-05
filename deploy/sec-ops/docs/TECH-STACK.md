# Tech Stack

## Environment

| Component | Version / Spec | Notes |
|-----------|---------------|-------|
| **Operating System** | Ubuntu 24.04 LTS (WSL2) | Windows Subsystem for Linux 2 — network tools work differently than native Linux; prefer CLI over GUI |
| **Shell** | Bash 5.x | Default shell for all tool execution |
| **Python** | 3.12+ | PoC scripts, automation, pipx for tool management |
| **OpenCode** | Latest | Agent orchestration platform (replaces GitHub Copilot as primary agent interface) |

## Pentesting Tools

### Reconnaissance & OSINT

| Tool | Installation | Purpose | Domain Skill |
|------|-------------|---------|-------------|
| `nmap` | `apt install nmap` | Port scanning, service detection, NSE scripts | `network-pentest` |
| `masscan` | `apt install masscan` | High-speed port scanning (use with caution) | `network-pentest` |
| `dnsrecon` | `apt install dnsrecon` | DNS enumeration, subdomain discovery | `recon` |
| `dig` | `apt install dnsutils` | DNS record queries | `recon` |
| `whatweb` | `apt install whatweb` | Web technology fingerprinting | `recon` |
| `whois` | `apt install whois` | Domain registration lookups | `recon` |

### Web Application Testing

| Tool | Installation | Purpose | Domain Skill |
|------|-------------|---------|-------------|
| `sqlmap` | `apt install sqlmap` | SQL injection detection and exploitation | `web-app-scan` |
| `ffuf` | `apt install ffuf` (or `go install`) | Fast web fuzzing, directory discovery | `web-app-scan` |
| `gobuster` | `apt install gobuster` | Directory/file/DNS subdomain brute-forcing | `web-app-scan` |
| `nikto` | `apt install nikto` | Web server vulnerability scanner | `web-app-scan` |
| `wpscan` | `gem install wpscan` (or `apt`) | WordPress security scanner | `wordpress-pentest` |
| `testssl.sh` | `apt install testssl.sh` | TLS/SSL protocol and cipher testing | `crypto-audit` |
| `sslscan` | `apt install sslscan` | SSL/TLS configuration assessment | `crypto-audit` |

### Authentication & Password Testing

| Tool | Installation | Purpose | Domain Skill |
|------|-------------|---------|-------------|
| `hashcat` | `apt install hashcat` | GPU-accelerated password cracking | `password-audit` |
| `john` | `apt install john` | CPU-based password cracking | `password-audit` |
| `hydra` | `apt install hydra` | Online authentication brute-forcing | `password-audit` |

### Exploitation Framework

| Tool | Installation | Purpose | Domain Skill |
|------|-------------|---------|-------------|
| `metasploit-framework` | `apt install metasploit-framework` | Exploitation framework, auxiliary modules | `exploit-validation` |
| `msfconsole` | (part of metasploit-framework) | Main Metasploit interface | `exploit-validation` |

### Wireless (if applicable)

| Tool | Installation | Purpose | Domain Skill |
|------|-------------|---------|-------------|
| `aircrack-ng` | `apt install aircrack-ng` | WEP/WPA key cracking, wireless assessment | `wireless-audit` |
| `airodump-ng` | (part of aircrack-ng) | Wireless packet capture | `wireless-audit` |
| `aireplay-ng` | (part of aircrack-ng) | Wireless packet injection | `wireless-audit` |

## Agent Models

| Role | Model | Provider | Purpose |
|------|-------|----------|---------|
| **ingenium-planner** | DeepSeek V4 Pro (`deepseek/deepseek-v4-pro`) | DeepSeek API | Engagement planning, target analysis, multi-step reasoning |
| **ingenium-orchestrator** | DeepSeek V4 Flash (`deepseek/deepseek-v4-flash`) | DeepSeek API | Tool execution, evidence collection, coordination |
| **ingenium-explore** | DeepSeek V4 Flash (`deepseek/deepseek-v4-flash`) | DeepSeek API | Fast target discovery and tool research |
| **ingenium-scout** | qwopus 3.5 9B Coder (`lmstudio/qwopus3.5-9b-coder`) | LM Studio | Persistent memory via Thread MCP (local, free) |
| **ingenium-security-engineer** | DeepSeek V4 Flash (`opencode/deepseek-v4-flash-free`) | OpenCode Zen | Pentest design review, tool chain validation (free tier) |
| **ingenium-qa** | DeepSeek V4 Flash (`opencode/deepseek-v4-flash-free`) | OpenCode Zen | PoC script testing and code review (free tier) |
| **ingenium-docs** | DeepSeek V4 Flash (`opencode/deepseek-v4-flash-free`) | OpenCode Zen | Documentation and report generation (free tier) |
| **ingenium-security-auditor** | DeepSeek V4 Flash (`deepseek/deepseek-v4-flash`) | DeepSeek API | Project security audits and git-history scanning |

## Package Managers

| Manager | Use for | Example |
|---------|---------|---------|
| `apt` | System packages, stable tool versions | `sudo apt install nmap sqlmap hashcat` |
| `pipx` | Python-based tools (isolated) | `pipx install sqlmap` |
| `go install` | Go-based tools | `go install github.com/ffuf/ffuf@latest` |
| `gem install` | Ruby gems | `gem install wpscan` |

## Key Python Dependencies

| Package | Purpose | Installation |
|---------|---------|-------------|
| `requests` | HTTP client for PoC scripts | `pipx install requests` or project venv |
| `beautifulsoup4` | HTML parsing for web PoCs | `pipx install beautifulsoup4` |
| `urllib3` | Lower-level HTTP operations | (stdlib) |

## Framework

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Skill system** | Ingenium (self-hosted) | Agent behavior governance, methodology enforcement |
| **Agent orchestration** | OpenCode | Primary agent platform (8 agents defined) |
| **Persistent memory** | Thread MCP | Cross-session context, past findings, technique memory |
| **Editor** | VS Code with WSL2 remote | Development and tool execution environment |

## Infrastructure

- **No servers, databases, or containers required** — the system is entirely file-based
- **WSL2 (Ubuntu 24.04)** runs on Windows with direct access to Windows network stack
- **No cloud dependencies** for core operation — all tools run locally
- **Thread MCP** can be local or remote depending on configuration

## Version Policy

- **Pentesting tools**: Latest stable version from apt repositories (Ubuntu 24.04 repos are well-maintained for security tools)
- **Python packages**: Managed via pipx for isolation — no global Python conflicts
- **Go tools**: Pinned to latest release via `go install`
- **Agent models**: Cloud-hosted (DeepSeek API) and local (LM Studio) — no version management needed
- **Skill system**: Versioned via git — each engagement on its own branch or tag

## Tool Installation Quick Reference

```bash
# Essential recon tools
sudo apt update
sudo apt install -y nmap masscan dnsutils dnsrecon whatweb whois

# Web application tools
sudo apt install -y sqlmap ffuf gobuster nikto testssl.sh sslscan

# Password tools
sudo apt install -y hashcat john hydra

# Metasploit
sudo apt install -y metasploit-framework

# WordPress
sudo gem install wpscan

# Payload/coding tools
sudo apt install -y python3-pip pipx
pipx ensurepath

# Python PoC dependencies
pipx install requests beautifulsoup4
```