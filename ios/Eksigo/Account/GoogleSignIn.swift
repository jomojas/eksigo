import CryptoKit
import Foundation

/// Google sign-in without Google's SDK (DESIGN.md section 0, "Sign-in page and plans page"): the app opens
/// Google's page in a browser sheet with PKCE, Google sends a code back to the app's reversed client ID, and the
/// app trades the code for an ID token. iOS OAuth clients have no secret, so nothing here is secret.
nonisolated struct GoogleSignIn: Sendable {
    /// The iOS OAuth client ID from Google Cloud Console (APIs & Services → Credentials). Empty: the button says
    /// Google sign-in isn't set up. The server's config.yaml lists the same ID under `auth.google_client_ids`.
    static let clientID = "1034250709893-dck1asb1ukaip3obnsl6ij55j0jp4t8e.apps.googleusercontent.com"

    let clientID: String
    let verifier: String

    init?(clientID: String = Self.clientID) {
        guard clientID.hasSuffix(".apps.googleusercontent.com") else { return nil }
        self.clientID = clientID
        verifier = (0..<48).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    /// "com.googleusercontent.apps.123-abc": Google sends the code back to this scheme.
    var scheme: String { clientID.split(separator: ".").reversed().joined(separator: ".") }
    var redirect: String { "\(scheme):/oauth2redirect" }

    var authorizeURL: URL {
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        var c = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        c.queryItems = [.init(name: "client_id", value: clientID), .init(name: "redirect_uri", value: redirect),
                        .init(name: "response_type", value: "code"), .init(name: "scope", value: "openid email profile"),
                        .init(name: "code_challenge", value: challenge), .init(name: "code_challenge_method", value: "S256"),
                        .init(name: "prompt", value: "select_account")]
        return c.url!
    }

    /// Trades the code in Google's redirect for an ID token.
    func idToken(from callback: URL) async throws -> String {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard let code = items.first(where: { $0.name == "code" })?.value else {
            throw APIError(status: 0, message: "Google didn't return a sign-in code.")
        }
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [.init(name: "client_id", value: clientID), .init(name: "code", value: code),
                           .init(name: "code_verifier", value: verifier), .init(name: "redirect_uri", value: redirect),
                           .init(name: "grant_type", value: "authorization_code")]
        request.httpBody = Data((form.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)
        let (data, _) = try await URLSession.shared.data(for: request)
        struct Reply: Decodable { let id_token: String? }
        guard let token = try JSONDecoder().decode(Reply.self, from: data).id_token else {
            throw APIError(status: 0, message: "Google didn't return a sign-in token.")
        }
        return token
    }
}

extension Data {
    nonisolated var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
