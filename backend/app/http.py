"""Plain requests to other hosts (sign-in keys and tokens, cover images)."""

import json
import urllib.error
import urllib.parse
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


def post_form(url: str, data: dict[str, str], timeout: float = 20) -> dict:
    """POST a form and read the JSON answer. An error answer raises ValueError with the provider's message."""
    body = urllib.parse.urlencode(data).encode()
    request = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT, "Accept": "application/json",
                                                              "Content-Type": "application/x-www-form-urlencoded"})  # fmt: skip
    try:
        with urllib.request.urlopen(request, timeout=timeout) as r:
            text = r.read(1 << 20)
    except urllib.error.HTTPError as e:
        raise ValueError(f"{url}: {e.code} {e.read(2000).decode(errors='replace')}") from e
    return json.loads(text) if text.strip() else {}
