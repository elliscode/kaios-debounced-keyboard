# KaiOS keyboard debounce (Nokia 2780)

Replaces the stock keyboard's served code with a patched build that adds a
configurable **same-key debounce/cooldown**, without root, without flashing, and
without touching `/system`. The suggestion bar is pink so you can tell the
patched build is live.

**Quick start:** [SETUP.md](SETUP.md) · **How/why it works:** [NOTES.md](NOTES.md)

## What this repo contains

- `app/` — patched keyboard source (stock app + `js/debounce*.js` + `config.html`).
- `build/deploy/application.zip` — signed package (OStore-style signature block).
- `build/deploy_selfcontained.js` — deploy module with the package embedded, so
  the phone needs no XHR (the System page's CSP blocks it).
- `deploy/fs_recover.js` — rollback to the stock keyboard.
- `tools/` — build, packaging, signing, and the dev server.
- `profiles/100ms-cooldown.json` and `profiles/1s-cooldown.json` — reference
  profiles.

## The ADB key (where it comes from)

We did **not** generate a key. The phone trusts the **JScalated shared ADB
key**, which is installed by JScalated's "Enable ADB" XPI. Download the matching
computer half from the official JScalated site:

<https://jscalated.netlify.app/downloads/jscalated-adb-key.zip>

That bundle contains `adbkey` (private half) and `adbkey.pub` (public half), and
the private half is **intentionally public** — it is a community key, not a
secret. Because of that:

- use **USB ADB only**, never JScalated's wireless ADB option;
- keep the key out of this repo (`.gitignore` blocks `adbkey`, `*.pem`, and
  `jscalated-adb-key*`);
- re-download it if you lose it. It is not recoverable from the phone.

Extract it once to a durable location on the Mac:

```sh
mkdir -p ~/.config/kaios
unzip -o jscalated-adb-key.zip -d ~/.config/kaios
chmod 600 ~/.config/kaios/adbkey
export ADB_VENDOR_KEYS=~/.config/kaios/adbkey   # or put this in ~/.zshrc
```

Every `adb` command in this repo assumes that key at
`~/.config/kaios/adbkey`. The `ADB_VENDOR_KEYS` variable is read when the adb
server starts; `adb reverse` must be re-run whenever a phone is replugged or
rebooted.

## The path for a new phone

A fresh phone has no ADB. First enable it with JScalated, then reboot:

1. USB connect, **Settings → Storage → USB storage**.
2. jscalated.netlify.app → **Load JScalated** → the two lines:
   ```
   javascript:document.createElement('script')
   javascript:document.write(name)
   ```
3. In the panel press **Enable ADB**, then **fully power off/on**.

Then on the Mac:

```sh
python3 tools/serve.py
# JScalated shared key, extracted once (see SETUP.md):
ADB_VENDOR_KEYS=~/.config/kaios/adbkey tools/reverse-all.sh
```

And on the phone (loader must be redone after the reboot):

1. jscalated.netlify.app → **Load JScalated** → the two lines again.
2. Then:
   ```
   javascript:import('http://127.0.0.1:8088/d')
   ```
3. Reboot. Pink bar = patched keyboard live.

Full details: [SETUP.md](SETUP.md).

Tune it at `http://keyboard.localhost/config.html` — no redeploy, survives
reboot. Default same-key cooldown is 100 ms; the page also has 1 s and defaults
buttons.
