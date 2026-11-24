#!/usr/bin/env python3
"""serve.py — one-file dev server for the keyboard deploy.

Serves:
  /d   the self-contained deploy module (zip embedded, cache-busted by path)
  /r   the rollback script (restores the stock keyboard symlink)
  /    anything else from this repo (handy for reading files)

Run on the Mac:
    python3 tools/serve.py                 # 127.0.0.1:8088 + adb reverse
    python3 tools/serve.py --bind 0.0.0.0  # LAN access instead
"""
import argparse
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ALIASES = {
    "/d": "build/deploy_selfcontained.js",
    "/r": "deploy/fs_recover.js",
}
# Optional unique aliases: /d2, /r2, ... (avoid any cached module URL).
NUMBERED = {"/d": "build/deploy_selfcontained.js", "/r": "deploy/fs_recover.js"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        target = ALIASES.get(path)
        if not target:
            m = re.match(r"^/([dr])\d+$", path)
            if m:
                target = NUMBERED["/" + m.group(1)]
        if target:
            try:
                with open(os.path.join(ROOT, target), "rb") as f:
                    data = f.read()
            except OSError:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            print(f"{path} -> {target}", flush=True)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        import datetime
        print(datetime.datetime.now().strftime("%H:%M:%S"), fmt % args, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8088)
    ap.add_argument("--bind", default="127.0.0.1")
    args = ap.parse_args()
    httpd = ThreadingHTTPServer((args.bind, args.port), Handler)
    host = args.bind if args.bind != "0.0.0.0" else "<your-LAN-IP>"
    print(f"serving {ROOT}", flush=True)
    print(f"deploy:   javascript:import('http://{host}:{args.port}/d')", flush=True)
    print(f"rollback: javascript:import('http://{host}:{args.port}/r')", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
