"""Offline word dictionaries the apps download for the learner's language: the free "basic word meanings" of
DESIGN.md section 5. Built in v1 (english-audio-breakdown, ios/scripts/build-dictionary.py) and kept in
app/dictionaries, so they reach the server inside the image. Sources and licenses: app/dictionaries/README.md."""

import json
from pathlib import Path
from typing import Any

DIR = Path(__file__).resolve().parent / "dictionaries"


def entries(folder: Path | None = None) -> list[dict[str, Any]]:
    index = (folder or DIR) / "index.json"
    return json.loads(index.read_text()) if index.exists() else []


def public(base_url: str, folder: Path | None = None) -> dict[str, Any]:
    """`GET /v1/dictionaries`."""
    folder = folder or DIR
    return {"dictionaries": [{"lang": e["lang"], "version": e["version"], "bytes": e["bytes"], "sha256": e["sha256"],
                              "source": e["source"], "url": f"{base_url}/dictionaries/{e['file']}"}
                             for e in entries(folder) if (folder / e["file"]).exists()]}  # fmt: skip
