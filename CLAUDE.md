# Working on this repo

KaiOS 3.1 (Gecko 84) keyboard replacement for the Nokia 2780. How it works:
[NOTES.md](NOTES.md). Phone setup and deploy steps: [SETUP.md](SETUP.md).
Settings and prediction rules: [README.md](README.md).

## Build and deploy

- `make test` runs `tools/test_predict.mjs`. `make build` is the only correct
  build. The phone deploys `build/deploy_selfcontained.js` (via `/dN`), which
  embeds its own copy of the zip. `tools/build_deploy.sh` alone rebuilds only
  `build/deploy/application.zip` and leaves the deploy file stale.
- A deploy needs, in order: `serve.py` running on the Mac, `adb reverse
  tcp:8088 tcp:8088` (`tools/reverse-all.sh`), the JScalated loader on the
  System page, then `javascript:import('http://127.0.0.1:8088/dN')` with a
  number not used before.
- **Unplugging the phone or rebooting it drops `adb reverse`.** If
  `adb reverse --list` is empty, `/dN` silently does nothing and no
  `[kbdeploy]` line appears. Run `tools/reverse-all.sh` again first.
- `DEPLOY OK` only means the zip is on disk. The new code runs **after a
  reboot**. Until then `keyboard.localhost` keeps serving the old files.
- Prefer putting new behavior in JS files, not `index.html` (the phone can keep
  a stale cached `index.html`).

## Checking what's on the phone

Export the key first: `export ADB_VENDOR_KEYS=~/.config/kaios/adbkey`.

- **Check `adb devices` before any `adb shell` / `adb logcat`.** With no
  device they hang instead of failing. macOS has no `timeout` command.
- **Did the deploy land?** `adb logcat -d | grep kbdeploy` and compare
  `payload zip=<bytes>` with `ls -l build/deploy/application.zip`. Same size =
  current build.
- **The log is tiny.** The main logcat buffer is 64 KiB, and the debounce debug
  log (`[debounce] deliver keydown …`) fills it in a minute or two. For anything
  you'll check later, stream it to a file in the background:
  `adb logcat -v time > <scratch>/phone.log`. The stream dies on reboot or
  unplug: loop it with `adb wait-for-device`. Turning off **Debug console log**
  on the config page also helps.
- **Did the phone reboot?** `adb shell cat /proc/uptime` (seconds since boot).
- **What code is the phone actually serving?** api-daemon listens on the
  phone's port 80. `adb forward tcp:18080 tcp:80`, then
  `curl -H "Host: keyboard.localhost" http://127.0.0.1:18080/js/config.js`.
  The response is **compressed** (`gunzip -c`). `adb forward --remove tcp:18080`
  afterwards. `/data/local/webapps/...` itself isn't readable over adb shell.
- Useful log lines: `NetdEventListener: onDnsEvent … <host>` shows each DNS
  lookup by the phone (a rough marker that a request was made).
  `DataControlService: Check origin: http://keyboard.localhost` appears for
  network activity from the keyboard origin.
- **Gecko's CORS/console errors don't reach logcat.** A failed XHR shows up only
  as `onerror` (status 0) in the page. Put diagnostics in the on-screen error
  message, not the log.

## Network requests from the keyboard / config page

All in `app/js/config.js` (`xhrGetText`, `xhrGetTextRetry`, `prFetch`). See
NOTES.md → "Loading rules over the network" for the evidence.

- Use **XHR, not `fetch()`**. Send **no request headers** (keeps it a simple
  GET; CloudFront's `/rules/*` answers `OPTIONS` with 403).
- **Add a unique query string** (`?_=Date.now()`) so the phone's HTTP cache is
  never used. With a cached copy, the first Load after the rules change fails
  every time.
- **Retry network errors** (3 tries, 1.5 s apart); don't retry HTTP errors.
- An error response without `Access-Control-Allow-Origin` also surfaces as a
  bare network error, so "network or CORS" can't be told apart in the page.
- The planned auto-sync (in `predict_config.js`) must do all of the above and
  keep the last good rules when a load fails.

## Server side (`../kaios-debounced-keyboard-server`)

- Rules live at `https://keyboard.elliscode.com/rules/predict.json` (edited at
  `https://keyboard.elliscode.com/admin.html`). CloudFront distribution
  `E2MNH6G39DSLIK`, `/rules/*` uses CachingDisabled + SimpleCORS. Saves are a
  single conditional `PutObject` on a versioned bucket.
- SimpleCORS adds `access-control-allow-origin: *` only when the request has an
  `Origin` header, and not on `304` responses. Test with
  `curl -i -H "Origin: http://keyboard.localhost" <url>`.
- The distribution is dual-stack (IPv6 on), like foursure. The owner wants IPv6
  kept on. The phone is on IPv6-only mobile data (Mint, 464XLAT); that turned
  out not to be the cause of the Load failures.
