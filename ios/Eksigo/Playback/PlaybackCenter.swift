import AVFoundation
import MediaPlayer
import Network
import SwiftData
import os

/// Everything that plays: podcast episodes (stream or download, speed, skip, resume, sleep timer). Owns downloads, the
/// lock screen and the headphone commands. Listening time counts for today, and each episode's latest listen is synced.
@Observable
final class PlaybackCenter {
    enum Mode: Equatable { case none, episode }

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
            let online = path.status == .satisfied
            Task { @MainActor in
                self?.online = online
            }
        }
        network.start(queue: .main)
    }

    @ObservationIgnored private let network = NWPathMonitor()
    private(set) var online = true

    var rate: Float { settings.speed }

    // MARK: Episodes

    /// Plays an episode from where it was left (or from `at`). It leaves Up Next if it was there.
    func play(_ episode: PodcastEpisode, at time: Double? = nil, saveCurrent: Bool = true) {
        let record = Store.record(for: episode, in: context)
        removeFromQueue(episode.key)
        if self.episode?.key != episode.key {
            if saveCurrent { saveProgress() }
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
        // Saved now: the mini player and Continue find it even if the app is closed straight away.
        try? context.save()
        mode = .episode
        activate()
        player.playImmediately(atRate: rate)
        isPlaying = true
        saveProgress(force: true)
        updateNowPlaying()
    }

    func togglePlayPause() {
        switch mode {
        case .episode: isPlaying ? pause() : resume()
        case .none: if episode != nil { resume() }
        }
    }

    func pause() {
        player.pause()
        isPlaying = false
        saveProgress(force: true)
        store.flush()
        updateNowPlaying()
        onPause?()
    }

    func resume() {
        guard let episode else { return }
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

    /// The episode ended (or was marked played): the first in Up Next starts, unless the sleep timer said to stop
    /// at the end of this one. With nothing in Up Next, playback stops.
    private func finished() {
        guard let episode else { return }
        let record = Store.record(for: episode, in: context)
        record.played = true
        if duration > 0 { position = duration }
        let wasPlaying = isPlaying
        isPlaying = false
        player.pause()
        saveProgress(force: true)
        record.position = 0
        position = 0
        let stop = sleepAtEnd
        sleepAtEnd = false
        if !stop, wasPlaying, let next = queue.first {
            play(next, saveCurrent: false)
            return
        }
        updateNowPlaying()
        onPause?()
    }

    /// The More menu's "Mark as played": as if it had ended.
    func markPlayed() {
        guard episode != nil else { return }
        finished()
    }

    // MARK: Up Next

    /// Episodes to play after this one, in order; each leaves the list when it starts. Kept on this phone only (the
    /// computer has no queue).
    private(set) var queue: [PodcastEpisode] = PlaybackCenter.loadQueue() {
        didSet { Self.saveQueue(queue) }
    }

    func isQueued(_ episode: PodcastEpisode) -> Bool { queue.contains { $0.key == episode.key } }

    /// Adds it at the end; returns its place (1 = next), or nil when it is playing now or already there.
    @discardableResult
    func addToQueue(_ episode: PodcastEpisode) -> Int? {
        guard episode.key != self.episode?.key, !isQueued(episode) else { return nil }
        queue.append(episode)
        return queue.count
    }

    func removeFromQueue(_ key: String) { queue.removeAll { $0.key == key } }

    func moveQueue(from source: IndexSet, to destination: Int) { queue.move(fromOffsets: source, toOffset: destination) }

    func clearQueue() { queue = [] }

    /// Plays the first in Up Next now; the current episode keeps its place.
    func playNextInQueue() {
        guard let next = queue.first else { return }
        play(next)
    }

    /// The time Up Next will take.
    var queueSeconds: Double { queue.reduce(0) { $0 + ($1.duration ?? 0) } }

    nonisolated private static func loadQueue() -> [PodcastEpisode] {
        guard let data = UserDefaults.standard.data(forKey: "upNext") else { return [] }
        return (try? JSONDecoder().decode([PodcastEpisode].self, from: data)) ?? []
    }

    nonisolated private static func saveQueue(_ queue: [PodcastEpisode]) {
        UserDefaults.standard.set(try? JSONEncoder().encode(queue), forKey: "upNext")
    }

    // MARK: Downloads

    static var downloadsDir: URL { URL.applicationSupportDirectory.appending(path: "downloads", directoryHint: .isDirectory) }

    func localFile(_ record: EpisodeRecord) -> URL? {
        guard let name = record.localFile else { return nil }
        let url = Self.downloadsDir.appending(path: name)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    private(set) var downloading: [String: Double] = [:]
    /// Bumped when a download finishes or is removed, so pages that count downloads draw again.
    private var downloadsChanged = 0

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
                downloadsChanged += 1
            } catch {
                log.error("download failed: \(error.localizedDescription)")
                if asked {
                    self.error = L("Couldn't download “%@”: %@", episode.title, error.localizedDescription)
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
        downloadsChanged += 1
    }

    func localURL(_ episode: PodcastEpisode) -> URL? {
        Store.existingRecord(key: episode.key, in: context).flatMap(localFile)
    }

    /// The download and its size, when the episode is on the phone.
    func download(of episode: PodcastEpisode) -> (url: URL, bytes: Int64?)? {
        guard let record = Store.existingRecord(key: episode.key, in: context), let url = localFile(record) else { return nil }
        return (url, record.fileBytes)
    }

    func isDownloaded(_ episode: PodcastEpisode) -> Bool {
        _ = downloadsChanged
        return Store.existingRecord(key: episode.key, in: context).flatMap(localFile) != nil
    }

    /// Downloads made on this phone, newest first.
    func downloads() -> [EpisodeRecord] {
        _ = downloadsChanged
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
        return b > 0 ? ByteCountFormatter.string(fromByteCount: b, countStyle: .file) : L("None")
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
                if self.mode == .episode { self.finished() }
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
        if isPlaying { pause() }
    }

    /// ±15/30 s like any podcast app.
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
            self.skip(self.settings.skipForward)
            return .success
        }
        c.previousTrackCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.skip(-self.settings.skipBack)
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
        c.skipForwardCommand.isEnabled = true
        c.skipBackwardCommand.isEnabled = true
        c.changePlaybackPositionCommand.isEnabled = true
        var info: [String: Any]
        if let episode {
            info = [
                MPMediaItemPropertyTitle: episode.title,
                MPMediaItemPropertyArtist: episode.showTitle,
                MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
                MPMediaItemPropertyPlaybackDuration: duration,
                MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? Double(rate) : 0,
            ]
            loadArtwork(episode.artworkUrl, fallback: episode.showArtworkUrl)
        } else {
            return
        }
        if let image = artworkImage { info[MPMediaItemPropertyArtwork] = lockScreenArtwork(image) }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    @ObservationIgnored private var artworkImage: UIImage?
    @ObservationIgnored private var artworkURL: URL?

    private func loadArtwork(_ url: URL?, fallback: URL? = nil) {
        guard let first = url ?? fallback, first != artworkURL else { return }
        artworkURL = first
        artworkImage = nil
        Task {
            guard let image = await CoverCache.shared.image([url, fallback].compactMap { $0 }), artworkURL == first else { return }
            artworkImage = image
            updateNowPlaying()
        }
    }
}

/// The lock screen asks for the image on a background queue, so the closure must not be main-actor isolated.
nonisolated private func lockScreenArtwork(_ image: UIImage) -> MPMediaItemArtwork {
    MPMediaItemArtwork(boundsSize: image.size) { @Sendable _ in image }
}
