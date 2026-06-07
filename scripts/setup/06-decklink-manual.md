# Step 6 — DeckLink (manual)

HighAsCG does **not** auto-install Desktop Video. Blackmagic CDN downloads often fail from servers; install from a machine with a browser.

## When you need this

- `lspci | grep -i blackmagic` shows a DeckLink card
- Caspar `decklink` consumer/producer in your config
- Desktop Video setup GUI (`BlackmagicDesktopVideoSetup` on newer packages)

## Before GUI setup

```bash
sudo bash scripts/setup/05-caspar-deps.sh   # nodm + openbox + X input
```

Switch to X11-only mode (Caspar not started):

```bash
sudo highascg-display-mode x11-only   # if command exists from full install
# or: echo x11-only | sudo tee /etc/highascg/display-mode && sudo systemctl restart nodm
```

## Download

1. https://www.blackmagicdesign.com/support/family/capture-and-playback
2. **Desktop Video** → **Linux** → download `.tar.gz` (e.g. 15.3.x)
3. Copy to the host, e.g. `/tmp/Blackmagic_Desktop_Video_Linux_15.3.1.tar.gz`

## Install

```bash
cd /tmp
tar -xzf Blackmagic_Desktop_Video_Linux_*.tar.gz
sudo dpkg -i Blackmagic_Desktop_Video_Linux_*/deb/x86_64/desktopvideo_*.deb
sudo apt install -f -y
sudo modprobe blackmagic_io
```

## Verify

```bash
bash scripts/setup/check-decklink.sh
# or:
dpkg -l desktopvideo
lsmod | grep blackmagic
lspci -k | grep -A2 -i blackmagic
```

## GUI

On the playout console (or VNC to `:0`):

- Menu → **Blackmagic Desktop Video Setup** (`BlackmagicDesktopVideoSetup`)
- Legacy name `desktopvideo_setup` on older packages

## Resume normal playout

```bash
echo normal | sudo tee /etc/highascg/display-mode
sudo systemctl restart nodm
```
