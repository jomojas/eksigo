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
            .frame(height: 44)
            .clipShape(RoundedRectangle(cornerRadius: 8))

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
        VStack(alignment: .leading, spacing: 28) {
            Text("Eksigo").font(Theme.display(17)).tracking(-0.3).foregroundStyle(Theme.ink)
            VStack(alignment: .leading, spacing: 14) {
                Text("Your practice,\non the way to work").font(Theme.display(34)).tracking(-1).foregroundStyle(Theme.ink)
                Text("Dictate on your computer. Then, on your phone, hear the sentences you missed, review your words and keep listening.")
                    .font(Theme.text(16)).lineSpacing(4).foregroundStyle(Theme.inkSubtle)
            }
            RowGroup {
                Row(title: "Last night's missed sentences", subtitle: "Played back to back, with what you typed",
                    leading: { IconTile("headphones") }, trailing: { EmptyView() })
                Row(title: "Words due today", subtitle: "Each with the sentence you saved it from",
                    leading: { IconTile("rectangle.stack") }, trailing: { EmptyView() })
                Row(title: "Podcasts to listen to", subtitle: "What you hear here shows up on the computer",
                    leading: { IconTile("safari") }, trailing: { EmptyView() })
            }
            Spacer(minLength: 0)
            VStack(spacing: 10) {
                Text("Sign in with the account you use on the computer.").font(Theme.text(12)).foregroundStyle(Theme.inkSubtle)
                SignInButtons(error: $error) { ui.welcomed = true }
                Button("Not now, just listen") { ui.welcomed = true }.buttonStyle(.eks(.ghost, block: true))
                if let error { Text(error).font(Theme.text(12)).foregroundStyle(Theme.error) }
            }
        }
        .padding(.horizontal, 24).padding(.top, 28).padding(.bottom, 16)
        .canvas()
    }
}
