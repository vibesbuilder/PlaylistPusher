#!/usr/bin/env python3
"""PlaylistPusher - review a track list and import it into a Spotify playlist.

Starts a local web UI at http://127.0.0.1:8138 and opens the browser.
Requires Python 3.9+ only (no third-party packages).

Usage:
  python playlistpusher.py                             open the UI
  python playlistpusher.py tracks.txt                  preload a list
  python playlistpusher.py tracks.txt "Playlist name"  preload list and target playlist, matching starts right away

Options:
  --order auto|artist-title|title-artist   order of artist and title in the list (default: auto)
  --port 8138                              port (must match the redirect URI of your Spotify app)
  --no-browser                             do not open the browser automatically
"""
import argparse
import base64
import http.server
import json
import sys
import threading
import time
import webbrowser
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent / "web"

# Depending on the registry, Windows serves .js as text/plain - ES modules need text/javascript.
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
}


def build_handler(port, preload):
    class Handler(http.server.SimpleHTTPRequestHandler):
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **MIME_TYPES}

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(WEB_DIR), **kwargs)

        def do_GET(self):
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
            if host != "127.0.0.1":
                # Spotify only accepts 127.0.0.1 as a loopback redirect address (not localhost)
                self.send_response(302)
                self.send_header("Location", f"http://127.0.0.1:{port}{self.path}")
                self.end_headers()
                return

            path = self.path.split("?", 1)[0]
            if path == "/api/preload":
                body = json.dumps(preload).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if path == "/callback":
                self.path = "/index.html"
            super().do_GET()

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, format, *args):
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser(description="Review a track list and import it into a Spotify playlist.")
    parser.add_argument("list_file", nargs="?", metavar="LIST", help="file with the track list (txt, csv, tsv, m3u)")
    parser.add_argument("playlist", nargs="?", metavar="PLAYLIST", help="name, link or ID of the target playlist")
    parser.add_argument("--order", choices=["auto", "artist-title", "title-artist"], default="auto", help="order of artist and title in the list (default: auto)")
    parser.add_argument("--port", type=int, default=8138, help="port of the local web UI (default: 8138)")
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser automatically")
    args = parser.parse_args()

    preload = {}
    if args.list_file:
        path = Path(args.list_file).expanduser()
        if not path.is_file():
            sys.exit(f"File not found: {path}")
        preload = {
            "id": str(time.time_ns()),
            "filename": path.name,
            "data": base64.b64encode(path.read_bytes()).decode("ascii"),
            "playlist": args.playlist,
            "order": args.order,
        }

    class Server(http.server.ThreadingHTTPServer):
        # On Windows, SO_REUSEADDR would let a second instance bind the same port - disable it there.
        allow_reuse_address = sys.platform != "win32"

    try:
        server = Server(("127.0.0.1", args.port), build_handler(args.port, preload))
    except OSError:
        sys.exit(
            f"Port {args.port} is already in use - is PlaylistPusher already running in another window? "
            "Close it first, or choose another port with --port "
            "(and add the matching redirect URI to your Spotify app)."
        )

    url = f"http://127.0.0.1:{args.port}/"
    print(f"PlaylistPusher is running: {url}")
    print(f"Redirect URI for your Spotify app: {url}callback")
    if args.list_file:
        print(f"List preloaded: {preload['filename']}" + (f"  ->  playlist: {args.playlist}" if args.playlist else ""))
    print("Press Ctrl+C or close this window to quit.")

    if not args.no_browser:
        threading.Timer(0.6, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
