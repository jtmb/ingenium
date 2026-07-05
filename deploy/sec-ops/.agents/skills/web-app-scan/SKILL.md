---
name: web-app-scan
description: "Web application security scanning: directory busting, parameter fuzzing, OWASP Top 10 testing, CMS scanning, API testing, and client-side analysis. Use when assessing web applications, APIs, or CMS platforms."
---

# Web Application Scanning Skill

You are performing **web application security testing** — assessing web applications, APIs, and CMS platforms for vulnerabilities following OWASP Top 10 and WSTG methodologies.

## Information Gathering

### Technology Fingerprinting
```bash
# WhatWeb — comprehensive tech detection
whatweb -a 3 $target -v

# httpx — fast probing of multiple hosts
httpx -l targets.txt -title -tech-detect -status-code -content-type -o tech-report.txt

# Manual checks
curl -sI https://$target | grep -i "server\|x-powered-by\|x-generator"
curl -s https://$target | grep -i "wp-content\|wp-includes\|joomla\|drupal\|laravel\|django"
```

### Directory & File Enumeration
```bash
# ffuf — fast web fuzzer (preferred)
ffuf -w /usr/share/wordlists/dirb/common.txt -u https://$target/FUZZ -c -t 50
ffuf -w /usr/share/seclists/Discovery/Web-Content/raft-large-directories.txt -u https://$target/FUZZ

# File extension discovery
ffuf -w /usr/share/wordlists/dirb/common.txt -u https://$target/FUZZ -e .php,.asp,.aspx,.jsp,.txt,.bak,.old,.zip,.tar.gz

# Gobuster — alternative
gobuster dir -u https://$target -w /usr/share/wordlists/dirb/common.txt -t 50 -x php,txt,bak,zip

# Recursive scan for deep content
ffuf -w /usr/share/wordlists/dirb/common.txt -u https://$target/FUZZ -recursion -recursion-depth 3
```

### Parameter Fuzzing
```bash
# GET parameter discovery
ffuf -w /usr/share/seclists/Discovery/Web-Content/burp-parameter-names.txt -u https://$target/page?FUZZ=test

# POST parameter discovery
ffuf -w /usr/share/seclists/Discovery/Web-Content/burp-parameter-names.txt -u https://$target/login -X POST -d "FUZZ=test" -H "Content-Type: application/x-www-form-urlencoded"

# Value fuzzing
ffuf -w values.txt -u https://$target/endpoint?param=FUZZ
```

## OWASP Top 10 Testing

### A1 — Broken Access Control
```bash
# IDOR testing — increment/decrement IDs
# Vertical privilege escalation — try admin pages as user
# JWT manipulation — change alg to 'none', modify claims

# Check for .git/config exposure
curl -s https://$target/.git/config

# Check for exposed admin interfaces
ffuf -w admin-paths.txt -u https://$target/FUZZ
```

### A2 — Cryptographic Failures
```bash
# Check HTTPS enforcement
curl -sI http://$target/ | grep -i "location\|https"
curl -sI https://$target/ | grep -i "strict-transport-security"

# TestSSL — thorough TLS assessment
testssl.sh https://$target

# Check for sensitive data in responses
curl -s https://$target/api/users | grep -i "password\|secret\|token\|credit"
```

### A3 — Injection (SQLi)
```bash
# Automated SQL injection testing with sqlmap
sqlmap -u "https://$target/page?id=1" --batch --risk=2 --level=3
sqlmap -u "https://$target/page?id=1" --batch --dbs  # enumerate databases
sqlmap -u "https://$target/page?id=1" --batch -D dbname --tables  # tables
sqlmap -u "https://$target/page?id=1" --batch -D dbname -T users --dump  # dump (auth only)

# POST-based injection
sqlmap -u "https://$target/login" --data="user=admin&pass=test" --batch

# Blind SQLi detection
ffuf -w sqli-payloads.txt -u "https://$target/page?id=FUZZ" -fs $expected_size
```

### A3 — Cross-Site Scripting (XSS)
```bash
# Reflected XSS — test parameters
ffuf -w xss-payloads.txt -u "https://$target/search?q=FUZZ" -fr "error|not found"

# Stored XSS — test input fields, comments, profiles
# Use xsstrike for automated detection
xsstrike -u "https://$target/search?q=test" --crawl

# DOM XSS — look for document.write, innerHTML, eval in JS
# Use browser dev tools or grep source scripts
```

### A4 — Insecure Design
```bash
# Rate limiting testing
for i in $(seq 1 100); do curl -s "https://$target/login" -d "user=test$i&pass=test$i" | grep -i "rate\|limit\|too many"; done

# Business logic flaws — manipulate quantities, prices, workflows
# Authentication bypass via parameter manipulation
```

### A5 — Security Misconfiguration
```bash
# Check security headers
curl -sI https://$target | grep -i "x-content-type-options\|x-frame-options\|x-xss-protection\|strict-transport-security\|content-security-policy"

# Directory listing
curl -s https://$target/wp-content/uploads/ | head -20

# Default credentials — always try admin:admin, root:root, etc.
# Check for verbose error pages, stack traces
```

### A6 — Vulnerable Components
```bash
# Identify versions from headers, HTML comments, JS files
# Cross-reference with CVE databases (cvemitre.org, nvd.nist.gov)
# Check for outdated libraries via Wappalyzer/whatweb data
```

### A7 — Authentication Failures
```bash
# Test for weak passwords, no lockout, verbose login errors
# JWT signing algorithm confusion (alg:none, RS256→HS256)
# Session fixation, concurrent session handling

# Brute-force login
hydra -l admin -P /usr/share/wordlists/rockyou.txt $target http-post-form "/login:user=^USER^&pass=^PASS^:F=incorrect"
```

### A8 — Software & Data Integrity Failures
```bash
# Check for unsigned updates, insecure CI/CD configs
# Subresource integrity checking
curl -s https://$target | grep -i "integrity=" | grep -v "sha384\|sha512"
```

### A9 — Security Logging & Monitoring Failures
```bash
# Trigger 401/403 and check if logging exists
# No rate limiting = logging likely absent
# Test fake credentials to see error messages
```

### A10 — Server-Side Request Forgery (SSRF)
```bash
# Test URL parameters, file includes, import features
# Use a collaborator/request bin to detect callbacks
curl -s "https://$target/fetch?url=http://burpcollaborator.net"
ffuf -w url-payloads.txt -u "https://$target/fetch?url=FUZZ"
```

## CMS-Specific Scanning

### WordPress
```bash
# wpscan — full WordPress assessment
wpscan --url https://$target --enumerate u,vp,vt,tt,cb,dbe

# REST API endpoint enumeration
curl -s https://$target/wp-json/wp/v2/users | jq .
curl -s https://$target/wp-json/wp/v2/plugins | jq .
```

### Joomla
```bash
joomscan -u https://$target
```

### Drupal
```bash
droopescan scan drupal -u https://$target
```

## API Testing

```bash
# Enumerate endpoints from OpenAPI/Swagger docs
curl -s https://$target/api/swagger.json | jq '.paths | keys'

# Fuzz API parameters
ffuf -w /usr/share/seclists/Discovery/Web-Content/api/api-endpoints.txt -u https://$target/api/FUZZ

# Test for excessive data exposure
curl -s https://$target/api/users/1 | jq .

# GraphQL introspection
curl -s https://$target/graphql -H "Content-Type: application/json" -d '{"query":"{__schema{types{name fields{name}}}}"}'
```

## WebSocket Testing
```bash
# Connect to WebSocket endpoint
websocat wss://$target/ws

# Look for message injection, auth bypass, DoS
```

## Tool Installation
```bash
# Essential web tools
sudo apt update && sudo apt install -y \
    ffuf gobuster dirb wfuzz \
    whatweb nikto \
    sqlmap hydra \
    jq curl

# Python tools via pipx
pipx install xsstrike wpscan

# Go tools
go install github.com/projectdiscovery/httpx/cmd/httpx@latest

# Node tools
npm install -g websocat

# testssl.sh
git clone --depth 1 https://github.com/drwetter/testssl.sh.git ~/tools/testssl.sh
```
