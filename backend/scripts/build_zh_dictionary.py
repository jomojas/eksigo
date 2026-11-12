"""Builds app/dictionaries/zh-<version>.sqlite.deflate, English words and phrases with Chinese meanings, from
ECDICT (https://github.com/skywind3000/ECDICT, MIT). Run with the path of ECDICT's ecdict.csv:

    python scripts/build_zh_dictionary.py path/to/ecdict.csv

The file has the same tables as the other dictionaries, plus an English `definition`:
    words(word, ipa, meaning, definition)  -- meaning: Chinese, one sense per line
    forms(form, word)                       -- "followed" -> "follow", from ECDICT's exchange field
Phrases keep ECDICT's sb / sth ("put sb off"). Raw deflate, like the others."""

import csv
import hashlib
import json
import re
import sqlite3
import sys
import tempfile
import zlib
from pathlib import Path

VERSION = 1
OUT = Path(__file__).resolve().parent.parent / "app" / "dictionaries"
WORD = re.compile(r"^[a-z][a-z'\-]*$")
PHRASE = re.compile(r"^[a-z][a-z' \-]*[a-z]$")
# Subject labels: a sense only in a specialist field ("[医]", "[化]") is left out of everyday meanings.
FIELD = re.compile(r"^\[(?!网络|口|俚|美|英|古|诗|方|废)[^\]]{1,3}\]")


def clean(text: str, keep: int) -> str:
    lines = [ln.strip() for ln in text.replace("\\n", "\n").split("\n") if ln.strip()]
    general = [ln for ln in lines if not FIELD.match(ln)]
    lines = general or lines
    # "[网络]" (meanings gathered from the web) only when there's nothing else.
    plain = [ln for ln in lines if not ln.startswith("[网络]")]
    return "\n".join((plain or lines)[:keep])


def main(src: str) -> None:
    csv.field_size_limit(10**9)
    words: dict[str, tuple[str, str, str]] = {}
    forms: dict[str, str] = {}
    for r in csv.DictReader(open(src, encoding="utf-8")):
        w = r["word"].strip()
        if w != w.lower():
            continue  # names and abbreviations
        tr = r["translation"].strip()
        if not tr:
            continue
        common = r["frq"] not in ("", "0") or r["bnc"] not in ("", "0") or r["tag"] or r["collins"] not in ("", "0") or r["oxford"] == "1"
        if " " in w:
            if not PHRASE.match(w) or len(w.split()) > 6 or tr.startswith("[网络]") or FIELD.match(tr):
                continue
        elif not WORD.match(w) or not common:
            continue  # rare single words (about 400,000, mostly technical) are left out
        meaning = clean(tr, 4)
        if not meaning:
            continue
        ipa = r["phonetic"].strip()
        words[w] = (f"/{ipa}/" if ipa else "", meaning, clean(r["definition"], 2))
        for part in r["exchange"].split("/"):
            kind, _, form = part.partition(":")
            if kind in ("p", "d", "i", "3", "r", "t", "s") and form and form != w and WORD.match(form):
                forms.setdefault(form, w)

    forms = {f: w for f, w in forms.items() if w in words}
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "zh.sqlite"
        conn = sqlite3.connect(db)
        conn.executescript(
            "CREATE TABLE words (word TEXT PRIMARY KEY, ipa TEXT NOT NULL, meaning TEXT NOT NULL, definition TEXT NOT NULL) WITHOUT ROWID;"
            "CREATE TABLE forms (form TEXT PRIMARY KEY, word TEXT NOT NULL) WITHOUT ROWID;"
        )
        conn.executemany("INSERT INTO words VALUES (?, ?, ?, ?)", ((w, *v) for w, v in sorted(words.items())))
        conn.executemany("INSERT INTO forms VALUES (?, ?)", sorted(forms.items()))
        conn.commit()
        conn.execute("VACUUM")
        conn.close()
        raw = db.read_bytes()
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    data = c.compress(raw) + c.flush()
    name = f"zh-{VERSION}.sqlite.deflate"
    (OUT / name).write_bytes(data)

    index_path = OUT / "index.json"
    index = [e for e in json.loads(index_path.read_text()) if e["lang"] != "zh"]
    index.append({"lang": "zh", "version": VERSION, "bytes": len(data), "file": name, "sha256": hashlib.sha256(data).hexdigest(), "source": "ECDICT"})
    index_path.write_text(json.dumps(sorted(index, key=lambda e: e["lang"]), indent=2) + "\n")
    phrases = sum(" " in w for w in words)
    print(f"{name}: {len(words) - phrases} words, {phrases} phrases, {len(forms)} forms; {len(raw) / 1e6:.1f} MB, {len(data) / 1e6:.1f} MB compressed")


if __name__ == "__main__":
    main(sys.argv[1])
