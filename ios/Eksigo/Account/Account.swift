import AuthenticationServices
import CryptoKit
import Foundation
import Security
import SwiftUI

/// The optional account (DESIGN.md section 8): the same Apple or Google account as on the computer, only for sync.
/// The server gives back an opaque token, kept in the Keychain.
@Observable
final class Account {
    private(set) var user: API.User?
    var isSignedIn: Bool { user != nil }
    var token: String? { Keychain.token }

    /// Called once a sign-in finishes, to sync at once.
    @ObservationIgnored var onSignIn: (() -> Void)?

    /// The raw nonce of the sign-in in progress; Apple gets its SHA-256.
    @ObservationIgnored private var nonce: String?

    init() { restore() }

    private func restore() {
        if Keychain.token != nil, let data = UserDefaults.standard.data(forKey: "accountUser"),
           let saved = try? JSONDecoder().decode(API.User.self, from: data) {
            user = saved
        }
    }

    /// Checks the session is still valid (the account may have been deleted on another device).
    func refresh() async {
        if user == nil { restore() }
        guard let token = Keychain.token else { return }
        do {
            set(try await API.shared.me(token: token))
        } catch let e as APIError where e.signedOut {
            forget()
        } catch {}
    }

    // MARK: Sign in with Apple

    func prepare(_ request: ASAuthorizationAppleIDRequest) {
        let raw = (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
        nonce = raw
        request.requestedScopes = [.fullName, .email]
        request.nonce = SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func complete(_ result: Result<ASAuthorization, Error>) async throws {
        let authorization = try result.get()
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken, let token = String(data: tokenData, encoding: .utf8) else {
            throw APIError(status: 0, message: "Apple didn't return a sign-in token.")
        }
        let name = credential.fullName.map { PersonNameComponentsFormatter.localizedString(from: $0, style: .default) }
        let session = try await API.shared.signInWithApple(identityToken: token, nonce: nonce, name: name?.isEmpty == true ? nil : name)
        nonce = nil
        start(session)
    }

    // MARK: Sign in with Google

    /// Google's page in a browser sheet (no Google SDK): OAuth with PKCE, then the ID token goes to the server.
    func signInWithGoogle(using session: WebAuthenticationSession) async throws {
        guard let google = GoogleSignIn() else { throw APIError(status: 0, message: "Google sign-in isn't set up yet.") }
        let code = try await session.authenticate(using: google.authorizeURL, callbackURLScheme: google.scheme,
                                                  preferredBrowserSession: .ephemeral)
        let idToken = try await google.idToken(from: code)
        start(try await API.shared.signInWithGoogle(idToken: idToken))
    }

    #if DEBUG
    /// Local development only: the server runs with EKSIGO_DEV_LOGIN=1 (ios/scripts/local-server.sh).
    func devSignIn() async throws {
        start(try await API.shared.devSignIn(name: "Simulator"))
    }
    #endif

    /// Signs out here; words and history stay on this phone.
    func signOut() async {
        if let token = Keychain.token { try? await API.shared.signOut(token: token) }
        forget()
    }

    func deleteAccount() async throws {
        guard let token = Keychain.token else { return forget() }
        try await API.shared.deleteAccount(token: token)
        forget()
    }

    // MARK: Storage

    private func start(_ session: API.Session) {
        Keychain.token = session.token
        set(session.user)
        onSignIn?()
    }

    private func set(_ user: API.User) {
        self.user = user
        UserDefaults.standard.set(try? JSONEncoder().encode(user), forKey: "accountUser")
    }

    func forget() {
        Keychain.token = nil
        user = nil
        UserDefaults.standard.removeObject(forKey: "accountUser")
    }

    var initial: String { String((user?.name?.trimmingCharacters(in: .whitespaces).first ?? user?.email?.first ?? "E")).uppercased() }
    var displayName: String {
        if let n = user?.name, !n.trimmingCharacters(in: .whitespaces).isEmpty { return n }
        return user?.email ?? "Your account"
    }
    var providerName: String {
        switch user?.provider {
        case "apple": "Apple"
        case "google": "Google"
        case "dev": "Developer"
        default: ""
        }
    }
}

/// The session token, in the Keychain (this device only, readable after the first unlock so background requests work).
nonisolated enum Keychain {
    private static let service = "com.eksigo.app.session"
    private static let lock = NSLock()
    nonisolated(unsafe) private static var cached: String??

    static var token: String? {
        get {
            lock.lock(); defer { lock.unlock() }
            if let cached { return cached }
            var item: CFTypeRef?
            let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                        kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
            let status = SecItemCopyMatching(query as CFDictionary, &item)
            let value = status == errSecSuccess ? (item as? Data).flatMap { String(data: $0, encoding: .utf8) } : nil
            // Only a definite answer is remembered: a read that fails (the keychain not ready yet at launch) is tried again.
            if status == errSecSuccess || status == errSecItemNotFound { cached = .some(value) }
            return value
        }
        set {
            lock.lock(); defer { lock.unlock() }
            let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
            SecItemDelete(query as CFDictionary)
            if let newValue {
                var add = query
                add[kSecValueData as String] = Data(newValue.utf8)
                add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                SecItemAdd(add as CFDictionary, nil)
            }
            cached = .some(newValue)
        }
    }
}
