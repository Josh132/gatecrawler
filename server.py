#!/usr/bin/env python3
"""Tiny static file server for Gate Crawler."""
import http.server
import os
import socketserver
import sys

PORT = int(os.environ.get("GATECRAWLER_PORT", "8777"))
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
            print(f"Gate Crawler serving on http://127.0.0.1:{PORT}")
            httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    except OSError as exc:
        print(f"server error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
