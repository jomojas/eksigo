import AVFoundation
import MediaPlayer
import Network
import SwiftData
import os

/// Everything that plays: podcast episodes (stream or download, speed, skip, resume, sleep timer) and the missed
/// sentences from the computer, one by one, each played a few times (design P03). Owns downloads, the lock screen and
/// the headphone commands. Listening time counts for today, and each episode's latest listen is synced.
@Observable
final class PlaybackCenter {
    enum Mode: Equatable { case none, episode, missed }

    private(set) var mode: Mode = .none
    /// The episode in the mini player.
    private(set) var episode: PodcastEpisode?
    private(set) var isPlaying = false
    private(set) var position: Double = 0
    private(set) var duration: Double = 0
    private(set) var sleepAt: Date?
    private(set) var sleepAtEnd = false
    var sleepActive: Bool { sleepAt != nil || sleepAtEnd }
    var error: String?

    let settings: AppSettings
    @ObservationIgnored let store: RecordStore
    @ObservationIgnored private let context: ModelContext
    @ObservationIgnored private let player = AVPlayer()
    /// What `player` has loaded.
    @ObservationIgnored private var loadedURL: URL?
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var boundary: Any?
    @ObservationIgnored private var lastSaved = Date.distantPast
    @ObservationIgnored private var lastTick: Double?
    @ObservationIgnored private var sleepTask: Task<Void, Never>?
    @ObservationIgnored private let log = Logger(subsystem: "com.eksigo.app", category: "playback")
    /// Called when playback pauses, to sync the listening soon.
    @ObservationIgnored var onPause: (() -> Void)?

    init(settings: AppSettings, store: RecordStore, context: ModelContext) {
        self.settings = settings
        self.store = store
        self.context = context
        player.automaticallyWaitsToMinimizeStalling = true
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] time in
            MainActor.assumeIsolated { self?.tick(time.seconds) }
        }
        observe()
        configureRemoteCommands()
        restoreLast()
        network.pathUpdateHandler = { [weak self] path in
            let wifi = path.status == .satisfied && path.usesInterfaceType(.wifi) && !path.isExpensive
            let online = path.status == .satisfied
            Task { @MainActor in
                self?.onWiFi = wifi
                self?.online = online
                self?.downloadMissedEpisodes()
            }
        }
        network.start(queue: .main)
    }

    @ObservationIgnored private let network = NWPathMonitor()
    private var onWiFi = false
    private(set) var online = true

    var rate: Float { settings.speed }

    // MARK: Episodes

    /// Plays an episode from where it was left (or from `at`).
    func play(_ episode: PodcastEpisode, at time: Double? = nil) {
        if mode == .missed { endMissed() }
        let record = Store.record(for: episode, in: context)
        if self.episode?.key != episode.key {
            saveProgress()
            self.episode = episode
            duration = record.duration > 0 ? record.duration : (episode.duration ?? 0)
            position = time ?? (record.played || record.progress > 0.98 ? 0 : record.position)
            UserDefaults.standard.set(episode.key, forKey: "lastEpisode")
        } else if let time {
            position = time
        }
        load(localFile(record) ?? episode.audioUrl, at: position)
        record.lastPlayedAt = .now
        record.played = false
        record.episodeData = (try? JSONEncoder().encode(episode)) ?? record.episodeData
        mode = .episode
        activate()
        player.playImmediately(atRate: rate)
        isPlaying = true
        saveProgress(force: true)
        updateNowPlaying()
    }

    func togglePlayPause() {
        switch mode {
        case .missed: missedTogglePlay()
        case .episode: isPlaying ? pause() : resume()
        case .none: if episode != nil { resume() }
        }
    }

    func pause() {
        player.pause()
        isPlaying = false
        if mode == .missed { missed?.waiting?.cancel() }
        saveProgress(force: true)
        store.flush()
        updateNowPlaying()
        onPause?()
    }

    func resume() {
        guard let episode else { return }
        if mode == .missed { endMissed() }
        mode = .episode
        let record = Store.record(for: episode, in: context)
        let url = localFile(record) ?? episode.audioUrl
        if loadedURL != url { load(url, at: position) }
        activate()
        player.playImmediately(atRate: rate)
        isPlaying = true
        updateNowPlaying()
    }

    func seek(to time: Double) {
        position = max(0, min(time, duration > 0 ? duration : time))
        seeking = true
        player.seek(to: CMTime(seconds: position, preferredTimescale: 600)) { [weak self] _ in
            Task { @MainActor in self?.seeking = false }
        }
        updateNowPlaying()
    }

    @ObservationIgnored private var seeking = false

    func skip(_ seconds: Double) { seek(to: position + seconds) }

    func setRate(_ value: Float) {
        settings.speed = value
        if isPlaying, mode == .episode { player.rate = value }
        updateNowPlaying()
    }

    /// Pauses after `minutes`; nil turns the sleep timer off.
    func sleep(after minutes: Int?) {
        sleepTask?.cancel()
        sleepAtEnd = false
        guard let minutes else { sleepAt = nil; return }
        sleepAt = Date.now.addingTimeInterval(Double(minutes * 60))
        sleepTask = Task {
            try? await Task.sleep(for: .seconds(minutes * 60))
            guard !Task.isCancelled else { return }
            pause()
            sleepAt = nil
        }
    }

    func sleepAtEndOfEpisode() {
        sleepTask?.cancel()
        sleepAt = nil
        sleepAtEnd = true
    }

    private func load(_ url: URL, at time: Double) {
        if loadedURL != url {
            player.replaceCurrentItem(with: AVPlayerItem(url: url))
            loadedURL = url
        }
        player.seek(to: CMTime(seconds: time, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    private func tick(_ seconds: Double) {
        guard seconds.isFinite, !seeking else { return }
        if isPlaying, let last = lastTick, seconds > last, seconds - last < 2 {
            store.addSeconds((seconds - last) / Double(max(player.rate, 0.1)), kind: "listening")
        }
        lastTick = seconds
        guard mode == .episode else { return }
        position = seconds
        if let d = player.currentItem?.duration.seconds, d.isFinite, d > 0 { duration = d }
        if Date.now.timeIntervalSince(lastSaved) > 15 { saveProgress() }
    }

    /// Where the episode is, here and in its `listen` record.
    func saveProgress(force _: Bool = false) {
        guard let episode, mode == .episode || mode == .none else { return }
        let record = Store.record(for: episode, in: context)
        record.position = position
        if duration > 0 { record.duration = duration }
        lastSaved = .now
        // A few seconds in counts as a listen; just opening it doesn't.
        guard position > 5 || record.played else { return }
        store.put("listen", episode.audioUrl.absoluteString, Self.listen(episode, position: position, duration: duration, finished: record.played),
                  soon: false)
        store.flush()
    }

    static func listen(_ e: PodcastEpisode, position: Double, duration: Double, finished: Bool) -> [String: Any] {
        var json: [String: Any] = [
            "audioUrl": e.audioUrl.absoluteString, "episode": e.title, "show": e.showTitle,
            "durationS": (duration * 10).rounded() / 10, "positionS": (position * 10).rounded() / 10, "finished": finished,
            "listenedAt": RecordStore.nowMs(),
        ]
        json["feedUrl"] = e.feedUrl?.absoluteString
        json["guid"] = e.guid
        json["artworkUrl"] = e.artwork?.absoluteString
        return json
    }

    private func finished() {
        guard let episode else { return }
        let record = Store.record(for: episode, in: context)
        record.played = true
        position = duration
        isPlaying = false
        saveProgress(force: true)
        record.position = 0
        position = 0
        sleepAtEnd = false
        updateNowPlaying()
        onPause?()
    }

    // MARK: Missed sentences

    /// The missed-sentences player (design P03): one sentence at a time, each played `settings.repeats` times.
    @Observable
    final class MissedSession {
        let items: [Missed]
        var index: Int
        /// Plays of the current sentence finished.
        var plays = 0
        var playing = false
        /// The text is shown (after the first play, by the setting, or when asked).
        var revealed = false
        var rate: Float = 1
        var finishedAll = false
        @ObservationIgnored var waiting: Task<Void, Never>?

        init(items: [Missed], index: Int) {
            self.items = items
            self.index = index
        }

        var current: Missed? { items.indices.contains(index) ? items[index] : nil }
    }

    private(set) var missed: MissedSession?
    /// Said in the player when a sentence can't be played (no connection, or the file is gone).
    private(set) var missedProblem: String?

    /// Can this sentence play here? Not when the phone's copy of the episode isn't the file the computer dictated.
    func playable(_ m: Missed) -> Bool { source(for: m) != nil }

    /// The audio for a missed sentence: the download when it's the same file, else the stream.
    func source(for m: Missed) -> URL? {
        guard let ref = m.ref.episodeValue else { return nil }
        if let record = Store.existingRecord(key: ref.key, in: context), let file = localFile(record) {
            if let want = m.bytes, want > 0, let have = record.fileBytes, have != want { return nil }
            return file
        }
        return ref.audioUrl
    }

    func startMissed(_ items: [Missed], at index: Int = 0) {
        let playableItems = items.filter(playable)
        guard !playableItems.isEmpty else { return }
        if mode == .episode, isPlaying {
            player.pause()
            saveProgress(force: true)
        }
        isPlaying = false
        let start = items.indices.contains(index) ? playableItems.firstIndex(of: items[index]) ?? 0 : 0
        let session = MissedSession(items: playableItems, index: start)
        session.rate = 1
        missed = session
        mode = .missed
        activate()
        playCurrent(fresh: true)
    }

    func endMissed() {
        missed?.waiting?.cancel()
        clearBoundary()
        player.pause()
        missed = nil
        if mode == .missed { mode = episode == nil ? .none : .episode }
        isPlaying = false
        lastTick = nil
        // The episode plays from where it was the next time it's resumed.
        loadedURL = nil
        updateNowPlaying()
        store.flush()
        onPause?()
    }

    func missedNext() { moveMissed(by: 1) }
    func missedPrevious() { moveMissed(by: -1) }

    func missedReplay() {
        guard let s = missed else { return }
        s.waiting?.cancel()
        s.plays = max(0, min(s.plays, settings.repeats - 1))
        s.finishedAll = false
        playCurrent(fresh: false)
    }

    func missedJump(to index: Int) {
        guard let s = missed, s.items.indices.contains(index) else { return }
        s.waiting?.cancel()
        s.index = index
        s.finishedAll = false
        playCurrent(fresh: true)
    }

    func missedSetRate(_ r: Float) {
        guard let s = missed else { return }
        s.rate = r
        if s.playing { player.rate = r }
    }

    func missedReveal() { missed?.revealed.toggle() }

    /// `isPlaying` is the playlist running, also in the quiet between two plays.
    private func missedTogglePlay() {
        guard let s = missed else { return }
        if isPlaying {
            player.pause()
            s.playing = false
            isPlaying = false
            s.waiting?.cancel()
            store.flush()
            updateNowPlaying()
        } else if s.finishedAll {
            missedJump(to: 0)
        } else {
            playCurrent(fresh: false)
        }
    }

    private func moveMissed(by step: Int) {
        guard let s = missed else { return }
        s.waiting?.cancel()
        let i = s.index + step
        guard s.items.indices.contains(i) else {
            if step > 0 { finishMissed() }
            return
        }
        s.index = i
        s.finishedAll = false
        playCurrent(fresh: true)
    }

    private func finishMissed() {
        guard let s = missed else { return }
        s.finishedAll = true
        s.playing = false
        isPlaying = false
        clearBoundary()
        player.pause()
        store.flush()
        updateNowPlaying()
        onPause?()
    }

    private func playCurrent(fresh: Bool) {
        guard let s = missed, let m = s.current, let url = source(for: m) else { return finishMissed() }
        if fresh {
            s.plays = 0
            s.revealed = settings.showText == .always
        }
        load(url, at: Double(m.startMs) / 1000)
        clearBoundary()
        boundary = player.addBoundaryTimeObserver(forTimes: [NSValue(time: CMTime(value: CMTimeValue(m.endMs), timescale: 1000))], queue: .main) { [weak self] in
            MainActor.assumeIsolated { self?.sentenceEnded() }
        }
        player.playImmediately(atRate: s.rate)
        s.playing = true
        isPlaying = true
        lastTick = nil
        missedProblem = nil
        updateNowPlaying()
        watch(s, index: s.index)
        // Episodes downloaded later play from the file the next time.
        if let ref = m.ref.episodeValue { downloadIfWanted(ref) }
    }

    /// A sentence that hasn't started after a while doesn't play: its text is shown, and the player says why.
    private func watch(_ s: MissedSession, index: Int) {
        let item = player.currentItem
        Task {
            try? await Task.sleep(for: .seconds(8))
            guard missed === s, s.index == index, s.playing, s.plays == 0, player.currentItem === item,
                  player.timeControlStatus != .playing else { return }
            s.revealed = true
            missedProblem = online
                ? "This sentence couldn't be played: the episode's file can't be reached. Its text is shown instead."
                : "No connection, and the episode isn't downloaded. Its text is shown instead."
        }
    }

    private func sentenceEnded() {
        guard let s = missed, s.playing else { return }
        player.pause()
        s.playing = false
        s.plays += 1
        if settings.showText == .afterPlay { s.revealed = true }
        let more = s.plays < settings.repeats
        s.waiting = Task {
            try? await Task.sleep(for: .seconds(settings.gap))
            guard !Task.isCancelled, self.missed === s else { return }
            if more { self.playCurrent(fresh: false) } else { self.moveMissed(by: 1) }
        }
        isPlaying = true  // still "playing" the playlist, between plays
        updateNowPlaying()
    }

    private func clearBoundary() {
        if let boundary { player.removeTimeObserver(boundary) }
        boundary = nil
    }

    // MARK: Downloads

    static var downloadsDir: URL { URL.applicationSupportDirectory.appending(path: "downloads", directoryHint: .isDirectory) }

    func localFile(_ record: EpisodeRecord) -> URL? {
        guard let name = record.localFile else { return nil }
        let url = Self.downloadsDir.appending(path: name)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    private(set) var downloading: [String: Double] = [:]

    /// Downloads started by themselves that failed: not tried again until the app restarts, and never an alert.
    @ObservationIgnored private var failedAuto: Set<String> = []

    /// `asked`: the learner asked for it, so a failure is said; a download started by itself fails quietly.
    func download(_ episode: PodcastEpisode, asked: Bool = true) {
        let key = episode.key
        guard downloading[key] == nil, !isDownloaded(episode) else { return }
        if !asked, failedAuto.contains(key) { return }
        downloading[key] = 0
        let ext = episode.audioUrl.pathExtension.isEmpty ? "mp3" : episode.audioUrl.pathExtension
        let name = "\(Self.fileName(for: key)).\(ext)"
        Task {
            do {
                let destination = Self.downloadsDir.appending(path: name)
                try await Downloader.shared.download(episode.audioUrl, to: destination) { fraction in
                    Task { @MainActor in if self.downloading[key] != nil { self.downloading[key] = fraction } }
                }
                let record = Store.record(for: episode, in: context)
                record.localFile = name
                record.downloadedAt = .now
                record.fileBytes = (try? FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? NSNumber)?.int64Value
                try? context.save()
            } catch {
                log.error("download failed: \(error.localizedDescription)")
                if asked {
                    self.error = "Couldn't download “\(episode.title)”: \(error.localizedDescription)"
                } else {
                    failedAuto.insert(key)
                }
            }
            downloading[key] = nil
        }
    }

    /// A stable file name for an episode (Swift's `hashValue` changes between launches).
    nonisolated static func fileName(for key: String) -> String {
        var h: UInt64 = 1469598103934665603
        for b in key.utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
        return String(h, radix: 36)
    }

    func deleteDownload(_ episode: PodcastEpisode) {
        let record = Store.record(for: episode, in: context)
        if let url = localFile(record) {
            if loadedURL == url {
                // The episode loaded now played that file: it streams again, from the same time.
                let wasPlaying = isPlaying && mode == .episode
                loadedURL = nil
                if mode == .episode { load(episode.audioUrl, at: position) }
                if wasPlaying { player.playImmediately(atRate: rate) }
            }
            try? FileManager.default.removeItem(at: url)
        }
        record.localFile = nil
        record.fileBytes = nil
        try? context.save()
    }

    func localURL(_ episode: PodcastEpisode) -> URL? {
        Store.existingRecord(key: episode.key, in: context).flatMap(localFile)
    }

    func isDownloaded(_ episode: PodcastEpisode) -> Bool {
        Store.existingRecord(key: episode.key, in: context).flatMap(localFile) != nil
    }

    /// Downloads made on this phone, newest first.
    func downloads() -> [EpisodeRecord] {
        let all = (try? context.fetch(FetchDescriptor<EpisodeRecord>(predicate: #Predicate { $0.localFile != nil }))) ?? []
        for r in all where r.fileBytes == nil {
            // Downloads made before sizes were kept: read it from the file.
            if let url = localFile(r) { r.fileBytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value }
        }
        return all.filter { localFile($0) != nil }.sorted { ($0.downloadedAt ?? .distantPast) > ($1.downloadedAt ?? .distantPast) }
    }

    var downloadedBytes: Int64 { downloads().reduce(0) { $0 + ($1.fileBytes ?? 0) } }

    /// "1.2 GB", or "None".
    var downloadedText: String {
        let b = downloadedBytes
        return b > 0 ? ByteCountFormatter.string(fromByteCount: b, countStyle: .file) : "None"
    }

    private var downloadAllowed: Bool { online && (onWiFi || !settings.wifiOnly) }

    private func downloadIfWanted(_ episode: PodcastEpisode) {
        guard settings.downloadMissed, downloadAllowed else { return }
        download(episode, asked: false)
    }

    /// The episodes with missed sentences, downloaded by themselves (setting on) so they play without a connection.
    func downloadMissedEpisodes() {
        guard settings.downloadMissed, downloadAllowed else { return }
        var seen = Set<String>()
        for m in store.missed where seen.insert(m.audioUrl).inserted {
            if let e = m.ref.episodeValue { download(e, asked: false) }
        }
    }

    // MARK: System

    private func activate() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    private func restoreLast() {
        guard let key = UserDefaults.standard.string(forKey: "lastEpisode"),
              let record = Store.existingRecord(key: key, in: context), let episode = record.episode else { return }
        self.episode = episode
        position = record.position
        duration = record.duration
        mode = .none
    }

    private func observe() {
        let center = NotificationCenter.default
        center.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] note in
            let ended = (note.object as AnyObject?).map(ObjectIdentifier.init)
            MainActor.assumeIsolated {
                guard let self, let item = self.player.currentItem, ended == ObjectIdentifier(item) else { return }
                if self.mode == .episode { self.finished() } else if self.mode == .missed { self.sentenceEnded() }
            }
        }
        center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init)
            guard type == .began else { return }
            MainActor.assumeIsolated { self?.pauseAll() }
        }
        center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt).flatMap(AVAudioSession.RouteChangeReason.init)
            // Headphones unplugged: pause instead of playing out loud.
            guard reason == .oldDeviceUnavailable else { return }
            MainActor.assumeIsolated { self?.pauseAll() }
        }
    }

    func pauseAll() {
        if mode == .missed { if isPlaying { missedTogglePlay() } } else if isPlaying { pause() }
    }

    /// Episodes: ±15/30 s like any podcast app. Missed sentences: next and previous sentence.
    private func configureRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.togglePlayPauseCommand.addTarget { [weak self] _ in self?.togglePlayPause(); return .success }
        c.playCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            if !self.isPlaying { self.togglePlayPause() }
            return .success
        }
        c.pauseCommand.addTarget { [weak self] _ in self?.pauseAll(); return .success }
        c.nextTrackCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            if self.mode == .missed { self.missedNext() } else { self.skip(self.settings.skipForward) }
            return .success
        }
        c.previousTrackCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            if self.mode == .missed { self.missedPrevious() } else { self.skip(-self.settings.skipBack) }
            return .success
        }
        c.skipForwardCommand.preferredIntervals = [NSNumber(value: settings.skipForward)]
        c.skipBackwardCommand.preferredIntervals = [NSNumber(value: settings.skipBack)]
        c.skipForwardCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.skip(self.settings.skipForward)
            return .success
        }
        c.skipBackwardCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.skip(-self.settings.skipBack)
            return .success
        }
        c.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.seek(to: e.positionTime)
            return .success
        }
    }

    func updateNowPlaying() {
        let c = MPRemoteCommandCenter.shared()
        let plain = mode != .missed
        c.skipForwardCommand.isEnabled = plain
        c.skipBackwardCommand.isEnabled = plain
        c.changePlaybackPositionCommand.isEnabled = plain
        var info: [String: Any]
        if let s = missed, let m = s.current {
            info = [
                MPMediaItemPropertyTitle: "Missed sentence \(s.index + 1) of \(s.items.count)",
                MPMediaItemPropertyArtist: m.episode,
                MPNowPlayingInfoPropertyPlaybackRate: s.playing ? Double(s.rate) : 0,
            ]
            loadArtwork(m.artworkUrl.flatMap(URL.init(string:)))
        } else if let episode {
            info = [
                MPMediaItemPropertyTitle: episode.title,
                MPMediaItemPropertyArtist: episode.showTitle,
                MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
                MPMediaItemPropertyPlaybackDuration: duration,
                MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? Double(rate) : 0,
            ]
            loadArtwork(episode.artwork)
        } else {
            return
        }
        if let image = artworkImage { info[MPMediaItemPropertyArtwork] = lockScreenArtwork(image) }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    @ObservationIgnored private var artworkImage: UIImage?
    @ObservationIgnored private var artworkURL: URL?

    private func loadArtwork(_ url: URL?) {
        guard let url, url != artworkURL else { return }
        artworkURL = url
        artworkImage = nil
        Task {
            guard let (data, _) = try? await URLSession.shared.data(from: API.shared.art(url)), let image = UIImage(data: data) else { return }
            artworkImage = image
            updateNowPlaying()
        }
    }
}

/// The lock screen asks for the image on a background queue, so the closure must not be main-actor isolated.
nonisolated private func lockScreenArtwork(_ image: UIImage) -> MPMediaItemArtwork {
    MPMediaItemArtwork(boundsSize: image.size) { @Sendable _ in image }
}
