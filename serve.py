#!/usr/bin/env python3
"""
AgenCFO local dev server.
Reads .env, injects API credentials into dashboard.html, serves on http://localhost:8080
"""

import http.server
import os
import re

PORT = 8080

def load_env(path=".env.local"):
    env = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                key, _, val = line.partition("=")
                env[key.strip()] = val.strip()
    except FileNotFoundError:
        print(f"⚠  No .env file found at {path}")
    return env

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {self.path}  {args[1]}")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/dashboard.html"):
            self.serve_dashboard()
        else:
            self.send_error(404)

    def serve_dashboard(self):
        env = load_env()
        api_key  = env.get("GOOGLE_SHEETS_API_KEY", "")
        sheet_id = env.get("GOOGLE_SHEET_ID", "")

        with open("dashboard.html", "rb") as f:
            html = f.read().decode("utf-8")

        inject = f"""<script>
window.__ENV__ = {{
  apiKey:  "{api_key}",
  sheetId: "{sheet_id}"
}};
</script>"""

        html = html.replace("</head>", inject + "\n</head>", 1)
        body = html.encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"\n  AgenCFO dev server → http://localhost:{PORT}\n")
    httpd = http.server.HTTPServer(("", PORT), Handler)
    httpd.serve_forever()
