import SwiftUI

/// My words (design P17): search, filter by level or due.
struct WordsView: View {
    var initial: Word.Level?
    @Environment(RecordStore.self) private var store
    @State private var search = ""
    @State private var filter = "all"

    init(initial: Word.Level?) {
        self.initial = initial
        _filter = State(initialValue: initial?.rawValue ?? "all")
    }

    var body: some View {
        let now = Int(Date.now.timeIntervalSince1970)
        let words = store.words
        let due = words.filter { $0.level != "new" && ($0.dueAt ?? 0) <= now }
        let shown = (filter == "all" ? words : filter == "due" ? due : words.filter { $0.level == filter })
            .filter { search.isEmpty || $0.text.localizedCaseInsensitiveContains(search) || $0.meaning.localizedCaseInsensitiveContains(search) }
        Page(title: "My words") {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.inkSubtle)
                TextField("Search \(words.count) words", text: $search).autocorrectionDisabled().textInputAutocapitalization(.never)
            }
            .font(Theme.text(15))
            .padding(.horizontal, 12).frame(height: 40)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.hairline))
            ChipRow(items: [("all", "All"), ("due", "Due \(due.count)")] + Word.Level.allCases.map {
                l in (l.rawValue, "\(l.label) \(words.filter { $0.level == l.rawValue }.count)")
            }, selection: $filter)
            if words.isEmpty {
                Note("Words you save while dictating on your computer come here once you sign in with the same account.")
            } else if shown.isEmpty {
                Note("No words here.")
            } else {
                RowGroup {
                    ForEach(shown) { w in
                        NavigationLink(value: Route.word(w.key)) {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(w.text).font(Theme.text(15, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                                    Text(w.firstMeaning).font(Theme.text(13)).foregroundStyle(Theme.inkSubtle).lineLimit(1)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                VStack(alignment: .trailing, spacing: 3) {
                                    Text(w.level_.label).font(Theme.text(13)).foregroundStyle(Theme.inkMuted)
                                    Text(dueText(w, now: now)).font(Theme.mono(11)).foregroundStyle(Theme.inkSubtle)
                                }
                            }
                            .padding(.horizontal, 12).padding(.vertical, 10).frame(minHeight: 52).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

extension String {
    /// The first letter in capitals, the rest as it is.
    var capFirst: String { prefix(1).uppercased() + dropFirst() }
}

/// "today", "tomorrow", "in 9 days", "in 5 mo", "—" for a new word.
func dueText(_ w: Word, now: Int = Int(Date.now.timeIntervalSince1970)) -> String {
    guard w.level != "new", let due = w.dueAt else { return "—" }
    if due <= now { return "today" }
    let date = Date(timeIntervalSince1970: TimeInterval(due))
    if Calendar.current.isDateInToday(date) { return "today" }
    if Calendar.current.isDateInTomorrow(date) { return "tomorrow" }
    let days = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: .now), to: Calendar.current.startOfDay(for: date)).day ?? 0
    return days < 60 ? "in \(days) days" : days < 365 ? "in \(days / 30) mo" : "in \(days / 365) yr"
}

/// A word (design P18): meaning, note, its sentences to play.
struct WordView: View {
    let key: String
    @Environment(RecordStore.self) private var store
    @Environment(ClipPlayer.self) private var clips

    var body: some View {
        if let w = store.word(key) {
            let reviews = store.reviews.filter { Word.key($0.word) == key }.count
            Page {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(w.text).font(Theme.display(30)).tracking(-0.7).foregroundStyle(Theme.ink)
                        let sub = [w.ipa, w.headword.lowercased() != w.text.lowercased() ? w.headword : ""].filter { !$0.isEmpty }
                        if !sub.isEmpty { Text(sub.joined(separator: " · ")).font(Theme.mono(13)).foregroundStyle(Theme.inkSubtle) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    RoundButton(symbol: "speaker.wave.2", label: "Say the word", size: 44) { clips.say(w.text) }
                }
                MeaningBlock(word: w)
                HStack(spacing: 1) {
                    fact(w.level_.label, "Level")
                    fact(dueText(w).capFirst, "Next review")
                    fact("\(reviews)", "Reviews")
                }
                .background(Theme.hairline).clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.hairline))
                if !w.note.isEmpty {
                    Block("Your note") {
                        Text(w.note).font(Theme.text(15)).foregroundStyle(Theme.inkMuted).card(padding: 14)
                    }
                }
                if !w.explanation.isEmpty {
                    Block("Explained") {
                        Text(w.explanation).font(Theme.text(14)).lineSpacing(3).foregroundStyle(Theme.inkMuted).card(padding: 14)
                    }
                }
                Block("Heard in · \(w.contexts.count) sentence\(w.contexts.count == 1 ? "" : "s")") {
                    RowGroup {
                        ForEach(w.contexts, id: \.self) { c in
                            let id = "\(c.audioUrl ?? "")|\(c.idx)"
                            HStack(alignment: .top, spacing: 12) {
                                if c.playable {
                                    RoundButton(symbol: clips.playing == id ? "stop.fill" : "play.fill", label: clips.playing == id ? "Stop" : "Play") {
                                        clips.playing == id ? clips.stop() : clips.play(c)
                                    }
                                } else {
                                    Image(systemName: "textformat").foregroundStyle(Theme.inkSubtle).frame(width: 44, height: 44)
                                        .accessibilityLabel("Text only")
                                }
                                VStack(alignment: .leading, spacing: 2) {
                                    let parts = PracticeRules.split(c.sentence, w.text)
                                    Text(MissedWordsText.attributed(parts.map { [("“" + $0[0], false), ($0[1], true), ($0[2] + "”", false)] }
                                                                    ?? [("“\(c.sentence)”", false)]))
                                        .font(Theme.text(15)).lineSpacing(3)
                                    Text([c.title, c.playable ? Stats.clock(Double(c.sentenceStartMs) / 1000) : nil].compactMap { $0 }.joined(separator: " · "))
                                        .font(Theme.text(13)).foregroundStyle(Theme.inkSubtle).lineLimit(1)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(12)
                        }
                    }
                }
            }
            .onDisappear { clips.stop() }
        } else {
            Page { Note("This word is no longer in My words.") }
        }
    }

    private func fact(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(value).font(Theme.display(16)).foregroundStyle(Theme.ink).lineLimit(1).minimumScaleFactor(0.7)
            Text(label).font(Theme.text(12)).foregroundStyle(Theme.inkSubtle)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Theme.surface1)
    }
}

/// History (design P19): listening on this phone and dictation on the computer, by day.
struct HistoryView: View {
    @Environment(RecordStore.self) private var store
    @State private var filter = 0

    struct Entry: Identifiable {
        let id: String
        let date: Date
        let title: String
        let detail: String
        let phone: Bool
        let artwork: URL?
        let episode: PodcastEpisode?
    }

    var body: some View {
        let byDay = Stats.secondsByDay(store.days)
        let entries = (filter == 2 ? [] : listens) + (filter == 1 ? [] : dictations)
        let days = Dictionary(grouping: entries) { Calendar.current.startOfDay(for: $0.date) }.sorted { $0.key > $1.key }
        Page(title: "History") {
            Segmented(items: [(0, "All"), (1, "Listened"), (2, "Dictated")], selection: $filter, label: "Show")
            if days.isEmpty {
                Note("What you listen to here and dictate on the computer shows up here, day by day.")
            }
            ForEach(days, id: \.key) { day, items in
                Block(dayTitle(day), trailing: {
                    Text(Stats.duration(byDay[Stats.key(day)] ?? 0)).font(Theme.mono(12)).foregroundStyle(Theme.inkSubtle)
                }) {
                    RowGroup {
                        ForEach(items.sorted { $0.date > $1.date }) { e in
                            let row = Row(title: e.title, subtitle: e.detail,
                                          leading: { Artwork(url: e.artwork, size: 40) },
                                          trailing: {
                                              Image(systemName: e.phone ? "iphone" : "laptopcomputer").foregroundStyle(Theme.inkSubtle)
                                                  .accessibilityLabel(e.phone ? "On this phone" : "On the computer")
                                          })
                            if let ep = e.episode {
                                NavigationLink(value: ep) { row }.buttonStyle(.plain)
                            } else {
                                row
                            }
                        }
                    }
                }
            }
        }
    }

    private var listens: [Entry] {
        store.listens.map { l in
            let date = Date(timeIntervalSince1970: TimeInterval(l.listenedAt) / 1000)
            let detail = l.finished || (l.durationS > 0 && l.positionS / l.durationS > 0.97)
                ? "Listened · all \(Stats.length(l.durationS))"
                : l.durationS > 0 ? "Listened · \(Int(l.positionS / 60)) of \(Int((l.durationS / 60).rounded())) min" : "Listened"
            return Entry(id: "l" + l.audioUrl, date: date, title: l.episode, detail: "\(detail) · \(date.formatted(date: .omitted, time: .shortened))",
                         phone: true, artwork: l.artworkUrl.flatMap(URL.init(string:)), episode: l.ref.episodeValue)
        }
    }

    private var dictations: [Entry] {
        store.practices.map { p in
            let date = Date(timeIntervalSince1970: TimeInterval(p.updatedAt))
            var parts = ["Dictated", p.answered >= p.sentences ? "\(p.sentences) sentences" : "\(p.answered) of \(p.sentences) sentences"]
            if p.answered > 0 { parts.append("\(Int((Double(p.accuracy) / 10).rounded()))%") }
            parts.append(Stats.duration(p.seconds))
            return Entry(id: "p\(p.audioUrl)|\(p.startedAt)", date: date, title: p.episode, detail: parts.joined(separator: " · "),
                         phone: false, artwork: p.artworkUrl.flatMap(URL.init(string:)), episode: p.ref.episodeValue)
        }
    }

    private func dayTitle(_ d: Date) -> String {
        if Calendar.current.isDateInToday(d) { return "Today" }
        if Calendar.current.isDateInYesterday(d) { return "Yesterday" }
        return d.formatted(.dateTime.weekday(.wide).day().month(.abbreviated))
    }
}

/// Progress (design P20): streak, time per week, accuracy in dictation, words by level.
struct ProgressPage: View {
    @Environment(RecordStore.self) private var store

    var body: some View {
        let byDay = Stats.secondsByDay(store.days)
        let weeks = Stats.weeks(byDay)
        let peak = max(weeks.max() ?? 0, 1800)
        let total = byDay.values.reduce(0, +)
        let finished = store.practices.filter { $0.answered > 0 }.sorted { $0.updatedAt < $1.updatedAt }.suffix(8)
        Page(title: "Progress") {
            Cells(items: [("\(Stats.streak(byDay)) day\(Stats.streak(byDay) == 1 ? "" : "s")", "Streak · best \(Stats.bestStreak(byDay))"),
                          (Stats.short(total), "Practised in all")])
            Block("Time per week", trailing: {
                Text("\(Stats.duration(weeks.last ?? 0)) this week").font(Theme.mono(12)).foregroundStyle(Theme.inkSubtle)
            }) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .bottom, spacing: 8) {
                        ForEach(Array(weeks.enumerated()), id: \.offset) { i, s in
                            RoundedRectangle(cornerRadius: 3).fill(i == weeks.count - 1 ? Theme.ink : Theme.inkMuted)
                                .frame(height: max(4, 90 * CGFloat(s) / CGFloat(peak))).frame(maxWidth: .infinity)
                        }
                    }
                    .frame(height: 90, alignment: .bottom)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Time per week for 8 weeks: \(weeks.map(Stats.duration).joined(separator: ", "))")
                    let week = thisWeekByKind()
                    HStack(spacing: 14) {
                        Text("Dictation \(Stats.duration(week["dictation"] ?? 0))")
                        Text("Listening \(Stats.duration(week["listening"] ?? 0))")
                        Text("Words \(Stats.duration(week["words"] ?? 0))")
                    }
                    .font(Theme.text(12)).foregroundStyle(Theme.inkSubtle).lineLimit(1).minimumScaleFactor(0.8)
                }
                .card()
            }
            if !finished.isEmpty {
                Block("Words right in dictation", trailing: {
                    Text("\(Int((Double(finished.last!.accuracy) / 10).rounded()))% last").font(Theme.mono(12)).foregroundStyle(Theme.inkSubtle)
                }) {
                    AccuracyLine(values: finished.map { Double($0.accuracy) / 10 }).frame(height: 76).card(padding: 14)
                }
            }
            Block("Words by level") {
                let counts = Word.Level.allCases.map { l in store.words.filter { $0.level == l.rawValue }.count }
                VStack(spacing: 10) {
                    GeometryReader { g in
                        let sum = max(counts.reduce(0, +), 1)
                        let fills = [Theme.hairlineStrong, Theme.inkTertiary, Theme.inkMuted, Theme.ink]
                        let gaps = CGFloat(counts.filter { $0 > 0 }.count - 1) * 2
                        HStack(spacing: 2) {
                            ForEach(Array(counts.enumerated()), id: \.offset) { i, n in
                                if n > 0 { Rectangle().fill(fills[i]).frame(width: max(2, (g.size.width - gaps) * CGFloat(n) / CGFloat(sum))) }
                            }
                        }
                        .clipShape(Capsule())
                    }
                    .frame(height: 10)
                    HStack {
                        ForEach(Array(Word.Level.allCases.enumerated()), id: \.offset) { i, l in
                            Text("\(l.label) \(counts[i])")
                            if i < 3 { Spacer() }
                        }
                    }
                    .font(Theme.text(12)).foregroundStyle(Theme.inkSubtle)
                }
                .card()
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Word.Level.allCases.enumerated().map { "\(counts[$0.offset]) \($0.element.rawValue)" }.joined(separator: ", "))
            }
        }
    }

    private func thisWeekByKind() -> [String: Int] {
        var out: [String: Int] = [:]
        for kind in ["dictation", "listening", "words"] {
            out[kind] = Stats.thisWeek(Stats.secondsByDay(store.days, kind: kind))
        }
        return out
    }
}

/// Accuracy over the last sessions: one line, the last point marked.
struct AccuracyLine: View {
    let values: [Double]
    var body: some View {
        GeometryReader { g in
            let lo = max(0, (values.min() ?? 0) - 5), hi = min(100, (values.max() ?? 100) + 5)
            let span = max(hi - lo, 1)
            let pts = values.enumerated().map { i, v in
                CGPoint(x: values.count == 1 ? g.size.width / 2 : 6 + (g.size.width - 12) * CGFloat(i) / CGFloat(values.count - 1),
                        y: (g.size.height - 6) - (g.size.height - 12) * CGFloat((v - lo) / span))
            }
            ZStack {
                Path { p in p.move(to: CGPoint(x: 0, y: g.size.height - 1)); p.addLine(to: CGPoint(x: g.size.width, y: g.size.height - 1)) }
                    .stroke(Theme.hairline, lineWidth: 1)
                Path { p in p.addLines(pts) }.stroke(Theme.inkMuted, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                if let last = pts.last {
                    Circle().fill(Theme.ink).frame(width: 8, height: 8).overlay(Circle().stroke(Theme.surface1, lineWidth: 2)).position(last)
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Accuracy over \(values.count) sessions, from \(Int(values.first ?? 0))% to \(Int(values.last ?? 0))%")
    }
}

/// Settings (design P21).
struct SettingsView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(PlaybackCenter.self) private var center

    var body: some View {
        @Bindable var s = settings
        Page(title: "Settings") {
            Block("Missed sentences") {
                RowGroup {
                    pickerRow("Play each", selection: $s.repeats, options: [(1, "Once"), (2, "Twice"), (3, "Three times")])
                    pickerRow("Show the text", selection: $s.showText, options: AppSettings.ShowText.allCases.map { ($0, $0.label) })
                    pickerRow("Pause between plays", selection: $s.gap, options: [(1.0, "1 s"), (2.0, "2 s"), (3.0, "3 s"), (5.0, "5 s")])
                }
            }
            Block("Playback") {
                RowGroup {
                    pickerRow("Speed", selection: $s.speed, options: AppSettings.speeds.map { ($0, $0.speedText) })
                    pickerRow("Skip back", selection: $s.skipBack, options: [(10.0, "10 s"), (15.0, "15 s"), (30.0, "30 s")])
                    pickerRow("Skip forward", selection: $s.skipForward, options: [(15.0, "15 s"), (30.0, "30 s"), (45.0, "45 s")])
                }
            }
            Block("Downloads") {
                RowGroup {
                    toggleRow("Get episodes with missed sentences", subtitle: "So they play without a connection", isOn: $s.downloadMissed)
                    toggleRow("Only on Wi-Fi", subtitle: nil, isOn: $s.wifiOnly)
                    NavigationLink(value: Route.downloads) {
                        Row(title: "Downloaded", subtitle: { let n = center.downloads().count; return "\(n) episode\(n == 1 ? "" : "s")" }(), chevron: true, leading: { EmptyView() }, trailing: {
                            RowValue(center.downloadedText)
                        })
                    }
                    .buttonStyle(.plain)
                }
            }
            Block("General") {
                RowGroup {
                    pickerRow("Appearance", selection: $s.appearance, options: AppSettings.Appearance.allCases.map { ($0, $0.label) })
                    Row("About Eksigo") { RowValue(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") }
                }
            }
        }
        .onChange(of: settings.downloadMissed) { center.downloadMissedEpisodes() }
    }

    private func pickerRow<V: Hashable>(_ title: String, selection: Binding<V>, options: [(V, String)]) -> some View {
        Menu {
            Picker(title, selection: selection) {
                ForEach(options, id: \.0) { Text($0.1).tag($0.0) }
            }
        } label: {
            Row(title, chevron: true) { RowValue(options.first { $0.0 == selection.wrappedValue }?.1 ?? "") }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(options.first { $0.0 == selection.wrappedValue }?.1 ?? "")")
    }

    private func toggleRow(_ title: String, subtitle: String?, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Theme.text(15, .medium)).foregroundStyle(Theme.ink)
                if let subtitle { Text(subtitle).font(Theme.text(13)).foregroundStyle(Theme.inkSubtle) }
            }
        }
        .tint(Theme.success)
        .padding(.horizontal, 12).padding(.vertical, 10).frame(minHeight: 52)
    }
}

/// Episodes downloaded on this phone; swipe to remove.
struct DownloadsView: View {
    @Environment(PlaybackCenter.self) private var center
    @State private var version = 0

    var body: some View {
        let items = center.downloads()
        List {
            if items.isEmpty {
                Text("Nothing downloaded. Episodes with missed sentences download by themselves on Wi-Fi.")
                    .font(Theme.text(14)).foregroundStyle(Theme.inkSubtle).listRowBackground(Theme.surface1)
            }
            ForEach(items, id: \.key) { r in
                if let e = r.episode {
                    NavigationLink(value: e) {
                        HStack(spacing: 12) {
                            Artwork(episode: e, size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.title).font(Theme.text(15, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                                Text([e.showTitle, r.fileBytes.map { ByteCountFormatter.string(fromByteCount: $0, countStyle: .file) }].compactMap { $0 }.joined(separator: " · "))
                                    .font(Theme.text(13)).foregroundStyle(Theme.inkSubtle).lineLimit(1)
                            }
                        }
                    }
                    .listRowBackground(Theme.surface1)
                    .swipeActions {
                        Button("Remove", role: .destructive) {
                            center.deleteDownload(e)
                            version += 1
                        }
                    }
                }
            }
        }
        .id(version)
        .scrollContentBackground(.hidden)
        .canvas()
        .navigationTitle("Downloads")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.canvas, for: .navigationBar)
    }
}
