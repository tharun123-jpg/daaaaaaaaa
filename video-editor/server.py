#!/usr/bin/env python3
"""
ClipForge - Online Video Editor
-------------------------------
Zero-dependency web server (Python standard library only).

  - serves the marketing site  (web/index.html)
  - serves the editor app      (web/editor.html)
  - stores projects as JSON    (data/projects/<id>.json)
  - stores uploaded media      (data/uploads/<id>/<file>)  with HTTP Range support

Run:
    python3 server.py            # http://localhost:8000
    PORT=9000 python3 server.py  # custom port
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import threading
import time
import uuid
from email.utils import formatdate
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
DATA_DIR = ROOT / "data"
PROJECTS_DIR = DATA_DIR / "projects"
UPLOADS_DIR = DATA_DIR / "uploads"

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))

MAX_UPLOAD_BYTES = 1024 * 1024 * 1024  # 1 GB per file
MAX_JSON_BYTES = 32 * 1024 * 1024       # 32 MB per project

SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_write_lock = threading.Lock()

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/opus",
    ".flac": "audio/flac",
}

KIND_BY_EXT = {
    "video": {".mp4", ".m4v", ".webm", ".mov", ".mkv", ".ogv"},
    "audio": {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".oga", ".opus", ".flac"},
    "image": {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"},
}


def guess_mime(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in MIME:
        return MIME[ext]
    return mimetypes.guess_type(str(path))[0] or "application/octet-stream"


def media_kind(name: str) -> str:
    ext = Path(name).suffix.lower()
    for kind, exts in KIND_BY_EXT.items():
        if ext in exts:
            return kind
    return "file"


def human_size(num: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if num < 1024 or unit == "GB":
            return f"{num:.0f} {unit}" if unit == "B" else f"{num:.1f} {unit}"
        num /= 1024
    return f"{num:.1f} GB"


def ensure_dirs() -> None:
    for d in (PROJECTS_DIR, UPLOADS_DIR):
        d.mkdir(parents=True, exist_ok=True)


def safe_join(base: Path, *parts: str) -> Path | None:
    """Join path parts onto base, refusing any escape outside base."""
    target = base.joinpath(*parts).resolve()
    try:
        target.relative_to(base.resolve())
    except ValueError:
        return None
    return target


# --------------------------------------------------------------------------- #
# Project helpers
# --------------------------------------------------------------------------- #

def project_path(pid: str) -> Path | None:
    if not SAFE_ID.match(pid):
        return None
    return PROJECTS_DIR / f"{pid}.json"


def list_projects() -> list[dict]:
    ensure_dirs()
    out: list[dict] = []
    for f in sorted(PROJECTS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        project = doc.get("project") or {}
        settings = project.get("settings") or {}
        media = doc.get("media") or []
        tracks = project.get("tracks") or []
        clips = sum(len(t.get("clips") or []) for t in tracks)
        duration = 0.0
        for t in tracks:
            for c in t.get("clips") or []:
                duration = max(duration, float(c.get("start", 0)) + float(c.get("duration", 0)))
        out.append(
            {
                "id": doc.get("id", f.stem),
                "name": doc.get("name") or "Untitled project",
                "updatedAt": doc.get("updatedAt") or int(f.stat().st_mtime * 1000),
                "clips": clips,
                "media": len(media),
                "duration": round(duration, 3),
                "width": settings.get("width", 1280),
                "height": settings.get("height", 720),
                "poster": doc.get("poster"),
            }
        )
    return out


# --------------------------------------------------------------------------- #
# Request handler
# --------------------------------------------------------------------------- #

class Handler(BaseHTTPRequestHandler):
    server_version = "ClipForge/1.0"
    protocol_version = "HTTP/1.1"

    # ---------------- low level helpers ---------------- #

    def log_message(self, fmt: str, *args) -> None:  # keep console tidy
        if os.environ.get("QUIET"):
            return
        print(f"[{time.strftime('%H:%M:%S')}] {self.address_string()} {fmt % args}", flush=True)

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None,
              head_only: bool = False) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Accept-Ranges", "bytes")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if not head_only and body:
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _json(self, code: int, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8")

    def _error(self, code: int, message: str) -> None:
        self._json(code, {"ok": False, "error": message})

    def _read_body(self, limit: int) -> bytes | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length <= 0 or length > limit:
            return None
        buf = bytearray()
        while len(buf) < length:
            chunk = self.rfile.read(min(1 << 20, length - len(buf)))
            if not chunk:
                break
            buf.extend(chunk)
        return bytes(buf)

    # ---------------- static files ---------------- #

    def _serve_file(self, path: Path, head_only: bool = False) -> None:
        if not path.is_file():
            self._error(404, "Not found")
            return
        size = path.stat().st_size
        ctype = guess_mime(path)
        range_header = self.headers.get("Range")

        # Range support (needed for seeking inside <video>)
        if range_header and range_header.startswith("bytes="):
            try:
                spec = range_header.split("=", 1)[1].split(",")[0].strip()
                start_s, _, end_s = spec.partition("-")
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else size - 1
                end = min(end, size - 1)
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                length = end - start + 1
                self.send_response(206)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.send_header("Content-Length", str(length))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                if not head_only:
                    with path.open("rb") as fh:
                        fh.seek(start)
                        remaining = length
                        while remaining > 0:
                            chunk = fh.read(min(1 << 20, remaining))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                return
            except (ValueError, OSError):
                pass  # fall through to a normal 200 response

        with path.open("rb") as fh:
            body = fh.read() if size <= 24 * 1024 * 1024 else b""
        if not body and size > 0:
            # large file: stream it
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(size))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if not head_only:
                with path.open("rb") as fh:
                    shutil.copyfileobj(fh, self.wfile)
            return
        self._send(200, body, ctype, head_only=head_only)

    # ---------------- HTTP verbs ---------------- #

    def do_HEAD(self) -> None:
        self.do_GET(head_only=True)

    def do_GET(self, head_only: bool = False) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        route = unquote(parsed.path)
        qs = parsed.query

        if route in ("/", "/index.html"):
            return self._serve_file(WEB_DIR / "index.html", head_only)
        if route in ("/editor", "/editor/", "/app"):
            return self._serve_file(WEB_DIR / "editor.html", head_only)
        if route in ("/projects", "/projects/"):
            return self._serve_file(WEB_DIR / "projects.html", head_only)

        if route == "/api/health":
            return self._json(200, {"ok": True, "service": "clipforge", "time": int(time.time() * 1000)})

        if route == "/api/projects":
            projects = list_projects()
            if "limit" in qs:
                try:
                    projects = projects[: max(1, int(qs.split("limit=")[1].split("&")[0]))]
                except (ValueError, IndexError):
                    pass
            return self._json(200, {"ok": True, "projects": projects})

        m = re.match(r"^/api/projects/([^/]+)$", route)
        if m:
            path = project_path(m.group(1))
            if path is None:
                return self._error(400, "Bad project id")
            if not path.is_file():
                return self._error(404, "Project not found")
            try:
                doc = json.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:  # pragma: no cover
                return self._error(500, f"Corrupt project file: {exc}")
            doc["media"] = [self._public_media(m.group(1), f) for f in self._media_files(m.group(1))]
            return self._json(200, {"ok": True, **doc})

        m = re.match(r"^/media/([^/]+)/(.+)$", route)
        if m:
            target = safe_join(UPLOADS_DIR, m.group(1), m.group(2))
            if target is None:
                return self._error(400, "Bad path")
            return self._serve_file(target, head_only)

        # static assets under web/
        rel = route.lstrip("/")
        target = safe_join(WEB_DIR, rel) if rel else None
        if target is not None and target.is_file():
            return self._serve_file(target, head_only)
        return self._error(404, "Not found")

    def do_POST(self) -> None:  # noqa: N802
        route = unquote(urlparse(self.path).path)

        if route == "/api/projects":
            raw = self._read_body(MAX_JSON_BYTES)
            if raw is None:
                return self._error(413, "Body too large or empty")
            try:
                payload = json.loads(raw.decode("utf-8"))
            except Exception:
                return self._error(400, "Invalid JSON")
            project = payload.get("project")
            if not isinstance(project, dict):
                return self._error(400, "Missing 'project' object")
            pid = str(payload.get("id") or project.get("id") or "").strip()
            if not SAFE_ID.match(pid):
                pid = f"p{uuid.uuid4().hex[:12]}"
            project["id"] = pid
            ensure_dirs()
            doc = {
                "id": pid,
                "name": payload.get("name") or project.get("name") or "Untitled project",
                "updatedAt": int(time.time() * 1000),
                "poster": payload.get("poster"),
                "project": project,
                "media": payload.get("media") or [],
            }
            with _write_lock:
                (PROJECTS_DIR / f"{pid}.json").write_text(
                    json.dumps(doc, ensure_ascii=False), encoding="utf-8"
                )
            return self._json(200, {"ok": True, "id": pid, "updatedAt": doc["updatedAt"]})

        return self._error(404, "Not found")

    def do_PUT(self) -> None:  # noqa: N802
        route = unquote(urlparse(self.path).path)
        m = re.match(r"^/api/media/([^/]+)/(.+)$", route)
        if m:
            pid, filename = m.group(1), Path(m.group(2)).name
            folder = safe_join(UPLOADS_DIR, pid)
            if folder is None or not filename:
                return self._error(400, "Bad path")
            raw = self._read_body(MAX_UPLOAD_BYTES)
            if raw is None:
                return self._error(413, "Upload too large or empty body")
            folder.mkdir(parents=True, exist_ok=True)
            (folder / filename).write_bytes(raw)
            return self._json(
                200,
                {"ok": True, "url": f"/media/{pid}/{filename}", "size": len(raw), "name": filename},
            )
        return self._error(404, "Not found")

    def do_DELETE(self) -> None:  # noqa: N802
        route = unquote(urlparse(self.path).path)
        m = re.match(r"^/api/projects/([^/]+)$", route)
        if m:
            path = project_path(m.group(1))
            if path is None:
                return self._error(400, "Bad project id")
            with _write_lock:
                if path.is_file():
                    path.unlink()
                folder = safe_join(UPLOADS_DIR, m.group(1))
                if folder and folder.is_dir():
                    shutil.rmtree(folder, ignore_errors=True)
            return self._json(200, {"ok": True})
        m = re.match(r"^/api/media/([^/]+)/(.+)$", route)
        if m:
            target = safe_join(UPLOADS_DIR, m.group(1), Path(m.group(2)).name)
            if target is None:
                return self._error(400, "Bad path")
            if target.is_file():
                target.unlink()
            return self._json(200, {"ok": True})
        return self._error(404, "Not found")

    def _media_files(self, pid: str) -> list[Path]:
        folder = safe_join(UPLOADS_DIR, pid)
        if folder is None or not folder.is_dir():
            return []
        return sorted((p for p in folder.iterdir() if p.is_file()), key=lambda p: p.name)

    def _public_media(self, pid: str, path: Path) -> dict:
        return {
            "name": path.name,
            "url": f"/media/{pid}/{path.name}",
            "size": path.stat().st_size,
            "sizeLabel": human_size(path.stat().st_size),
            "kind": media_kind(path.name),
            "mtime": int(path.stat().st_mtime * 1000),
            "lastModified": formatdate(path.stat().st_mtime, usegmt=True),
        }


def main() -> None:
    ensure_dirs()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    httpd.daemon_threads = True
    print("┌──────────────────────────────────────────────┐")
    print("│  ClipForge — Online Video Editor             │")
    print("└──────────────────────────────────────────────┘")
    print(f"  Site   : http://localhost:{PORT}/")
    print(f"  Editor : http://localhost:{PORT}/editor")
    print(f"  Data   : {DATA_DIR}")
    print("  Ctrl+C to stop\n", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down…")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
