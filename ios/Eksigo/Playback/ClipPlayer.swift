import AVFoundation

/// Plays one stretch of an episode: a word's sentence in review and on the word's page. The episode in the mini player
/// pauses first. The word itself is said by the phone's voice.
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

    func play(_ context: WordContext, rate: Float = 1) {
        guard context.playable, let url = context.audioUrl.flatMap(URL.init(string:)) else { return }
        play(local(url) ?? url, from: context.sentenceStartMs, to: context.sentenceEndMs, rate: rate, id: "\(context.audioUrl ?? "")|\(context.idx)")
    }

    /// The download, when the episode is on the phone.
    private func local(_ url: URL) -> URL? {
        center?.localURL(PodcastEpisode(audioUrl: url, title: "", summary: "", showTitle: ""))
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
