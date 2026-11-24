# Setup — one new Nokia 2780 at a time

This is the exact path that works. The two non-obvious rules:

1. A fresh phone has **no ADB**. Enable it first with JScalated, then do a **full
   power-off/on**.
2. The deploy only works from the System page **after JScalated's loader has
   run**. That loader must be redone after every reboot.

## 0. Prerequisites

- Nokia 2780 (KaiOS 3.1), USB **data** cable.
- Mac with Python 3 and `adb` (`zip` and `shasum` ship with macOS).
- This repo:
  ```sh
  git clone https://github.com/elliscode/kaios-debounced-keyboard.git
  cd kaios-debounced-keyboard
  ```
  The ready-to-deploy build is committed under `build/`, so a first deploy
  needs no build step.
- Optional: Node.js, only to run the tests (`make test`).
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

From the repo folder:

```sh
python3 tools/serve.py        # or: make serve
```

Leave it running.

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

`adb reverse` is lost whenever the phone reboots or is replugged: run
`reverse-all.sh` again each time.

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

Power off/on. Then re-run the tunnel (the reboot dropped it):

```sh
ADB_VENDOR_KEYS=~/.config/kaios/adbkey tools/reverse-all.sh
```

- Open **Messages** → new message. The suggestion bar must be **soft pink**
  (stock is gray).
- Open `http://keyboard.localhost/config.html`.
  - Default same-key cooldown is **110 ms**.
  - Press **100 ms cooldown** (or **1 s cooldown**) → **Save**.
  - Type `666666` fast, then `64646`. Same-key repeats are limited;
    alternating keys are untouched.
- Predictive (T9) mode: press `4` → **I** is the first word. Type `headed`,
  space, then `4663` → **home**.
- Select: in Messages, type a word in predictive mode and press Select once.
  The word is committed and nothing is sent. Wait ~1 s and press Select again
  to send.
- Optional: enable **Show JS marker** → Save. The candidate bar gets a left
  edge: green = JS active + the current mode's cooldown > 0, yellow = JS
  active + cooldown 0, no edge = JS not active. Turn it off afterwards.

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

Prediction rules are on the same page, under **Prediction rules** (format in
[README.md](README.md#prediction-rules-predictive--t9-mode)). Edit them there,
or load a file:

1. Edit `profiles/predict.json` on the Mac.
2. Make sure `tools/serve.py` is running and `reverse-all.sh` has been run
   since the phone's last reboot.
3. On the config page press **Load** (URL
   `http://127.0.0.1:8088/profiles/predict.json`), check the summary, then
   **Save**.

## Changing the code (rebuild and redeploy)

Only needed if you edit files under `app/`.

1. `make test` (optional, needs Node).
2. `make build`. This rebuilds `build/deploy/application.zip`,
   `build/deploy_selfcontained.js` and both `SHA256SUMS.txt` files.
3. Restart nothing: `serve.py` reads the file on every request.
4. On the phone, do step 3 (JScalated loader), then deploy with a **number you
   haven't used before**, so the phone can't reuse a cached copy:
   ```
   javascript:import('http://127.0.0.1:8088/d2')
   ```
   (`/d3`, `/d4`, … next time). Check the log for `DEPLOY OK`.
5. Reboot, then re-run `reverse-all.sh`.

Settings and prediction rules saved on the phone survive a redeploy.

## Troubleshooting

- **No `adb devices` entry:** USB storage mode, data cable, or step 1/reboot not
  done. `unauthorized` means the JScalated key is not installed yet.
- **Nothing after the import:** step 3 loader not active. Redo it on the same tab.
- **Import seems cached:** use a numbered alias (`/d2`, `/d3`, …; rollback `/r2`).
- **Port 8088 busy:** `pkill -f tools/serve.py` or use `--port 8089` and update
  the URL. If the Mac firewall prompts, allow Python.
- **No pink bar after reboot:** deploy didn't land; check `[kbdeploy]` and repeat
  steps 3–5. If the keyboard is missing, run `/r` and reboot.
- **Bar is the old bright pink, or a change you made doesn't show:** the phone
  got an older build. Check `make build` ran, then redeploy with a fresh
  `/dN` number and reboot.
- **Check what actually loaded:** after a reboot, open any text field and run
  `adb logcat -d | grep "debounce] boot"`. `index.html is current` is normal.
  `index.html is a stale cached copy` means the phone reused an old cached
  keyboard page; `debounce.js` then loads the new parts itself, so it still
  works. Changes made only in `index.html` won't show until that cache
  clears, so put new behavior in the JS files.
- **Load from URL fails (network/CORS):** `serve.py` isn't running, or the
  tunnel was lost on reboot. Re-run `reverse-all.sh`.
