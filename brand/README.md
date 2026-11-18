# Icon

Option A from the design canvas ("Icon options"): a line of text, then a short word and the dashed box the apps use for a missed word. White on near-black (#0b0b0d).

- `icon-desktop.svg`: Mac and Windows, with the margin macOS icons have. `desktop/src-tauri/icons/` is made from it with `npx tauri icon` (from a 1024 px PNG of it).
- `icon-ios.svg`: the iPhone app, a full square (iOS rounds the corners). Rendered to `ios/Eksigo/Assets.xcassets/AppIcon.appiconset/icon.png`, 1024 px.
- `favicon.svg`: the website's tab icon, with fewer, bolder dashes so they show at 16 px. Copied to `web/public/`, with `apple-touch-icon.png` (180 px) and `favicon-32.png`.
- `mark.svg`: the mark alone, in the text colour.
