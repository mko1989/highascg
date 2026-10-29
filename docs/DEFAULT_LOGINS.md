# Default logins

Every HighAsCG box built from the ISO ships with the same logins. They are published here on purpose: they are
**not secrets**. **Change them on your own box**; the commands are below.

| What | User | Password | Where it is used |
|------|------|----------|------------------|
| Box account (desktop, terminal, SSH, `sudo`) | `casparcg` | `highascg` | the installed system |
| Live USB session (before installing) | `live` | `evolution` | only while booted from the stick; root is `evolution` too |
| GDTF Share (fixture library download) | the box's shared account | stored in `~/.highascg/gdtf-share.json` | Previs → Fixtures, MVR import |

Nothing else ships:
- no SSH host keys (each install makes its own on first start);
- no SSH user keys;
- no TLS key (the old :4443 HTTPS proxy is gone, WO-822; a leftover `config/certs/` is excluded from sticks, ISOs and releases);
- no API token (made on first boot when auth is on, see [SECURITY.md](./SECURITY.md));
- no Tailscale, Syncthing or GitHub identity;
- no Companion database.

## Change the box password (do this first)

Open a terminal on the box (or `ssh casparcg@<box-ip>`):

```bash
passwd
```

1. Type the current password: `highascg`.
2. Type the new password twice.

It changes the desktop, SSH and `sudo` password at once.

## Use your own GDTF Share account (optional)

The shared account works out of the box. To use your own free account from <https://gdtf-share.com> instead (activate
it from the e-mail first: a new account answers 401 until then):

```bash
curl -s -X POST http://127.0.0.1:4200/api/fixtures/share/account \
  -H 'Content-Type: application/json' \
  -d '{"user":"YOUR_USER","password":"YOUR_PASSWORD"}'
```

The password is stored only on this box (`~/.highascg/gdtf-share.json`, mode 0600) and is never sent back by the API.

## For whoever builds the ISO

- `tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh` warns when `casparcg`'s password is not `highascg`. The
  installer has no "create user" step, so the build box's password is what every install gets.
- The exclude lists (`penguins-eggs-exclude-highascg-*.list`, WO-669) keep everything else in the "nothing else
  ships" list above off the ISO.
