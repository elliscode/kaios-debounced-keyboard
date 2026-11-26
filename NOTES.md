# How this works (definitive notes)

## The constraint

The System app always launches the keyboard from `http://keyboard.localhost`
(the origin is hard-coded). The preloaded keyboard lives in `/system`, which is
read-only with dm-verity, and the apps service:

- reports the preloaded keyboard as `removable:false`, so the API will not
  uninstall it;
- dedups a same-name install to `keyboard1`, `keyboard2`, … instead of
  replacing it;
- ignores `b2g_features.origin` on this build, so the “install as update” trick
  does not work either.

Root is unavailable for `adb shell` (`su` absent, `adbd cannot run as root`),
and the JScalated `engmodeManager` API is not present on this 3.1 build.

## The lever that works

api-daemon serves every `<app>.localhost` from:

```
/data/local/webapps/vroot/<app>/application.zip
```

For the preloaded keyboard, `vroot/keyboard` is a **symlink into `/system`**.
Replacing that symlink with a real directory containing our `application.zip`
makes `keyboard.localhost` serve our code. `/system` is untouched, the app stays
the preloaded/certified keyboard entry, and rollback is a rename.

Writing `/data/local/webapps` requires the **System process** context, which a
normal page and `adb shell` do not have. JScalated's loader, running on
`system.localhost/proxy.html`, exposes
`navigator.b2g.getDeviceStorage("apps").getRoot()` as that process. That API can
create directories/files and rename entries (including symlinks) under `/data`.

Key details:

- `Directory.remove(name)` on a symlink does `unlink()` on the link only.
- `Directory.renameTo()` uses `rename()`, so it moves the symlink, not its
  `/system` target.
- The deploy is staged and size/PK-verified before the symlink is moved.

## Why the JScalated loader is mandatory

The package writes only work from the page **after** JScalated's loader has run.
A direct visit to `system.localhost/proxy.html` is not equivalent: the deploy
module loads there, but the storage/privileged path does not behave the same.
The reliable sequence is:

```
jscalated.netlify.app → Load JScalated
javascript:document.createElement('script')
javascript:document.write(name)
javascript:import('http://127.0.0.1:8088/d')
```

## Why the deploy is self-contained

The System page's CSP allows module scripts from `127.0.0.1` but blocks
XHR/fetch to it (`connect-src`). A normal deploy script that downloads the zip
therefore fails silently. `build/deploy_selfcontained.js` embeds the signed zip
and manifest as base64 and writes them directly; it reports with `console.log`
(`logcat` tag `[kbdeploy]`). No network access is needed at run time.

## Package signing

KaiOS 3.1 checks the zip's `META-INF` format but does not validate the RSA on
this build. `tools/add_meta_inf.py` generates a real `manifest.mf`/`zigbert.sf`
for our files and patches the `messageDigest` of a reference `zigbert.rsa`
(the same OStore technique). This is a format shim, not a valid new signature.
`tools/ref-zigbert.rsa` is the reference block.

## Configuration

The keyboard app and `config.html` share the `keyboard.localhost` origin, so
`localStorage` is the config channel:

- key: `keyboard.debounce.v1`
- JSON fields: `enabled`, `GAP_HARD`, `GAP_SOFT`, `HOLD_SHORT`,
  `COOLDOWN_T9`, `COOLDOWN_Abc`, `COOLDOWN_abc`, `COOLDOWN_ABC`,
  `COOLDOWN_123`, `SELECT_COOLDOWN`, `showMarker`, `debug`
  (console only). The old single `COOLDOWN` is still read: if it is present
  and none of the per-mode keys are, it is copied into all five, and it is the
  fallback for any other input mode.
- key: `keyboard.predict.v1`: prediction rules, `{ "enabled", "rules" }`
  (see README). Invalid or missing JSON falls back to the built-in defaults.
- the keyboard polls every 1 s and also listens for the `storage` event;
- the config page is served from the keyboard zip, so it needs no extra app.

Fallback in `debounce_config.js`: the settings service
(`keyboard.debounce.*`) while no local config exists. There is no SD-card path;
the keyboard does not read or write the SD card.

## The filter rule

Per key, no cross-key comparison. For the default rule:

- `gap = thisDown - lastKeptUp[key]` (milliseconds)
- `gap < GAP_HARD` → drop
- `GAP_HARD ≤ gap < GAP_SOFT` and `hold < HOLD_SHORT` → drop

The cooldown is a separate, exact same-key rate limit, one value per input
mode (`keypad.inputMode`: T9, Abc, abc, ABC, 123):

- `thisDown - lastKeptDown[key] < COOLDOWN_<mode>` → drop, regardless of hold.

Default is **110 ms** (down-to-down) in every mode; set `0` to disable it.
For “at most one press of a key per second”, set the cooldowns to 1000 and
`GAP_HARD=GAP_SOFT=HOLD_SHORT=0`. For ~5 same-key presses/sec, use
`≈200` (down-to-down, exact).

Select (Enter) gets only `SELECT_COOLDOWN` (default 1000 ms, any mode): a
second Enter keydown within that time of the last kept one is dropped with its
keypress/keyup. No gap rules and no deferral apply to Enter.

Note: a 1 s same-key cooldown makes multi-tap impossible (`666` for `o` needs
2 s). That is inherent to the rule; use a shorter cooldown if multi-tap matters.

## Files the deploy leaves behind (rollback surface)

- `vroot/keyboard.stock` — the original symlink into `/system` (first deploy).
- `vroot/keyboard.previous-<ts>` — previous patched directory (later deploys).
- `vroot/keyboard` — either our directory or the restored symlink.

`deploy/fs_recover.js` (served as `/r`) renames the current one aside and puts
the saved symlink back. Reboot after it.

## Loading rules over the network

Config page → **Load from URL** (`prFetch` in `app/js/config.js`) reads
`https://keyboard.elliscode.com/rules/predict.json` (CloudFront + S3,
`/rules/*` CachingDisabled, SimpleCORS, file stored with
`Cache-Control: no-cache`). Findings from getting this to work on the 2780
(2026-11-25):

1. **`fetch(url, { cache: "no-store" })` failed every time** with
   `NetworkError when attempting to fetch resource.`, while the URL was fine
   from a desktop browser and from `curl` with `Origin: http://keyboard.localhost`.
2. **Switching to XHR alone did not fix it.** XHR failed with a bare
   network error (status 0) about half the time.
3. **The failures followed rule changes, not time.** Load → edit in
   `admin.html` → Load within 30 s failed. Loading again with no change
   worked. It was not idle connections, not USB, and not the server: a save is
   one atomic `PutObject`, nothing is cached at CloudFront, and every response
   checked from the Mac was correct.
4. **Cause: the phone's HTTP cache.** Because of `no-cache`, Gecko keeps a copy
   and revalidates (`If-None-Match`). Unchanged file → CloudFront `304`
   (no body, no ACAO header; Gecko reuses the cached entry) → works. Changed
   file → full `200` → fails on the phone. That also explains (1): `no-store`
   always takes the full-`200` path. Exactly why Gecko 84 rejects that `200`
   wasn't determined; its CORS errors don't reach logcat.
5. **Fix:** XHR with a unique `?_=<timestamp>` (the cache is never involved;
   S3 ignores the parameter), no request headers (no preflight; CloudFront
   answers `OPTIONS` on `/rules/*` with 403), and up to 3 tries on network
   errors. Verified on d31: save at 17:35:44, Load at 17:36:00, first try.

Ruled out along the way: IPv6 (the phone is on IPv6-only mobile data, but
foursure is dual-stack too and works), CSP or permissions on the core keyboard
app (it reaches the internet), TLS (same setup as foursure).

Related: `kaios-calorie-counter/notes/kaios-fetch-vs-xhr-cors-mystery.md`
(fetch vs XHR on KaiOS 3.1). Foursure (`foursure/frontend/js/puzzle.js`) also
uses XHR and keeps every file it loads in IndexedDB, which would hide the same
failures.

## Not covered

- End-call / power key (never reaches the keyboard).
- Missed presses (debounce cannot fix those).
- T9 ranking in general: the TouchPal engine is untouched. Only digit
  sequences with a user rule are reordered (`app/js/predict_*.js`), after
  TouchPal produces its list.
