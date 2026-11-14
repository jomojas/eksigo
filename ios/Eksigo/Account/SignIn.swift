import AuthenticationServices
import SwiftUI

/// Continue with Apple, Continue with Google (and, in debug builds, the local server's developer sign-in).
struct SignInButtons: View {
    @Binding var error: String?
    var done: () -> Void = {}
    @Environment(Account.self) private var account
    @Environment(\.webAuthenticationSession) private var webSession
    @Environment(\.colorScheme) private var scheme
    @State private var busy = false

    var body: some View {
        VStack(spacing: 10) {
            SignInWithAppleButton(.continue) { request in
                account.prepare(request)
            } onCompletion: { result in
                Task { await run { try await account.complete(result) } }
            }
            .signInWithAppleButtonStyle(scheme == .dark ? .white : .black)
            .frame(height: 50)
            .clipShape(Capsule())

            Button {
                Task { await run { try await account.signInWithGoogle(using: webSession) } }
            } label: {
                HStack(spacing: 8) {
                    Image("GoogleG").resizable().frame(width: 17, height: 17)
                    Text("Continue with Google")
                }
            }
            .buttonStyle(.eks(.secondary, block: true))

            #if DEBUG
            Button("Developer sign-in (local server)") {
                Task { await run { try await account.devSignIn() } }
            }
            .buttonStyle(.eks(.ghost, small: true, block: true))
            #endif
        }
        .disabled(busy)
        .overlay { if busy { ProgressView() } }
    }

    private func run(_ work: () async throws -> Void) async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await work()
            done()
        } catch let e as ASAuthorizationError where e.code == .canceled {
        } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// First launch (design P01): what the app does, then sign in or just listen.
struct WelcomeView: View {
    @Environment(AppUI.self) private var ui
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            CoverFan().frame(maxWidth: .infinity).padding(.top, 12)
            VStack(alignment: .leading, spacing: 12) {
                Text("Listen, then hear\nwhat you missed.").font(Theme.display(34)).foregroundStyle(Theme.ink)
                Text("Dictate on your computer. Then, on your phone, hear the sentences you missed, review your words and keep listening.")
                    .font(Theme.text(17)).lineSpacing(2).foregroundStyle(Theme.inkSubtle)
            }
            VStack(alignment: .leading, spacing: 12) {
                welcomeLine("ear", Theme.missedInk, "Last night's missed sentences, back to back")
                welcomeLine("rectangle.stack.fill", Color(uiColor: .systemOrange), "Words due today, each with its sentence")
                welcomeLine("safari.fill", Color(uiColor: .systemBlue), "Podcasts for learners")
            }
            Spacer(minLength: 0)
            VStack(spacing: 10) {
                Text("Sign in with the account you use on the computer.").font(Theme.text(13)).foregroundStyle(Theme.inkSubtle)
                SignInButtons(error: $error) { ui.welcomed = true }
                Button("Not now, just listen") { ui.welcomed = true }.buttonStyle(.eks(.ghost, block: true, height: 44))
                if let error { Text(error).font(Theme.text(13)).foregroundStyle(Theme.error) }
            }
        }
        .padding(.horizontal, 24).padding(.top, 8).padding(.bottom, 16)
        .canvas()
    }

    private func welcomeLine(_ symbol: String, _ color: Color, _ text: String) -> some View {
        HStack(spacing: 12) {
            IconTile(symbol, color: color)
            Text(text).font(Theme.text(16)).foregroundStyle(Theme.ink)
        }
    }
}

/// A fan of covers from the shows for learners, on the first screen.
private struct CoverFan: View {
    private let covers = Directory.forLearners().prefix(5).map(\.artworkUrl)
    private let spots: [(x: CGFloat, y: CGFloat, angle: Double, size: CGFloat)] = [(-120, 14, -9, 104), (-60, -6, -4, 116), (0, -14, 0, 128), (60, -6, 4, 116), (120, 14, 9, 104)]

    var body: some View {
        ZStack {
            ForEach(Array(zip(covers.indices, covers)), id: \.0) { i, url in
                let s = spots[i]
                Artwork(url: url, size: s.size, radius: 16)
                    .shadow(color: .black.opacity(0.18), radius: 12, y: 8)
                    .rotationEffect(.degrees(s.angle))
                    .offset(x: s.x, y: s.y)
                    .zIndex(i == 2 ? 3 : i == 1 || i == 3 ? 2 : 1)
            }
        }
        .frame(height: 170)
        .accessibilityHidden(true)
    }
}
