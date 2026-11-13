import SwiftUI

/// The Review tab (design P11): words due today, words by level, the week.
struct ReviewView: View {
    @Environment(RecordStore.self) private var store
    @Environment(Account.self) private var account
    @Environment(AppUI.self) private var ui

    var body: some View {
        let words = store.words
        let now = Int(Date.now.timeIntervalSince1970)
        let today = Int(Calendar.current.startOfDay(for: .now).timeIntervalSince1970)
        let counts = PracticeRules.counts(words: words, reviews: store.reviews, now: now, today: today)
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                LargeTitle("Review")
                todayCard(words: words, counts: counts, now: now)
                if !words.isEmpty {
                    Block("Your words", trailing: { NavigationLink("My words", value: Route.words(nil)) }) {
                        LevelCells(words: words)
                    }
                }
                WeekBlock()
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
        }
        .canvas()
        .toolbar(.hidden, for: .navigationBar)
    }

    @ViewBuilder private func todayCard(words: [Word], counts: PracticeRules.Counts, now: Int) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if words.isEmpty {
                IconTile("laptopcomputer")
                Text(account.isSignedIn ? "No words yet" : "Your words come from the computer").font(Theme.display(19)).tracking(-0.3).foregroundStyle(Theme.ink)
                Text("Save words while you dictate on your computer. They come here with the sentence you heard them in, to review on the way.")
                    .font(Theme.text(14)).lineSpacing(3).foregroundStyle(Theme.inkSubtle)
                if !account.isSignedIn {
                    NavigationLink(value: Route.account) { Text("Sign in") }.buttonStyle(.eks(.primary))
                }
            } else {
                Text("Today").font(Theme.text(12, .medium)).tracking(0.3).foregroundStyle(Theme.inkSubtle)
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("\(counts.due)").font(Theme.display(40)).tracking(-1).foregroundStyle(Theme.ink)
                    Text("word\(counts.due == 1 ? "" : "s") due · \(counts.new) new").font(Theme.text(15)).foregroundStyle(Theme.inkSubtle)
                }
                .accessibilityElement(children: .combine)
                Text(counts.total > 0 ? "About \(max(1, Int((Double(min(counts.total, PracticeRules.perSession)) * 0.5).rounded()))) minutes. Each one plays the sentence you saved it from."
                     : nextText(words, now: now))
                    .font(Theme.text(13)).foregroundStyle(Theme.inkSubtle)
                Button("Start review") { ui.showReview = true }
                    .buttonStyle(.eks(.primary, block: true))
                    .disabled(counts.total == 0)
            }
        }
        .card()
    }

    private func nextText(_ words: [Word], now: Int) -> String {
        guard let next = words.filter({ $0.level != "new" }).compactMap(\.dueAt).filter({ $0 > now }).min() else {
            return "Nothing due today."
        }
        let date = Date(timeIntervalSince1970: TimeInterval(next))
        let n = words.filter { ($0.dueAt ?? 0) > now && Calendar.current.isDate(Date(timeIntervalSince1970: TimeInterval($0.dueAt ?? 0)), inSameDayAs: date) }.count
        return "Nothing due today. The next \(n) come\(n == 1 ? "s" : "") back \(Calendar.current.isDateInTomorrow(date) ? "tomorrow" : date.formatted(.dateTime.weekday(.wide)))."
    }
}

/// Words by level, each opening My words with that level.
struct LevelCells: View {
    let words: [Word]
    var body: some View {
        HStack(spacing: 1) {
            ForEach(Word.Level.allCases, id: \.self) { level in
                NavigationLink(value: Route.words(level)) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(words.filter { $0.level == level.rawValue }.count)").font(Theme.display(20)).tracking(-0.5).foregroundStyle(Theme.ink)
                        Text(level.label).font(Theme.text(12)).foregroundStyle(Theme.inkSubtle)
                    }
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Theme.surface1)
                }
                .buttonStyle(.plain)
            }
        }
        .background(Theme.hairline)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.hairline))
    }
}

/// The last seven days of practice on every device, and the streak.
struct WeekBlock: View {
    @Environment(RecordStore.self) private var store
    var body: some View {
        let byDay = Stats.secondsByDay(store.days)
        let days = Stats.lastDays(byDay)
        let peak = max(days.map(\.1).max() ?? 0, 600)
        let streak = Stats.streak(byDay)
        Block("This week", trailing: {
            Text("\(streak) day streak").font(Theme.mono(12)).foregroundStyle(Theme.inkSubtle)
        }) {
            VStack(spacing: 8) {
                HStack(alignment: .bottom, spacing: 8) {
                    ForEach(Array(days.enumerated()), id: \.offset) { i, d in
                        RoundedRectangle(cornerRadius: 3)
                            .fill(i == days.count - 1 ? Theme.ink : d.1 == 0 ? Theme.hairlineStrong : Theme.inkMuted)
                            .frame(height: max(4, 72 * CGFloat(d.1) / CGFloat(peak)))
                            .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 72, alignment: .bottom)
                HStack(spacing: 8) {
                    ForEach(Array(days.enumerated()), id: \.offset) { i, d in
                        Text(d.0.formatted(.dateTime.weekday(.narrow))).font(Theme.mono(11))
                            .foregroundStyle(i == days.count - 1 ? Theme.ink : Theme.inkSubtle).frame(maxWidth: .infinity)
                    }
                }
            }
            .card(padding: 16)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("This week: \(days.map { "\($0.0.formatted(.dateTime.weekday(.wide))) \(Stats.duration($0.1))" }.joined(separator: ", "))")
        }
    }
}

/// "1 day", "3 days", "2 mo".
func intervalText(_ seconds: Int) -> String {
    let days = Double(seconds) / 86400
    if days < 1 { return "\(max(1, seconds / 60)) min" }
    if days < 30 { let d = Int(days.rounded()); return "\(d) day\(d == 1 ? "" : "s")" }
    if days < 365 { return "\(Int((days / 30).rounded())) mo" }
    return "\(Int((days / 365).rounded())) yr"
}

/// A review session (design P12–P15): the sentence with a gap, then the answer and four grades; new words pick the
/// meaning from four.
struct ReviewSessionView: View {
    @Environment(RecordStore.self) private var store
    @Environment(ClipPlayer.self) private var clips
    @Environment(AppUI.self) private var ui
    @Environment(PlaybackCenter.self) private var center
    @Environment(\.dismiss) private var dismiss

    @State private var queue: [PracticeRules.Item] = []
    @State private var pos = 0
    @State private var showing = false
    @State private var picked: Int?
    @State private var shownAt = Date.now
    @State private var started = Date.now
    @State private var done = false
    @State private var loaded = false
    @State private var results: [(word: String, from: Word.Level, to: Word.Level, again: Bool)] = []
    @State private var againCount: [String: Int] = [:]
    @State private var slow = false

    private static let maxAgain = 2

    var body: some View {
        VStack(spacing: 0) {
            if done {
                NavBar(close: true, onBack: { dismiss() })
                DoneView(results: results, seconds: Int(Date.now.timeIntervalSince(started))) { listen in
                    dismiss()
                    if listen {
                        center.startMissed(MissedGroup.groups(store.missed).flatMap(\.items))
                        Task { try? await Task.sleep(for: .milliseconds(400)); ui.showMissed = true }
                    }
                }
            } else if let item = queue[safe: pos] {
                NavBar(title: "\(pos + 1) of \(queue.count)", close: true, onBack: end) {
                    Menu {
                        Button("I know this word", systemImage: "checkmark.seal") { know(item) }
                        Button("End the review", systemImage: "xmark") { end() }
                    } label: {
                        Image(systemName: "ellipsis").font(.system(size: 20)).foregroundStyle(Theme.ink).frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("More")
                }
                Track(value: Double(pos) / Double(max(queue.count, 1))).padding(.horizontal, 20)
                card(item).id(item.id)
            } else if loaded {
                NavBar(close: true, onBack: { dismiss() })
                VStack(alignment: .leading, spacing: 12) {
                    Text("Nothing to review now").font(Theme.display(24)).foregroundStyle(Theme.ink)
                    Text("Words come back here when they're due.").font(Theme.text(16)).foregroundStyle(Theme.inkSubtle)
                    Spacer()
                }
                .padding(24)
            }
        }
        .canvas()
        .onAppear(perform: load)
        .onDisappear { clips.stop() }
    }

    private func load() {
        guard !loaded else { return }
        var rng = SystemRandomNumberGenerator()
        let now = Int(Date.now.timeIntervalSince1970)
        queue = PracticeRules.queue(words: store.words, reviews: store.reviews, now: now,
                                    today: Int(Calendar.current.startOfDay(for: .now).timeIntervalSince1970), random: &rng)
        loaded = true
        started = .now
        cardShown()
    }

    private func cardShown() {
        shownAt = .now
        showing = false
        picked = nil
        if let item = queue[safe: pos] { clips.play(item.context, rate: slow ? 0.7 : 1) }
    }

    @ViewBuilder private func card(_ item: PracticeRules.Item) -> some View {
        let pick = item.mode == "pick"
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if pick {
                    pickCard(item)
                } else if showing {
                    answer(item)
                } else {
                    question(item)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20).padding(.top, 28).padding(.bottom, 24)
        }
        VStack(spacing: 10) {
            if pick {
                Button("Next") { grade(item, picked.map { item.choices[$0] == item.answer } == true ? 3 : 1, mode: "pick") }
                    .buttonStyle(.eks(.primary, block: true, height: 52))
                    .disabled(picked == nil)
            } else if showing {
                HStack(spacing: 8) {
                    ForEach(Array(["Again", "Hard", "Good", "Easy"].enumerated()), id: \.offset) { i, label in
                        Button { grade(item, i + 1, mode: "recall") } label: {
                            VStack(spacing: 5) {
                                Text(label).font(Theme.text(14, .medium)).foregroundStyle(Theme.ink)
                                Text(intervalText(item.next[i])).font(Theme.mono(11)).foregroundStyle(Theme.inkSubtle)
                            }
                            .frame(maxWidth: .infinity).frame(height: 56)
                            .background(i == 2 ? Theme.surface3 : Theme.surface2, in: RoundedRectangle(cornerRadius: 8))
                            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(i == 2 ? Theme.hairlineTertiary : Theme.hairlineStrong))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(label), back in \(intervalText(item.next[i]))")
                    }
                }
                Button("I know this word · don't ask for a year") { know(item) }.buttonStyle(.eks(.ghost, small: true, block: true))
            } else {
                Text("Say it to yourself, then check.").font(Theme.text(12)).foregroundStyle(Theme.inkSubtle).frame(maxWidth: .infinity)
                Button("Show the answer") {
                    showing = true
                    clips.stop()
                }
                .buttonStyle(.eks(.primary, block: true, height: 52))
            }
        }
        .padding(.horizontal, 20).padding(.bottom, 16).padding(.top, 8)
    }

    @ViewBuilder private func question(_ item: PracticeRules.Item) -> some View {
        if let gap = item.gap {
            Eyebrow(item.word.text.contains(" ") ? "Which words go in the gap?" : "Which word goes in the gap?")
            Text(MissedWordsText.attributed([("“" + gap[0], false), (String(repeating: "\u{2007}", count: max(5, gap[1].count * 2 / 3)), true),
                                             (gap[2] + "”", false)]))
                .font(Theme.display(22, .medium)).lineSpacing(6)
                .accessibilityLabel("\(gap[0]) blank \(gap[2])")
        } else {
            Eyebrow("What does it mean here?")
            Text(item.word.text).font(Theme.display(30)).tracking(-0.7).foregroundStyle(Theme.ink)
            Text("“\(item.context.sentence)”").font(Theme.text(16)).foregroundStyle(Theme.inkMuted)
        }
        playButtons(item)
        Text(source(item)).font(Theme.text(13)).foregroundStyle(Theme.inkSubtle)
    }

    @ViewBuilder private func playButtons(_ item: PracticeRules.Item) -> some View {
        if item.context.playable {
            HStack(spacing: 10) {
                Button { clips.play(item.context, rate: slow ? 0.7 : 1) } label: { Label("Play the sentence", systemImage: "speaker.wave.2") }
                    .buttonStyle(.eks(.secondary))
                Button {
                    slow.toggle()
                    clips.play(item.context, rate: slow ? 0.7 : 1)
                } label: { Text("0.7×") }
                    .buttonStyle(.eks(slow ? .secondary : .ghost))
                    .accessibilityLabel(slow ? "Normal speed" : "Slower")
            }
        } else {
            Note("This sentence is from your own audio on the computer, so it can't play here.")
        }
    }

    private func source(_ item: PracticeRules.Item) -> String {
        var parts: [String] = []
        if let t = item.context.title, !t.isEmpty { parts.append(t) }
        if item.word.addedAt > 0 { parts.append("saved on \(Date(timeIntervalSince1970: TimeInterval(item.word.addedAt)).formatted(.dateTime.day().month(.abbreviated)))") }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private func answer(_ item: PracticeRules.Item) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Text(item.word.text).font(Theme.display(30)).tracking(-0.7).foregroundStyle(Theme.ink)
                if !item.word.ipa.isEmpty { Text(item.word.ipa).font(Theme.mono(13)).foregroundStyle(Theme.inkSubtle) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            RoundButton(symbol: "speaker.wave.2", label: "Say the word", size: 44) { clips.say(item.word.text) }
        }
        MeaningBlock(word: item.word)
        if let gap = item.gap {
            Text(MissedWordsText.attributed([("“" + gap[0], false), (gap[1], true), (gap[2] + "”", false)], color: Theme.inkMuted))
                .font(Theme.text(16)).lineSpacing(4)
                .padding(.top, 16).overlay(alignment: .top) { Rectangle().fill(Theme.hairline).frame(height: 1) }
                .onTapGesture { clips.play(item.context, rate: slow ? 0.7 : 1) }
        }
        if !item.word.note.isEmpty {
            (Text("Your note: ").foregroundStyle(Theme.inkSubtle) + Text(item.word.note).foregroundStyle(Theme.inkMuted)).font(Theme.text(13))
        }
    }

    @ViewBuilder private func pickCard(_ item: PracticeRules.Item) -> some View {
        Eyebrow("New word · what does it mean here?")
        HStack(spacing: 10) {
            Text(item.word.text).font(Theme.display(30)).tracking(-0.7).foregroundStyle(Theme.ink).frame(maxWidth: .infinity, alignment: .leading)
            if item.context.playable {
                RoundButton(symbol: "speaker.wave.2", label: "Play the sentence", size: 44) { clips.play(item.context, rate: slow ? 0.7 : 1) }
            }
        }
        if let gap = item.gap {
            Text(MissedWordsText.attributed([("“" + (gap[0].count > 50 ? "…" + gap[0].suffix(40) : gap[0]), false), (gap[1], true),
                                             (gap[2] + "”", false)], color: Theme.inkMuted))
                .font(Theme.text(16)).lineSpacing(4)
        } else {
            Text("“\(item.context.sentence)”").font(Theme.text(16)).foregroundStyle(Theme.inkMuted)
        }
        VStack(spacing: 8) {
            ForEach(Array(item.choices.enumerated()), id: \.offset) { i, choice in
                let right = choice == item.answer
                let state: Int = picked == nil ? 0 : right ? 1 : picked == i ? 2 : 0
                Button {
                    guard picked == nil else { return }
                    picked = i
                } label: {
                    HStack(spacing: 10) {
                        if state == 1 { Image(systemName: "checkmark").foregroundStyle(Theme.success) }
                        if state == 2 { Image(systemName: "xmark").foregroundStyle(Theme.error) }
                        Text(choice).font(Theme.text(16)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 16).frame(minHeight: 54)
                    .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(state == 1 ? Theme.success : state == 2 ? Theme.error : Theme.hairlineStrong))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(choice + (state == 1 ? ", right" : state == 2 ? ", wrong" : ""))
            }
        }
        // The rest of the meaning, once picked.
        if picked != nil, !item.word.otherMeanings.isEmpty {
            Text(item.word.otherMeanings).font(Theme.text(14)).lineSpacing(2).foregroundStyle(Theme.inkSubtle)
        }
    }

    private func grade(_ item: PracticeRules.Item, _ g: Int, mode: String) {
        clips.stop()
        let from = item.word.level_
        let correct: Bool? = mode == "pick" ? (picked.map { item.choices[$0] == item.answer }) : nil
        let to = store.grade(item, grade: g, mode: mode, correct: correct,
                             typed: mode == "pick" ? picked.map { item.choices[$0] } ?? "" : "",
                             seconds: Int(Date.now.timeIntervalSince(shownAt)))
        results.removeAll { $0.word == item.word.text }
        results.append((item.word.text, from, to, g == 1))
        if g == 1, againCount[item.word.key, default: 0] < Self.maxAgain {
            // Missed: once more at the end of this session, as the word is now.
            againCount[item.word.key, default: 0] += 1
            var again = item
            if let w = store.word(item.word.key) {
                var rng = SystemRandomNumberGenerator()
                again = PracticeRules.item(w, all: store.words, now: Int(Date.now.timeIntervalSince1970), random: &rng) ?? item
            }
            queue.append(again)
        }
        advance()
    }

    private func know(_ item: PracticeRules.Item) {
        store.know(item)
        results.removeAll { $0.word == item.word.text }
        results.append((item.word.text, item.word.level_, .known, false))
        advance()
    }

    private func advance() {
        if pos + 1 >= queue.count {
            store.flush()
            done = true
        } else {
            pos += 1
            cardShown()
        }
    }

    private func end() {
        clips.stop()
        store.flush()
        if results.isEmpty { dismiss() } else { done = true }
    }
}

/// The meaning: the first line large, the rest under it.
struct MeaningBlock: View {
    let word: Word
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(word.firstMeaning.isEmpty ? "No meaning saved" : word.firstMeaning).font(Theme.text(17)).foregroundStyle(Theme.ink)
            if !word.otherMeanings.isEmpty {
                Text(word.otherMeanings).font(Theme.text(14)).lineSpacing(2).foregroundStyle(Theme.inkSubtle)
            }
        }
    }
}

/// Review done (design P15).
private struct DoneView: View {
    let results: [(word: String, from: Word.Level, to: Word.Level, again: Bool)]
    let seconds: Int
    var close: (_ listen: Bool) -> Void
    @Environment(RecordStore.self) private var store

    var body: some View {
        let again = results.filter(\.again).count
        let now = Int(Date.now.timeIntervalSince1970)
        let counts = PracticeRules.counts(words: store.words, reviews: store.reviews, now: now,
                                          today: Int(Calendar.current.startOfDay(for: .now).timeIntervalSince1970))
        let tomorrow = Int(Calendar.current.startOfDay(for: .now.addingTimeInterval(86400)).timeIntervalSince1970) + 86400
        let next = store.words.filter { ($0.dueAt ?? 0) > now && ($0.dueAt ?? 0) <= tomorrow && $0.level != "new" }.count
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Image(systemName: "checkmark").font(.system(size: 24, weight: .medium)).foregroundStyle(Theme.success)
                        .frame(width: 56, height: 56).background(Theme.surface2, in: Circle()).overlay(Circle().strokeBorder(Theme.hairlineStrong))
                    VStack(alignment: .leading, spacing: 10) {
                        Text("\(results.count) word\(results.count == 1 ? "" : "s") reviewed").font(Theme.display(30)).tracking(-0.8).foregroundStyle(Theme.ink)
                        Text(counts.total > 0 ? "\(counts.total) more \(counts.total == 1 ? "is" : "are") waiting for another session."
                             : next > 0 ? "Nothing else is due today. The next \(next) come\(next == 1 ? "s" : "") back tomorrow." : "Nothing else is due today.")
                            .font(Theme.text(16)).foregroundStyle(Theme.inkSubtle)
                    }
                    Cells(items: [("\(results.count - again)", "Remembered"), ("\(again)", "Again"), (Stats.short(seconds), "Time")])
                    RowGroup {
                        ForEach(results.prefix(8), id: \.word) { r in
                            Row(r.word, subtitle: r.again ? "Again · back tomorrow" : r.from == r.to ? r.to.label : "\(r.from.label) → \(r.to.label)")
                        }
                    }
                }
                .padding(.horizontal, 24).padding(.top, 24).padding(.bottom, 24)
            }
            VStack(spacing: 8) {
                Button("Done") { close(false) }.buttonStyle(.eks(.primary, block: true, height: 52))
                if !store.missed.isEmpty {
                    Button("Listen to the missed sentences") { close(true) }.buttonStyle(.eks(.ghost, block: true))
                }
            }
            .padding(.horizontal, 24).padding(.bottom, 16)
        }
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
