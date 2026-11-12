# Offline dictionaries

Each file is a raw-deflate-compressed SQLite database of English words with meanings in one language. Most were built in v1 and copied here unchanged; `zh-1` is built by `scripts/build_zh_dictionary.py` from ECDICT's `ecdict.csv` and also has phrases ("follow through", "put sb off") and an English `definition` column.

| File | Meanings in | Source | License |
|---|---|---|---|
| `zh-1.sqlite.deflate` | Chinese (and English definitions) | [ECDICT](https://github.com/skywind3000/ECDICT): 49,562 common words, 58,372 phrases, 37,794 word forms | MIT |
| `en-1.sqlite.deflate` | English | [ECDICT](https://github.com/skywind3000/ECDICT) | MIT |
| `ja-1.sqlite.deflate` | Japanese | [EJDict](https://github.com/kujirahand/EJDict) | Public domain |
| `es-1.sqlite.deflate` | Spanish | [Wiktionary](https://www.wiktionary.org/) | CC BY-SA |
| `fr-1.sqlite.deflate` | French | Wiktionary | CC BY-SA |
| `ko-1.sqlite.deflate` | Korean | Wiktionary | CC BY-SA |

**Wiktionary data:**
- **Share-alike:** the data is licensed CC BY-SA, so the Spanish, French and Korean files may only be shared under the same license, with credit to Wiktionary's contributors.
- **Attribution:** the apps must show that credit wherever these meanings appear.

The licenses in this table still need checking against each source before the repository goes public (DESIGN.md section 14).
