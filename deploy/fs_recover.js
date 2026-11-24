/**
 * fs_recover.js — restore the stock keyboard symlink.
 *
 * Run on the privileged System page after JScalated's loader:
 *   javascript:import('http://127.0.0.1:8088/r')
 *
 * It renames the current keyboard directory aside and puts keyboard.stock (or
 * the newest keyboard.previous-*) back as vroot/keyboard. Reboot afterwards.
 */

const STAMP = Date.now();

function rep(msg) {
  try { console.log("[kbrecover] " + msg); } catch (e) {}
}

const isDir = (e) => !!e && typeof e.getFilesAndDirectories === "function";

async function entryOrNull(dir, name) {
  try { return await dir.get(name); } catch (e) { return null; }
}

async function main() {
  rep("start href=" + location.href);
  const root = await navigator.b2g.getDeviceStorage("apps").getRoot();
  const vroot = await root.get("local/webapps/vroot");
  if (!isDir(vroot)) throw new Error("vroot is not a directory");

  let backupName = "keyboard.stock";
  if (!(await entryOrNull(vroot, backupName))) {
    const entries = await vroot.getFilesAndDirectories();
    const prev = entries
      .map((e) => e.name)
      .filter((n) => /^keyboard\.previous-\d+$/.test(n))
      .sort()
      .pop();
    if (!prev) { rep("no keyboard.stock or keyboard.previous-* backup found"); return; }
    backupName = prev;
    rep("using " + backupName);
  }

  const current = await entryOrNull(vroot, "keyboard");
  if (current) {
    const aside = "keyboard.ours-" + STAMP;
    const ok = await vroot.renameTo("keyboard", aside);
    rep("moved current keyboard to " + aside + " -> " + ok);
    if (!ok) throw new Error("could not move current keyboard aside");
  }

  const ok = await vroot.renameTo(backupName, "keyboard");
  rep("restored " + backupName + " -> keyboard: " + ok);
  if (!ok) throw new Error("restore failed");
  rep("RECOVER OK — reboot the phone");
}

main().catch((e) => rep("RECOVER FAILED: " + (e && (e.name + ": " + e.message || e))));
