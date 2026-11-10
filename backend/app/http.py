"""Plain GETs to other hosts (sign-in keys, cover images)."""

import urllib.request

USER_AGENT = "Eksigo/2.0"


def open_url(url: str, timeout: float = 30, opener: urllib.request.OpenerDirector | None = None):
    """GET with the standard library. (Some podcast CDNs reject httpx's TLS fingerprint from Linux servers, while
    urllib gets through.)"""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return (opener or urllib.request.build_opener()).open(request, timeout=timeout)


def fetch_bytes(url: str, max_bytes: int = 1 << 20) -> bytes:
    with open_url(url) as r:
        data = r.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError(f"{url} is larger than {max_bytes} bytes")
    return data
