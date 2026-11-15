import AVFoundation

/// Plays one stretch of an episode: a word's sentence in review and on the word's page, only from the computer's own
/// file. The episode in the mini player pauses first. The word itself is said by the phone's voice.
@Observable
final class ClipPlayer {
    private(set) var playing: String?
    @ObservationIgnored private let player = AVPlayer()
    @ObservationIgnored private var boundary: Any?
    @ObservationIgnored private let voice = AVSpeechSynthesizer()
    @ObservationIgnored weak var center: PlaybackCenter?

    /// Plays `[start, end]` of the audio; `id` tells the screen which one is playing.
    func play(_ url: URL, from startMs: Int, to endMs: Int, rate: Float = 1, id: String) {
        stop()
        center?.pauseAll()
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        player.replaceCurrentItem(with: AVPlayerItem(url: url))
        player.seek(to: CMTime(value: CMTimeValue(startMs), timescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero)
        boundary = player.addBoundaryTimeObserver(forTimes: [NSValue(time: CMTime(value: CMTimeValue(endMs), timescale: 1000))], queue: .main) { [weak self] in
            MainActor.assumeIsolated { self?.stop() }
        }
        player.playImmediately(atRate: rate)
        playing = id
    }

    /// Episodes (by address) whose file here isn't the computer's: an ad-inserting podcast serves another file, where
    /// the sentence is somewhere else, so it isn't played at all.
    private(set) var otherFile: Set<String> = []
    /// Addresses checked: true when they serve the computer's file.
    @ObservationIgnored private var checked: [String: Bool] = [:]

    /// The sentence can play here, as far as is known yet.
    func canPlay(_ context: WordContext) -> Bool { context.playable && !otherFile.contains(context.audioUrl ?? "") }

    /// Plays a word's sentence from the same file the computer had: the download when its size matches, else the
    /// stream once its size is checked. A different file isn't played; `otherFile` tells the screen.
    func play(_ context: WordContext, rate: Float = 1) {
        guard canPlay(context), let address = context.audioUrl, let url = URL(string: address) else { return }
        let id = "\(address)|\(context.idx)"
        let (start, end) = (context.sentenceStartMs, context.sentenceEndMs)
        guard let want = context.bytes, want > 0 else {
            // A computer that doesn't send sizes yet: as before.
            return play(center?.download(of: episode(url))?.url ?? url, from: start, to: end, rate: rate, id: id)
        }
        if let d = center?.download(of: episode(url)), d.bytes == want {
            return play(d.url, from: start, to: end, rate: rate, id: id)
        }
        if let same = checked[address] {
            return same ? play(url, from: start, to: end, rate: rate, id: id) : refuse(address)
        }
        Task {
            let size = await Self.size(of: url)
            // Unknown (no connection, a server that won't say): try it rather than refuse.
            let same = size.map { $0 == want } ?? true
            if size != nil { checked[address] = same }
            same ? play(url, from: start, to: end, rate: rate, id: id) : refuse(address)
        }
    }

    private func refuse(_ address: String) {
        stop()
        otherFile.insert(address)
    }

    private func episode(_ url: URL) -> PodcastEpisode { PodcastEpisode(audioUrl: url, title: "", summary: "", showTitle: "") }

    /// The size of the file an address serves now, from its first byte's answer.
    nonisolated static func size(of url: URL) async -> Int64? {
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.setValue("bytes=0-0", forHTTPHeaderField: "Range")
        guard let (_, response) = try? await URLSession.shared.data(for: request), let http = response as? HTTPURLResponse else { return nil }
        if http.statusCode == 206, let range = http.value(forHTTPHeaderField: "Content-Range"),
           let total = range.split(separator: "/").last.flatMap({ Int64($0) }) {
            return total
        }
        return http.statusCode == 200 && http.expectedContentLength > 0 ? http.expectedContentLength : nil
    }

    func say(_ text: String) {
        stop()
        center?.pauseAll()
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "en-US")
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.9
        voice.speak(u)
    }

    func stop() {
        player.pause()
        if let boundary { player.removeTimeObserver(boundary) }
        boundary = nil
        playing = nil
        if voice.isSpeaking { voice.stopSpeaking(at: .immediate) }
    }
}
