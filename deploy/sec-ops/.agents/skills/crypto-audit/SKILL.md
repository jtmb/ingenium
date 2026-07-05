---
name: crypto-audit
description: "Cryptography auditing: TLS/SSL assessment, certificate validation, weak cipher detection, protocol analysis, key strength evaluation, and cryptographic implementation review. Use when testing HTTPS, TLS, certificates, or custom crypto implementations."
---

# Cryptography Audit Skill

You are performing a **cryptography audit** — assessing the strength and correctness of cryptographic implementations. This includes TLS configurations, certificate chains, cipher suites, key management, and custom cryptographic code.

## TLS/SSL Assessment

### testssl.sh — Comprehensive TLS Testing
```bash
# Run full test
~/tools/testssl.sh/testssl.sh https://$target

# Quick check (just vulnerabilities)
~/tools/testssl.sh/testssl.sh --vulnerable https://$target

# Check specific cipher suites
~/tools/testssl.sh/testssl.sh --cipher-per-proto https://$target

# Check protocols only
~/tools/testssl.sh/testssl.sh --protocols https://$target

# Output to file
~/tools/testssl.sh/testssl.sh --htmlfile report.html https://$target

# Common findings to look for:
# - POODLE (SSLv3)
# - Heartbleed (CVE-2014-0160)
# - CCS injection
# - Ticketbleed
# - ROBOT (RSA key exchange)
# - FREAK (export-grade RSA)
# - Logjam (weak Diffie-Hellman)
# - BEAST (CBC in TLSv1.0)
# - LUCKY13 (CBC padding)
# - RC4 (all variants)
```

### sslyze — Fast TLS Scanner
```bash
# Basic scan
sslyze --regular $target:443

# Certificate information
sslyze --certinfo $target:443

# HTTP security headers
sslyze --http_headers $target:443

# JSON output
sslyze --json_out=report.json $target:443
```

### Nmap TLS Scripts
```bash
# TLS version support
nmap --script tls-nextprotoneg -p 443 $target

# SSL/TLS certificate info
nmap --script ssl-cert -p 443 $target

# SSL/TLS vulnerabilities
nmap --script ssl-* -p 443 $target

# Check specific ciphers
nmap --script ssl-enum-ciphers -p 443 $target
```

## Certificate Analysis

### Certificate Chain Validation
```bash
# View certificate details
echo | openssl s_client -connect $target:443 -servername $target 2>/dev/null | openssl x509 -text -noout

# Check certificate chain
echo | openssl s_client -connect $target:443 -servername $target -showcerts 2>/dev/null

# Check expiration
echo | openssl s_client -connect $target:443 -servername $target 2>/dev/null | openssl x509 -noout -dates

# Validate against CA bundle
echo | openssl s_client -connect $target:443 -servername $target -CApath /etc/ssl/certs 2>/dev/null

# Check Subject Alternative Names (SAN)
echo | openssl s_client -connect $target:443 -servername $target 2>/dev/null | openssl x509 -noout -ext subjectAltName

# OCSP stapling check
echo | openssl s_client -connect $target:443 -servername $target -status 2>/dev/null | grep -A 20 "OCSP response"
```

### Weak Key Detection
```bash
# Check key size (RSA < 2048 is weak, < 1024 is broken)
echo | openssl s_client -connect $target:443 2>/dev/null | openssl x509 -noout -text | grep "Public-Key"

# Check signature algorithm (SHA1 is weak, SHA256+ is good)
echo | openssl s_client -connect $target:443 2>/dev/null | openssl x509 -noout -text | grep "Signature Algorithm"

# Check for Debian weak keys (CVE-2008-0166)
# Key fingerprint matches known weak keys list
```

## Protocol Weaknesses

### Weak Cipher Suites to Flag
| Cipher | Issue | Severity |
|--------|-------|----------|
| RC4 | Fully broken, predictable | Critical |
| DES/3DES | 56-bit key, SWEET32 | Critical |
| CBC in TLSv1.0 | BEAST attack | High |
| EXPORT grade | FREAK attack | High |
| NULL cipher | No encryption | Critical |
| ADH/aNULL | No authentication | Critical |
| SEED/IDEA | 64-bit block, SWEET32 | Medium |
| CAMELLIA | No known attacks but unusual | Info |

### Protocol Versions
| Protocol | Status | Notes |
|----------|--------|-------|
| SSLv2 | **BROKEN** — never use | DROWN attack |
| SSLv3 | **BROKEN** — never use | POODLE attack |
| TLSv1.0 | Weak — avoid | BEAST, PCI-DSS requires disabling |
| TLSv1.1 | Weak — avoid | Deprecated by PCI-DSS |
| TLSv1.2 | **Current standard** | Acceptable with strong ciphers |
| TLSv1.3 | **Best** | Modern, secure, preferred |

### Perfect Forward Secrecy Check
```bash
# Check if ECDHE/DHE key exchange is supported
# For TLSv1.3, PFS is mandatory
~/tools/testssl.sh/testssl.sh --fs https://$target

# Manual check
echo | openssl s_client -connect $target:443 -cipher "ECDHE" 2>/dev/null | grep "Cipher is"
```

## SSH Crypto Audit

```bash
# Check SSH server configuration
nmap --script ssh2-enum-algos -p 22 $target

# Detailed cipher/hostkey/KEX listing
ssh -vv -o PreferredAuthentications=none $target 2>&1 | grep -i "kex\|cipher\|hmac\|hostkey"

# SSH audit tool
ssh-audit $target
```

## Weak Key Generation Checks

### Debian OpenSSL Weak Keys (CVE-2008-0166)
```bash
# Check if SSH key was generated on Debian/Ubuntu with buggy OpenSSL
# Key fingerprints from known weak keys list
# Tools: openssl-blacklist package
```

### Random Number Generator Weakness
```bash
# Check for low entropy in embedded devices
# Check /proc/sys/kernel/random/entropy_avail on target systems
# Yarrow vs. SHA1PRNG vs. /dev/urandom vs. getrandom()
```

## Certificate Transparency & Pinning

```bash
# Check Certificate Transparency logs
curl -s "https://crt.sh/?q=%25.$domain&output=json" | jq -r '.[].name_value' | sort -u

# Check HPKP (HTTP Public Key Pinning) — deprecated but still in use
curl -sI https://$target | grep -i "public-key-pins"

# Check Certificate Transparency (Expect-CT header)
curl -sI https://$target | grep -i "expect-ct"
```

## Misconfiguration Checklist
- [ ] Self-signed certificate in production
- [ ] Hostname mismatch (cert issued for different domain)
- [ ] Expired certificate
- [ ] Wildcard certificate for sensitive subdomains
- [ ] Weak signature algorithm (SHA-1, MD5)
- [ ] Short key length (< 2048-bit RSA, < 256-bit ECC)
- [ ] Incomplete certificate chain
- [ ] Missing CRL/OCSP endpoints
- [ ] TLS compression enabled (CRIME attack)
- [ ] Session resumption via session IDs (no forward secrecy)
- [ ] OCSP stapling not enabled
- [ ] HSTS not enabled or too short (`max-age < 31536000`)

## Tool Installation
```bash
# Crypto audit tools
sudo apt update && sudo apt install -y \
    openssl sslyze \
    nmap

# testssl.sh (clone from GitHub)
git clone --depth 1 https://github.com/drwetter/testssl.sh.git ~/tools/testssl.sh

# ssh-audit (pipx)
pipx install ssh-audit

# Additional tools
pipx install tlspickle
```
