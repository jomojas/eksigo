import SwiftUI

/// The Me tab (design P16): the account and sync, the week in figures, and the pages about you.
struct MeView: View {
    @Environment(RecordStore.self) private var store
    @Environment(Account.self) private var account
    @Environment(Syncer.self) private var syncer
    @Environment(PlaybackCenter.self) private var center

    var body: some View {
        let byDay = Stats.secondsByDay(store.days)
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                NavigationLink(value: Route.account) {
                    HStack(spacing: 12) {
                        Avatar(letter: account.isSignedIn ? account.initial : nil, size: 56)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(account.isSignedIn ? account.displayName : "Sign in to sync").font(Theme.text(20, .semibold)).foregroundStyle(Theme.ink)
                            SyncLine()
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.inkTertiary)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 14).card(padding: 0)
                }
                .buttonStyle(.plain)
                Cells(items: [("\(Stats.streak(byDay))", "Day streak"), (Stats.short(Stats.thisWeek(byDay)), "This week"), ("\(store.words.count)", "Words")])
                RowGroup {
                    NavigationLink(value: Route.words(nil)) {
                        Row(title: "My words", chevron: true, leading: { IconTile("text.book.closed", color: Color(uiColor: .systemOrange)) }, trailing: { RowValue("\(store.words.count)") })
                    }
                    NavigationLink(value: Route.history) {
                        Row(title: "History", chevron: true, leading: { IconTile("clock", color: Theme.primary) }, trailing: { EmptyView() })
                    }
                    NavigationLink(value: Route.progress) {
                        Row(title: "Progress", chevron: true, leading: { IconTile("chart.bar.fill", color: Color(uiColor: .systemGreen)) }, trailing: { EmptyView() })
                    }
                    NavigationLink(value: Route.downloads) {
                        Row(title: "Downloads", chevron: true, leading: { IconTile("arrow.down", color: Color(uiColor: .systemBlue)) }, trailing: {
                            RowValue(center.downloadedText)
                        })
                    }
                }
                .buttonStyle(.plain)
                RowGroup {
                    NavigationLink(value: Route.settings) {
                        Row(title: "Settings", chevron: true, leading: { IconTile("gearshape.fill") }, trailing: { EmptyView() })
                    }
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 24)
        }
        .canvas()
        .navigationTitle("Me")
    }
}

struct Avatar: View {
    let letter: String?
    var size: CGFloat = 44
    var body: some View {
        Group {
            if let letter {
                Text(letter).font(Theme.display(size * 0.4, .semibold)).foregroundStyle(.white)
            } else {
                Image(systemName: "person.fill").font(.system(size: size * 0.42)).foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .background(LinearGradient(colors: letter == nil ? [Color(uiColor: .systemGray2), Color(uiColor: .systemGray)] : [Color(hex: 0x5E5CE6), Color(hex: 0xBF5AF2)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing), in: Circle())
        .accessibilityHidden(true)
    }
}

/// "Synced 2 minutes ago", with its dot.
struct SyncLine: View {
    @Environment(Syncer.self) private var syncer
    @Environment(Account.self) private var account

    var body: some View {
        HStack(spacing: 6) {
            switch syncer.shown {
            case .off:
                Text("Bring your words from the computer")
            case .syncing:
                ProgressView().controlSize(.mini)
                Text(syncer.first ? "Adding this phone to your account…" : "Syncing…")
            case .failed:
                Dot(color: Theme.error)
                Text(syncer.last.map { "Last synced \($0.agoText)" } ?? "Not synced yet")
            case .synced:
                Dot(color: Theme.success)
                Text(syncer.last.map { "Synced \($0.agoText)" } ?? "Synced")
            }
        }
        .font(Theme.text(13)).foregroundStyle(Theme.inkSubtle).lineLimit(1)
    }
}

/// Account and sync (design P22); signed out, the ways to sign in.
struct AccountView: View {
    @Environment(Account.self) private var account
    @Environment(Syncer.self) private var syncer
    @Environment(RecordStore.self) private var store
    @State private var confirmDelete = false
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        Page(title: "Account and sync") {
            if account.isSignedIn {
                VStack(spacing: 10) {
                    Avatar(letter: account.initial, size: 72)
                    VStack(spacing: 4) {
                        Text(account.displayName).font(Theme.display(20)).tracking(-0.3).foregroundStyle(Theme.ink)
                        Text([account.user?.email, account.providerName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(Theme.text(14)).foregroundStyle(Theme.inkSubtle)
                    }
                    .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 8)
                RowGroup {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Sync").font(Theme.text(15, .medium)).foregroundStyle(Theme.ink)
                            SyncLine()
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Button(syncer.shown.isFailed ? "Try now" : "Sync now") { syncer.now() }
                            .buttonStyle(.eks(.secondary, small: true))
                            .disabled(syncer.shown == .syncing)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    Row("On this account", subtitle: counts)
                }
                if case .failed(let message) = syncer.shown { Note(message) }
                Note("Sync runs by itself when the app opens and after you listen or review. Audio stays on each device.")
                RowGroup {
                    Button {
                        Task { await account.signOut() }
                    } label: {
                        Row("Sign out", subtitle: "Words and history stay on this phone")
                    }
                    .buttonStyle(.plain)
                    Button { confirmDelete = true } label: {
                        Row("Delete account", subtitle: "Removes it from the server and every device", titleColor: Theme.error)
                    }
                    .buttonStyle(.plain)
                }
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Sign in with the account you use on the computer").font(Theme.display(22)).tracking(-0.4).foregroundStyle(Theme.ink)
                    Text("Your saved words, missed sentences and practice come over, and what you hear here shows up on the computer's Today. Listening needs no account.")
                        .font(Theme.text(15)).lineSpacing(3).foregroundStyle(Theme.inkSubtle)
                }
                SignInButtons(error: $error)
            }
            if let error { Note(error).foregroundStyle(Theme.error) }
        }
        .confirmationDialog("Delete your account?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete account", role: .destructive) {
                Task {
                    do { try await account.deleteAccount() } catch { self.error = error.localizedDescription }
                }
            }
        } message: {
            Text("Your words, practice and listening are removed from the server and from sync on every device. What's on this phone stays here.")
        }
    }

    private var counts: String {
        let days = Set(store.days.filter { $0.seconds > 0 }.map(\.day)).count
        let episodes = Set(store.practices.map(\.audioUrl)).union(store.listens.map(\.audioUrl)).count
        return "\(plural(store.words.count, "word")) · \(plural(days, "practice day")) · \(plural(episodes, "episode"))"
    }
}

extension Syncer.State {
    var isFailed: Bool { if case .failed = self { true } else { false } }
}
