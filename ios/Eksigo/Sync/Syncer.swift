import Foundation

/// Sync with the account (DESIGN.md section 7, API.md "Sync"): sends what changed on this phone and takes in what the
/// other devices changed. It runs by itself: when the app opens, a few seconds after a review, when playback pauses,
/// and every ten minutes while the app is open.
@Observable
final class Syncer {
    enum State: Equatable { case off, syncing, synced, failed(String) }

    private(set) var state: State = .synced
    /// The last sync that worked.
    private(set) var last: Date?
    /// Never synced with this account yet: what's on the phone is being added to it.
    var first: Bool { account.isSignedIn && last == nil }

    @ObservationIgnored private let store: RecordStore
    @ObservationIgnored private let account: Account
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var running: Task<Void, Never>?
    @ObservationIgnored private var nudge: Task<Void, Never>?
    @ObservationIgnored private var again = false

    /// Changes per request; the server takes at most 500.
    static let chunk = 400

    init(store: RecordStore, account: Account, defaults: UserDefaults = .standard) {
        self.store = store
        self.account = account
        self.defaults = defaults
        last = (defaults.object(forKey: "sync.last") as? Double).map(Date.init(timeIntervalSince1970:))
        store.onChange = { [weak self] in self?.soon() }
        account.onSignIn = { [weak self] in self?.now() }
    }

    var shown: State { account.isSignedIn ? state : .off }

    /// Sync after a few quiet seconds, so a burst of changes goes in one request.
    func soon(after seconds: Double = 4) {
        nudge?.cancel()
        nudge = Task {
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            now()
        }
    }

    /// Sync now (or once more after the one under way).
    func now() {
        store.flush()
        guard account.isSignedIn else { return }
        if running != nil {
            again = true
            return
        }
        running = Task {
            repeat {
                again = false
                await runOnce()
            } while again
            running = nil
        }
    }

    /// Every ten minutes while the app is open.
    func every(minutes: Double = 10) async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(minutes * 60))
            guard !Task.isCancelled else { return }
            now()
        }
    }

    private var cursorKey: String { "sync.cursor" }

    private func runOnce() async {
        guard let token = account.token, let user = account.user else { return }
        state = .syncing
        // Another account than last time: start over with it.
        if defaults.object(forKey: "sync.account") as? Int != user.id {
            store.startOver()
            defaults.removeObject(forKey: cursorKey)
            defaults.removeObject(forKey: "sync.last")
            last = nil
            defaults.set(user.id, forKey: "sync.account")
        }
        do {
            for _ in 0..<2 {
                var since = (defaults.object(forKey: cursorKey) as? NSNumber)?.int64Value ?? 0
                let outgoing = store.records(dirtyOnly: true).map { r in
                    SyncChange(kind: r.kind, key: r.key, changedAt: r.changedAt, deleted: r.deleted,
                               data: r.deleted ? nil : AnyJSON(r.json))
                }
                var reset = false
                var start = 0
                while true {
                    let part = Array(outgoing[min(start, outgoing.count)..<min(start + Self.chunk, outgoing.count)])
                    let answer = try await API.shared.sync(token: token, since: since, changes: part)
                    start += Self.chunk
                    reset = reset || answer.reset == true
                    since = answer.cursor
                    // What the server took is no longer dirty; what it refused comes back newer and is applied.
                    let came = Set(answer.changes.map { SyncRecord.id($0.kind, $0.key) })
                    store.sent(part.filter { !came.contains(SyncRecord.id($0.kind, $0.key)) })
                    store.apply(answer.changes)
                    defaults.set(NSNumber(value: since), forKey: cursorKey)
                    if start >= outgoing.count && !answer.more { break }
                }
                guard reset else { break }
                // The server lost its copy: send everything again.
                store.markAllDirty()
                defaults.removeObject(forKey: cursorKey)
            }
            last = .now
            defaults.set(Date.now.timeIntervalSince1970, forKey: "sync.last")
            state = .synced
        } catch let e as APIError where e.signedOut {
            account.forget()
            state = .off
        } catch let e as APIError {
            state = .failed(e.localizedDescription)
        } catch {
            state = .failed("Couldn't reach Eksigo. Your changes are kept here and sync when the connection is back.")
        }
    }
}

extension Date {
    /// "2 minutes ago", "yesterday, 21:40".
    var agoText: String {
        let s = Date.now.timeIntervalSince(self)
        if s < 60 { return "just now" }
        if s < 3600 { let m = Int(s / 60); return "\(m) minute\(m == 1 ? "" : "s") ago" }
        if Calendar.current.isDateInToday(self) { return "today, \(formatted(date: .omitted, time: .shortened))" }
        if Calendar.current.isDateInYesterday(self) { return "yesterday, \(formatted(date: .omitted, time: .shortened))" }
        return formatted(.dateTime.day().month(.abbreviated))
    }
}
