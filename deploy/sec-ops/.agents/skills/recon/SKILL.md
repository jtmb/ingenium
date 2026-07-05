---
name: recon
description: "Passive and active reconnaissance techniques: DNS enumeration, subdomain discovery, port scanning, technology fingerprinting, OSINT gathering, and attack surface mapping. Use when the task involves discovering targets, mapping infrastructure, or collecting intelligence."
---

# Reconnaissance Skill

You are performing **reconnaissance** — the foundation of every penetration test. Your goal is to map the target's attack surface thoroughly before any exploitation begins. You operate in two phases: **passive** (no direct contact with target) and **active** (direct interaction with target systems).

## Passive Reconnaissance (OSINT)

### DNS Enumeration
```bash
# Basic DNS records
dig A $domain
dig AAAA $domain
dig MX $domain
dig NS $domain
dig TXT $domain
dig CNAME $domain

# DNS zone transfer (rarely works but always try)
dig axfr @$nameserver $domain

# Brute-force subdomains with common wordlist
dnsrecon -d $domain -D /usr/share/wordlists/dirb/common.txt -t brt
```

### Subdomain Discovery
```bash
# Certificate transparency logs (crt.sh) — no rate limit, highly effective
curl -s "https://crt.sh/?q=%25.$domain&output=json" | jq -r '.[].name_value' | sort -u

# Assetfinder — passive, fast
assetfinder --subs-only $domain

# Subfinder — uses multiple sources
subfinder -d $domain -o subdomains.txt

# Amass — thorough but slow
amass enum -passive -d $domain -o amass-results.txt
```

### Technology Fingerprinting
```bash
# WhatWeb — identify CMS, frameworks, server software
whatweb -a 3 $target

# httpx — probe subdomains for HTTP servers, title, tech
httpx -l subdomains.txt -title -tech-detect -status-code -o httpx-results.txt

# Wappalyzer CLI (via Docker or npm)
docker pull wappalyzer/cli
docker run wappalyzer/cli https://$target
```

### Google Dorking — Essential Operators
| Operator | Purpose | Example |
|----------|---------|---------|
| `site:` | Scope to domain | `site:example.com` |
| `inurl:` | Match URL path | `inurl:wp-admin` |
| `intitle:` | Match page title | `intitle:"index of"` |
| `filetype:` | Match file extension | `filetype:sql` |
| `intext:` | Match body text | `intext:"password"` |
| `cache:` | View cached version | `cache:example.com` |
| `link:` | Find backlinks | `link:example.com` |

### Email & Credential OSINT
```bash
# theHarvester — emails, subdomains, IPs
theHarvester -d $domain -b google,linkedin,bing,certspotter

# holehe — check if email is registered on various services
holehe $email

# h8mail — breach data lookup (needs API key for best results)
h8mail -t $email
```

### GitHub Dorking
```bash
# Search for secrets in public repos (use gh CLI or browser)
gh search code "api.key=$domain" --owner=$owner
gh search code "password" --repo=$owner/$repo
```

## Active Reconnaissance

### Port Scanning — Nmap
```bash
# Quick scan (top 1000 ports)
nmap -sS -sV -T4 $target

# Full scan (all 65535 ports) — SLOW but thorough
nmap -sS -sV -sC -O -p- -T4 $target -oA full-scan

# Stealth scan with version intensity
nmap -sS -sV --version-intensity 9 -p $(grep -oP '\d+' open-ports.txt | tr '\n' ',') $target

# UDP scan (critical for DNS, SNMP, DHCP services)
nmap -sU --top-ports 100 $target

# NSE vulnerability scripts
nmap --script vuln -p $(ports) $target

# NSE service-specific scripts
nmap --script http-*,ssl-*,smb-* -p $(ports) $target
```

### Service-Specific Enumeration

**Web Servers:**
```bash
# Directory busting with ffuf (fast)
ffuf -w /usr/share/wordlists/dirb/common.txt -u http://$target/FUZZ -c -t 50

# Recursive directory busting with gobuster
gobuster dir -u http://$target -w /usr/share/wordlists/dirb/common.txt -t 50

# Virtual host discovery
ffuf -w subdomains.txt -H "Host: FUZZ.$domain" -u http://$target -fc 200
```

**SMB (Port 445):**
```bash
# Enumerate shares, users, OS info
crackmapexec smb $target
smbclient -L //$target -N
enum4linux -a $target
```

**SNMP (Port 161/udp):**
```bash
# Brute-force community strings
onesixtyone -c /usr/share/wordlists/dirb/common.txt $target
snmpwalk -v2c -c public $target
```

**LDAP (Port 389/636):**
```bash
ldapsearch -x -H ldap://$target -b "dc=$domain,dc=$ext"
```

**DNS (Port 53):**
```bash
# Enumerate DNS records for a domain
dnsrecon -d $domain -t std
```

### Screenshotting
```bash
# gowitness — screenshot multiple web services
gowitness file -f httpx-results.txt

# aquatone — alternative with clustering
cat httpx-results.txt | aquatone -out screenshots/
```

## Wordlists for Recon

| Purpose | Wordlist | Source |
|---------|----------|--------|
| Subdomains | `SecLists/Discovery/DNS/subdomains-top1million-5000.txt` | `apt install seclists` |
| Directories | `/usr/share/wordlists/dirb/common.txt` | `apt install dirb` |
| Files/backups | `SecLists/Discovery/Web-Content/raft-large-files.txt` | `apt install seclists` |
| Parameters | `SecLists/Discovery/Web-Content/burp-parameter-names.txt` | `apt install seclists` |

## Tool Acquisition
```bash
# Check what's available first
which nmap ffuf gobuster amass subfinder assetfinder httpx whatweb dnsrecon

# Install missing tools via apt
sudo apt update && sudo apt install -y nmap dnsutils whois whatweb dnsrecon

# Install Go tools (requires golang-go)
go install github.com/projectdiscovery/httpx/cmd/httpx@latest
go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
go install github.com/tomnomnom/assetfinder@latest
go install github.com/ffuf/ffuf@latest

# Install Python tools via pipx
pipx install theHarvester holebe
```
