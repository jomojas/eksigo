import Foundation
import SwiftData

/// Every sync record on this phone (API.md "Sync"): the computer's words, reviews, missed sentences and practice, and
/// this phone's listening, reviews and practice days. The screens read them through the typed lists below; what the
/// phone changes is marked dirty, and `Syncer` sends it.
@Observable
final class RecordStore {
    @ObservationIgnored private let context: ModelContext
    @ObservationIgnored private var byId: [String: SyncRecord] = [:]
    /// Goes up with every change, so the lists below are worked out again.
    private(set) var version = 0
    /// Called after a change worth sending soon (words and reviews; listening goes with the next sync).
    @ObservationIgnored var onChange: (() -> Void)?

    /// This phone in `day` records, so the devices' days add up.
    let device: String

    init(context: ModelContext, defaults: UserDefaults = .standard) {
        self.context = context
        if let d = defaults.string(forKey: "sync.device"), !d.isEmpty {
            device = d
        } else {
            let d = "iphone-" + String((0..<9).map { _ in "abcdefghijklmnopqrstuvwxyz0123456789".randomElement()! })
            defaults.set(d, forKey: "sync.device")
            device = d
        }
        for r in (try? context.fetch(FetchDescriptor<SyncRecord>())) ?? [] { byId[r.id] = r }
    }

    static func nowMs() -> Int64 { Int64(Date.now.timeIntervalSince1970 * 1000) }

    // MARK: Reading

    @ObservationIgnored private var cache: (version: Int, lists: Lists)?

    struct Lists {
        var words: [Word] = []
        var reviews: [Review] = []
        var missed: [Missed] = []
        var practices: [Practice] = []
        var days: [Day] = []
        var listens: [Listen] = []
    }

    var lists: Lists {
        _ = version  // observed
        if let cache, cache.version == version { return cache.lists }
        var l = Lists()
        for r in byId.values where !r.deleted {
            switch r.kind {
            case "word": l.words.append(.from(data: r.data))
            case "review": l.reviews.append(.from(data: r.data))
            case "missed": l.missed.append(.from(data: r.data))
            case "practice": l.practices.append(.from(data: r.data))
            case "day": l.days.append(.from(data: r.data))
            case "listen": l.listens.append(.from(data: r.data))
            default: break
            }
        }
        l.words.removeAll { $0.text.trimmingCharacters(in: .whitespaces).isEmpty }
        l.words.sort { $0.addedAt > $1.addedAt }
        l.reviews.sort { $0.at < $1.at }
        l.missed.sort { ($0.audioUrl, $0.idx) < ($1.audioUrl, $1.idx) }
        l.practices.sort { $0.startedAt > $1.startedAt }
        l.listens.sort { $0.listenedAt > $1.listenedAt }
        cache = (version, l)
        return l
    }

    var words: [Word] { lists.words }
    var reviews: [Review] { lists.reviews }
    var missed: [Missed] { lists.missed }
    var practices: [Practice] { lists.practices }
    var days: [Day] { lists.days }
    var listens: [Listen] { lists.listens }

    func word(_ key: String) -> Word? {
        guard let r = byId[SyncRecord.id("word", key)], !r.deleted else { return nil }
        return .from(data: r.data)
    }

    var isEmpty: Bool { byId.isEmpty }
    var count: Int { byId.count }

    func records(dirtyOnly: Bool) -> [SyncRecord] {
        byId.values.filter { !dirtyOnly || $0.dirty }.sorted { ($0.changedAt, $0.id) < ($1.changedAt, $1.id) }
    }

    // MARK: Changes made here

    /// Writes a record as this phone has it now; it's sent with the next sync.
    func put(_ kind: String, _ key: String, _ json: [String: Any], soon: Bool = true) {
        let data = (try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])) ?? Data()
        let id = SyncRecord.id(kind, key)
        let now = Self.nowMs()
        if let r = byId[id] {
            r.data = data
            r.changedAt = max(now, r.changedAt + 1)
            r.dirty = true
            r.deleted = false
        } else {
            let r = SyncRecord(kind: kind, key: key, data: data, changedAt: now, dirty: true)
            context.insert(r)
            byId[id] = r
        }
        changed(soon: soon)
    }

    /// Changes some fields of a record, keeping the rest (also fields this version doesn't know).
    func update(_ kind: String, _ key: String, soon: Bool = true, _ change: (inout [String: Any]) -> Void) {
        var json = byId[SyncRecord.id(kind, key)]?.json ?? [:]
        change(&json)
        put(kind, key, json, soon: soon)
    }

    func json(_ kind: String, _ key: String) -> [String: Any]? {
        guard let r = byId[SyncRecord.id(kind, key)], !r.deleted else { return nil }
        return r.json
    }

    private func changed(soon: Bool) {
        version += 1
        try? context.save()
        if soon { onChange?() }
    }

    // MARK: Practice days

    @ObservationIgnored private var pending: [String: Double] = [:]

    /// Time spent on this phone today, "listening" or "words". Kept in memory and written with `flush`.
    func addSeconds(_ seconds: Double, kind: String, on date: Date = .now) {
        guard seconds > 0, seconds < 600 else { return }
        pending["\(Self.dayKey(date))|\(kind)", default: 0] += seconds
    }

    /// Writes the time gathered since the last flush into this phone's `day` records.
    func flush() {
        let gathered = pending
        pending = [:]
        var any = false
        for (dayKind, seconds) in gathered {
            let parts = dayKind.split(separator: "|").map(String.init)
            guard parts.count == 2 else { continue }
            let key = "\(parts[0])|\(parts[1])|\(device)"
            let had = (json("day", key)?["seconds"] as? NSNumber)?.intValue ?? 0
            let total = had + Int(seconds.rounded(.down))
            // What's under a whole second waits for next time.
            let carry = seconds - seconds.rounded(.down)
            if carry > 0 { pending[dayKind, default: 0] += carry }
            guard total > had else { continue }
            let data: [String: Any] = ["day": parts[0], "kind": parts[1], "seconds": total, "device": device]
            let encoded = (try? JSONSerialization.data(withJSONObject: data, options: [.sortedKeys])) ?? Data()
            let id = SyncRecord.id("day", key)
            if let r = byId[id] {
                r.data = encoded
                r.changedAt = Self.nowMs()
                r.dirty = true
            } else {
                let r = SyncRecord(kind: "day", key: key, data: encoded, changedAt: Self.nowMs(), dirty: true)
                context.insert(r)
                byId[id] = r
            }
            any = true
        }
        if any { changed(soon: false) }
    }

    static func dayKey(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    // MARK: From the server

    /// The other devices' changes. One changed here since, and later, stays as it is and is sent.
    func apply(_ incoming: [SyncChange]) {
        guard !incoming.isEmpty else { return }
        for c in incoming {
            let id = SyncRecord.id(c.kind, c.key)
            let here = byId[id]
            if let here, here.dirty, here.changedAt > c.changedAt { continue }
            if c.deleted {
                if let here {
                    context.delete(here)
                    byId[id] = nil
                }
                continue
            }
            let data = (c.data.flatMap { try? JSONSerialization.data(withJSONObject: $0.value, options: [.sortedKeys]) }) ?? Data("{}".utf8)
            if let here {
                here.data = data
                here.changedAt = c.changedAt
                here.dirty = false
                here.deleted = false
            } else {
                let r = SyncRecord(kind: c.kind, key: c.key, data: data, changedAt: c.changedAt, dirty: false)
                context.insert(r)
                byId[id] = r
            }
        }
        changed(soon: false)
    }

    /// The server took these changes: they're no longer dirty, unless they changed again meanwhile.
    func sent(_ changes: [SyncChange]) {
        for c in changes {
            let id = SyncRecord.id(c.kind, c.key)
            guard let r = byId[id], r.changedAt == c.changedAt else { continue }
            if r.deleted {
                context.delete(r)
                byId[id] = nil
            } else {
                r.dirty = false
            }
        }
        try? context.save()
    }

    /// Everything is to be sent again (the server lost its copy).
    func markAllDirty() {
        for r in byId.values { r.dirty = true }
        try? context.save()
    }

    /// Another account signed in: what came from the old one goes; this phone's listening and days stay, to be sent.
    func startOver() {
        for (id, r) in byId {
            let mine = r.kind == "listen" || (r.kind == "day" && r.key.hasSuffix("|\(device)"))
            if mine {
                r.dirty = true
            } else {
                context.delete(r)
                byId[id] = nil
            }
        }
        changed(soon: false)
    }
}

/// One change, as `POST /v1/sync` sends and returns it.
nonisolated struct SyncChange: Codable, Sendable, Equatable {
    var kind: String
    var key: String
    var changedAt: Int64
    var deleted: Bool = false
    var data: AnyJSON?

    enum CodingKeys: String, CodingKey { case kind, key, changedAt, deleted, data }

    init(kind: String, key: String, changedAt: Int64, deleted: Bool = false, data: AnyJSON? = nil) {
        self.kind = kind
        self.key = key
        self.changedAt = changedAt
        self.deleted = deleted
        self.data = data
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(String.self, forKey: .kind)
        key = try c.decode(String.self, forKey: .key)
        changedAt = try c.decode(Int64.self, forKey: .changedAt)
        deleted = try c.decodeIfPresent(Bool.self, forKey: .deleted) ?? false
        data = try c.decodeIfPresent(AnyJSON.self, forKey: .data)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(kind, forKey: .kind)
        try c.encode(key, forKey: .key)
        try c.encode(changedAt, forKey: .changedAt)
        if deleted { try c.encode(true, forKey: .deleted) }
        try c.encodeIfPresent(data, forKey: .data)
    }
}

/// Any JSON value, carried through Codable as it is.
nonisolated struct AnyJSON: Codable, @unchecked Sendable, Equatable {
    let value: Any

    init(_ value: Any) { self.value = value }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        // Numbers before booleans: a decoder may read 0 and 1 as false and true.
        if c.decodeNil() { value = NSNull() }
        else if let i = try? c.decode(Int64.self) { value = i }
        else if let d = try? c.decode(Double.self) { value = d }
        else if let b = try? c.decode(Bool.self) { value = b }
        else if let s = try? c.decode(String.self) { value = s }
        else if let a = try? c.decode([AnyJSON].self) { value = a.map(\.value) }
        else { value = try c.decode([String: AnyJSON].self).mapValues(\.value) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case is NSNull: try c.encodeNil()
        // Numbers first: a Swift Bool, Int or Double is an NSNumber here, and 0 or 1 would otherwise pass for a Bool.
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { try c.encode(n.boolValue) }
            else if CFNumberIsFloatType(n) { try c.encode(n.doubleValue) }
            else { try c.encode(n.int64Value) }
        case let s as String: try c.encode(s)
        case let a as [Any]: try c.encode(a.map(AnyJSON.init))
        case let o as [String: Any]: try c.encode(o.mapValues(AnyJSON.init))
        default: try c.encodeNil()
        }
    }

    static func == (a: AnyJSON, b: AnyJSON) -> Bool {
        let e = JSONEncoder()
        e.outputFormatting = .sortedKeys
        return (try? e.encode(a)) == (try? e.encode(b))
    }
}
