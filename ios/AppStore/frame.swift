// Makes the App Store screenshots: a caption above each simulator screenshot, at 1320 × 2868 (6.9-inch iPhone).
// Run from the repository root: swift ios/AppStore/frame.swift
import AppKit

let dir = "ios/AppStore/screenshots"
let size = CGSize(width: 1320, height: 2868)
let shots: [(raw: String, en: String, zh: String)] = [
    ("missed", "See the sentences\nyou missed last night", "看清昨晚\n没听出来的句子"),
    ("review", "Your words, due today", "今天该复习的生词"),
    ("word", "Each word comes with\nthe sentence you heard", "每个生词都带着\n你听到它的那句话"),
    ("player", "A podcast player\nmade for learners", "为学习者设计的\n播客播放器"),
]
let background = NSColor(red: 0.36, green: 0.36, blue: 0.90, alpha: 1)

for (i, shot) in shots.enumerated() {
    for (lang, text) in [("en", shot.en), ("zh", shot.zh)] {
        // The simulator screenshot, taken with the app in the same language (see README.md).
        guard let screen = NSImage(contentsOfFile: "\(dir)/\(lang)-\(shot.raw)-raw.png") else { fatalError("missing \(lang)-\(shot.raw)-raw.png") }
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height), bitsPerSample: 8,
                                   samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        rep.size = size
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        background.setFill()
        NSRect(origin: .zero, size: size).fill()

        // Caption, centred in the top band.
        let font = lang == "zh" ? NSFont(name: "PingFangSC-Semibold", size: 100)! : NSFont.systemFont(ofSize: 104, weight: .bold)
        let style = NSMutableParagraphStyle()
        style.alignment = .center
        style.lineSpacing = 12
        let caption = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: NSColor.white, .paragraphStyle: style, .kern: lang == "zh" ? 0 : -1.5])
        let band = CGRect(x: 80, y: size.height - 620, width: size.width - 160, height: 480)
        let h = caption.boundingRect(with: band.size, options: [.usesLineFragmentOrigin]).height
        caption.draw(with: CGRect(x: band.minX, y: band.minY + (band.height - h) / 2, width: band.width, height: h), options: [.usesLineFragmentOrigin])

        // The screen, scaled down, with rounded corners, running off the bottom edge.
        let w: CGFloat = 1080
        let sh = w * size.height / size.width
        let frame = CGRect(x: (size.width - w) / 2, y: size.height - 680 - sh, width: w, height: sh)
        let clip = NSBezierPath(roundedRect: frame, xRadius: 96, yRadius: 96)
        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.25)
        shadow.shadowBlurRadius = 60
        shadow.shadowOffset = CGSize(width: 0, height: -20)
        shadow.set()
        NSColor.white.setFill()
        clip.fill()
        NSGraphicsContext.restoreGraphicsState()
        NSGraphicsContext.saveGraphicsState()
        clip.addClip()
        screen.draw(in: frame)
        NSGraphicsContext.restoreGraphicsState()

        NSGraphicsContext.restoreGraphicsState()
        // JPEG: App Store Connect turns down screenshots with an alpha channel.
        let out = "\(dir)/\(lang)-\(i + 1)-\(shot.raw).jpg"
        try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.92])!.write(to: URL(fileURLWithPath: out))
        print(out)
    }
}
