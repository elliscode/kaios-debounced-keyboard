# Setup — one new Nokia 2780 at a time

This is the exact path that works. The two non-obvious rules:

1. A fresh phone has **no ADB**. Enable it first with JScalated, then do a **full
   power-off/on**.
2. The deploy only works from the System page **after JScalated's loader has
   run**. That loader must be redone after every reboot.

## 0. Prerequisites

- Nokia 2780 (KaiOS 3.1), USB **data** cable.
- Mac with Python 3 and `adb`.
- JScalated shared ADB key:
  <https://jscalated.netlify.app/downloads/jscalated-adb-key.zip>
  Its private half is public — use USB only, never wireless ADB.

On the phone: **Settings → Storage → USB storage** (so adbd is visible).

## 1. Enable ADB on the phone (once per phone)

1. Plug in USB and enable USB storage on the phone.
2. Open **jscalated.netlify.app** → press **Load JScalated**.
3. On the blank System page (`system.localhost/proxy.html`), enter these two
   lines **in order**:
   ```
   javascript:document.createElement('script')
   javascript:document.write(name)
   ```
4. The JScalated panel appears. Press **Enable ADB**.
   - Leave “Enable wireless ADB on port 5555” **off**.
   - Wait until the log box reports the XPI/profile and request staged.
5. **Turn the whole phone off and on.** A browser reload is not a reboot. The
   XPI installs the matching ADB key and enables the service on boot.
6. On the Mac, keep the key somewhere durable (not in the repo):
   ```sh
   mkdir -p ~/.config/kaios
   unzip -o jscalated-adb-key.zip -d ~/.config/kaios   # adbkey + adbkey.pub
   chmod 600 ~/.config/kaios/adbkey
   ADB_VENDOR_KEYS=~/.config/kaios/adbkey adb devices
   ```
   Expect `<serial>  device`. If it says `unauthorized`, toggle USB storage /
   replug and redo step 1. If nothing appears, check the cable is a data cable.

## 2. Start the server and tunnel

```sh
cd kaios-debounce-clean
python3 tools/serve.py
```

Second terminal, with the same key:

```sh
ADB_VENDOR_KEYS=~/.config/kaios/adbkey adb -s <serial> reverse tcp:8088 tcp:8088
# all connected phones at once:
ADB_VENDOR_KEYS=~/.config/kaios/adbkey tools/reverse-all.sh
```

Verify from the phone side:

```sh
ADB_VENDOR_KEYS=~/.config/kaios/adbkey adb -s <serial> shell \
  'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8088/d'
```

It must print `200`.

## 3. Load the privileged System page (again, after the reboot)

1. jscalated.netlify.app → **Load JScalated**.
2. On the blank System page, the two lines:
   ```
   javascript:document.createElement('script')
   javascript:document.write(name)
   ```
3. Wait for the JScalated panel.

> This is required. The package is written as the System process, and that only
> works from this page after JScalated's loader has run. A direct visit to
> `proxy.html` is not equivalent.

## 4. Deploy

Still on the System page:

```
javascript:import('http://127.0.0.1:8088/d')
```

Watch:

- Mac server: `… /d -> build/deploy_selfcontained.js`
- phone log: `adb -s <serial> logcat -s Gecko | grep kbdeploy` (or
  `adb logcat | grep kbdeploy`) → `[kbdeploy] … DEPLOY OK`

If nothing happens, the loader in step 3 was not active. Redo step 3.

## 5. Reboot and verify

Power off/on. Then:

- Open **Messages** → new message. The suggestion bar must be **pink**.
- Open `http://keyboard.localhost/config.html`.
  - Default same-key cooldown is **100 ms**.
  - Press **100 ms cooldown** (or **1 s cooldown**) → **Save**.
  - Type `666666` fast, then `64646`. Same-key repeats are limited;
    alternating keys are untouched.
- Optional: enable **Show JS marker** → Save. The candidate bar gets a left
  edge: green = JS active + cooldown > 0, yellow = JS active + cooldown 0,
  no edge = JS not active. Turn it off afterwards.

## 6. Multiple phones

Each phone is independent; the Mac server/build is shared.

1. Do step 1 on each fresh phone (ADB enable + full reboot).
2. Plug in the phones and run
   `ADB_VENDOR_KEYS=~/.config/kaios/adbkey tools/reverse-all.sh`.
3. Do steps 3–5 one phone at a time (unplug the others if that helps).
4. Configure each phone on its own `config.html`; config is per phone.

If you serve multiple phones on different ports, use `--port 8089` and the URL
`http://127.0.0.1:8089/d` for that phone's tunnel.

## Rollback

The stock keyboard symlink is preserved (first deploy: `keyboard.stock`; later:
`keyboard.previous-<time>`). `/system` is never modified.

After JScalated's loader (step 3), run:

```
javascript:import('http://127.0.0.1:8088/r')
```

Reboot. Log tag: `[kbrecover]`.

A factory reset also removes the install, if you ever want a clean slate.

## Changing settings later

No redeploy. Open `http://keyboard.localhost/config.html`, change values, Save.
They live in the keyboard origin's `localStorage` and apply within ~1 second.

## Troubleshooting

- **No `adb devices` entry:** USB storage mode, data cable, or step 1/reboot not
  done. `unauthorized` means the JScalated key is not installed yet.
- **Nothing after the import:** step 3 loader not active. Redo it on the same tab.
- **Import seems cached:** use a numbered alias (`/d2`, `/d3`, …; rollback `/r2`).
- **Port 8088 busy:** `pkill -f tools/serve.py` or use `--port 8089` and update
  the URL. If the Mac firewall prompts, allow Python.
- **No pink bar after reboot:** deploy didn't land; check `[kbdeploy]` and repeat
  steps 3–5. If the keyboard is missing, run `/r` and reboot.
