# App Store screenshots

`screenshots/en-1…4.jpg` and `screenshots/zh-1…4.jpg` are the images for the English and Simplified Chinese listings, at 1320 × 2868 (6.9-inch iPhone). They are JPEGs because App Store Connect turns down screenshots with an alpha channel.

To make them again:

1. Build the Debug app for an iPhone Pro Max simulator and give it a clean status bar:
   `xcrun simctl status_bar booted override --time 9:41 --dataNetwork wifi --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState discharging --batteryLevel 100`
2. Launch it with the sample words and missed sentences: `xcrun simctl launch booted com.eksigo.app -sample YES -tab review`. Add `-AppleLanguages "(zh-Hans)"` for the Chinese set.
3. Take the four screens with `xcrun simctl io booted screenshot screenshots/<lang>-<name>-raw.png`, where `<name>` is `missed` (Review → Read), `review` (the Review tab), `word` (Start review → Show the answer) and `player` (an episode of a show for learners, full-screen player).
4. From the repository root: `swift ios/AppStore/frame.swift`. The captions are in that file.

The `*-raw.png` files are not committed.
