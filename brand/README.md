# Icon

Option M from the design canvas ("Icon options"): an open ring around a dot, like an ear turned towards one sound. (Option A, the missed-word box, was tried first but blurred in a browser tab.) White on near-black (#0b0b0d).

- `icon-desktop.svg`: Mac and Windows, with the margin macOS icons have. `desktop/src-tauri/icons/` is made from it with `npx tauri icon` (from a 1024 px PNG of it).
- `icon-ios.svg`: the iPhone app, a full square (iOS rounds the corners). Rendered to `ios/Eksigo/Assets.xcassets/AppIcon.appiconset/icon.png`, 1024 px.
- `favicon.svg`: the website's tab icon, with a heavier ring and dot so it stays crisp at 16 px. Copied to `web/public/`, with `apple-touch-icon.png` (180 px) and `favicon-32.png`.
- `mark.svg`: the mark alone, in the text colour.
