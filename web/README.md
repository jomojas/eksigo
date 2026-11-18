# Website

eksigo.com: the home page (a short film of the desktop app, how it works, the two modes, questions, downloads) and the privacy policy, terms of use and support pages. React and Vite; English by default, the page text in six languages, the legal pages in English and Chinese.

- `npm run dev` previews it.
- `npm run build` writes the static pages to `../site`, which the deploy job (`.github/workflows/backend.yml`) builds and copies to the VPS. `site/` is build output and not committed.
- The download buttons point at `releases/latest/download/Eksigo-mac.dmg` and `Eksigo-windows.exe`; the release workflow uploads the installers under those names.
- The privacy policy follows docs/DESIGN.md, "Privacy policy facts": change both together.
