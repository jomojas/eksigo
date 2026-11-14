import Foundation

/// The server (docs/API.md): accounts, sync and cover art. Listening needs none of it.
nonisolated struct API: Sendable {
    static let shared = API()

    /// From the `API_BASE_URL` build setting, via Info.plist (debug builds: `-apiBase <url>` overrides it).
    let root: URL = {
        var s = Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String ?? "https://api.eksigo.com"
        if s.isEmpty || s.hasPrefix("$(") { s = "https://api.eksigo.com" }
        #if DEBUG
        if let debug = UserDefaults.standard.string(forKey: "apiBase") { s = debug }
        #endif
        return URL(string: s)!
    }()

    var base: URL { root.appending(path: "v1") }

    /// A cover through the server's copy, which reaches image hosts blocked in some countries (`GET /v1/art`).
    func art(_ url: URL) -> URL {
        guard url.scheme?.hasPrefix("http") == true else { return url }
        var c = URLComponents(url: base.appending(path: "art"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "url", value: url.absoluteString)]
        return c.url ?? url
    }

    // MARK: Accounts

    struct User: Codable, Sendable, Equatable {
        let id: Int
        let name: String?
        let email: String?
        let plan: String?
        let provider: String?
    }

    struct Session: Decodable, Sendable {
        let token: String
        let user: User
    }

    func signInWithApple(identityToken: String, nonce: String?, name: String?) async throws -> Session {
        try await post("auth/apple", ["identity_token": identityToken, "nonce": nonce, "name": name], token: nil)
    }

    func signInWithGoogle(idToken: String) async throws -> Session {
        try await post("auth/google", ["id_token": idToken], token: nil)
    }

    #if DEBUG
    func devSignIn(name: String) async throws -> Session {
        try await post("auth/dev", ["name": name], token: nil)
    }
    #endif

    func me(token: String) async throws -> User {
        try decode(await send(request("me", token: token)))
    }

    func signOut(token: String) async throws {
        var r = request("auth/sign-out", token: token)
        r.httpMethod = "POST"
        _ = try await send(r)
    }

    func deleteAccount(token: String) async throws {
        var r = request("me", token: token)
        r.httpMethod = "DELETE"
        _ = try await send(r)
    }

    // MARK: Sync

    struct SyncAnswer: Decodable, Sendable {
        let cursor: Int64
        let changes: [SyncChange]
        let more: Bool
        let reset: Bool?
    }

    func sync(token: String, since: Int64, changes: [SyncChange]) async throws -> SyncAnswer {
        struct Body: Encodable { let since: Int64; let changes: [SyncChange] }
        var r = request("sync", token: token)
        r.httpMethod = "POST"
        r.timeoutInterval = 60
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONEncoder().encode(Body(since: since, changes: changes))
        return try decode(await send(r))
    }

    // MARK: Plumbing

    private func request(_ path: String, token: String?) -> URLRequest {
        var r = URLRequest(url: base.appending(path: path))
        r.setValue(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String, forHTTPHeaderField: "X-App-Version")
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return r
    }

    private func post<T: Decodable>(_ path: String, _ body: [String: String?], token: String?) async throws -> T {
        var r = request(path, token: token)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONSerialization.data(withJSONObject: body.compactMapValues { $0 })
        return try decode(await send(r))
    }

    private func send(_ r: URLRequest) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: r)
        try APIError.check(response, data)
        return data
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T { try JSONDecoder().decode(T.self, from: data) }
}

nonisolated struct APIError: LocalizedError {
    let status: Int
    let message: String
    var code: String?

    var signedOut: Bool { status == 401 && code != "invalid_token" }

    var errorDescription: String? {
        switch code {
        case "sign_in_required": "Sign in again to sync."
        case "invalid_token": "The sign-in couldn't be checked. Try again."
        case "sync_full": "This account has reached the sync limit."
        default: message
        }
    }

    static func check(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) else { return }
        struct Body: Decodable { struct E: Decodable { let code: String; let message: String }; let error: E }
        let body = try? JSONDecoder().decode(Body.self, from: data)
        throw APIError(status: http.statusCode, message: body?.error.message ?? "The server answered \(http.statusCode).", code: body?.error.code)
    }
}
