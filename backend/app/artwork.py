"""Cover art through our server: some image hosts (VOA's, CNN's) can't be reached from mainland China, while
api.eksigo.com can. Each image is fetched once, scaled down to at most 600 px wide with ffmpeg, kept on disk by a
hash of its URL and served from there. No account needed: listening needs none."""

import hashlib
import ipaddress
import socket
import subprocess
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

from app.http import open_url

MAX_BYTES = 8 * 1024 * 1024
WIDTH = 600


class ArtworkError(Exception):
    pass


def _public(host: str) -> bool:
    """Every address the host resolves to is a public one (no fetching from the server's own network)."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    return bool(infos) and all(ipaddress.ip_address(i[4][0].split("%")[0]).is_global for i in infos)


def check_url(url: str) -> None:
    u = urllib.parse.urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname or not _public(u.hostname):
        raise ArtworkError("not a public image URL")


class _CheckedRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(_CheckedRedirects)


def _fetch(url: str) -> bytes:
    check_url(url)
    try:
        with open_url(url, timeout=20, opener=_opener) as r:
            if not r.headers.get_content_type().startswith("image/"):
                raise ArtworkError("not an image")
            data = r.read(MAX_BYTES + 1)
    except OSError as e:
        raise ArtworkError(f"fetch failed: {e}") from e
    if len(data) > MAX_BYTES:
        raise ArtworkError("image too large")
    return data


def path_for(url: str, directory: Path) -> Path:
    """The cached, scaled copy of the image at `url`, made on first use."""
    out = directory / f"{hashlib.sha1(url.encode()).hexdigest()}.jpg"
    if out.exists():
        return out
    data = _fetch(url)
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=directory) as tmp:
        src, dst = Path(tmp) / "in", Path(tmp) / "out.jpg"
        src.write_bytes(data)
        result = subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-frames:v", "1",
             "-vf", f"scale='min({WIDTH},iw)':-2", "-q:v", "4", str(dst)],
            capture_output=True, timeout=30,
        )  # fmt: skip
        if result.returncode != 0 or not dst.exists():
            raise ArtworkError("not a readable image")
        dst.replace(out)  # atomic, so a parallel request never sees half a file
    return out
