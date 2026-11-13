//! The optional account (DESIGN.md section 8): signing in with Apple or Google through the browser, signing out,
//! deleting the account.
//!
//! Signing in: the app listens on 127.0.0.1, opens the server's sign-in address in the browser with a state and a
//! PKCE challenge, and waits. The server sends the browser to Apple or Google and then back here with a one-time
//! code, which the app trades (with the PKCE verifier) for a session token. The browser is then shown the server's
//! "done" page. The token lives in the macOS Keychain or the Windows Credential Manager; the name and e-mail are
//! kept in the settings so the account shows at once, even offline.

use std::{
    sync::{LazyLock, Mutex},
    time::Duration,
};

use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Notify,
};

use crate::db::Db;

/// The server. `EKSIGO_API` points a development build at a local one (`http://localhost:8000`).
pub static API: LazyLock<String> =
    LazyLock::new(|| std::env::var("EKSIGO_API").unwrap_or_else(|_| "https://api.eksigo.com".into()).trim_end_matches('/').into());

const KEYCHAIN_SERVICE: &str = "com.eksigo.desktop";
const KEYCHAIN_USER: &str = "session";
const SETTING: &str = "account";
/// The server keeps a sign-in open this long.
const WAIT: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Account {
    pub id: i64,
    pub name: Option<String>,
    pub email: Option<String>,
    /// "free" or "premium".
    pub plan: String,
    /// "apple", "google" or "dev".
    #[serde(default)]
    pub provider: String,
}

#[derive(Deserialize)]
struct SignedIn {
    token: String,
    user: Account,
}

/// The sign-in waiting for the browser, if any.
#[derive(Default)]
pub struct SignIn {
    pub(crate) cancel: Notify,
    pub(crate) url: Mutex<Option<String>>,
}

impl SignIn {
    /// The sign-in page, to open again when the learner closed the tab.
    pub fn url(&self) -> Option<String> {
        self.url.lock().unwrap().clone()
    }

    pub fn cancel(&self) {
        self.cancel.notify_waiters();
    }
}

/// How a sign-in ended other than signed in.
#[derive(Debug, PartialEq)]
pub enum NotSignedIn {
    /// Cancelled in the app or at Apple or Google: nothing to report.
    Cancelled,
    Failed(String),
}

// ---------------------------------------------------------------- stored account

fn keychain() -> Result<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).context("opening the keychain")
}

fn token() -> Option<String> {
    keychain().ok()?.get_password().ok()
}

/// The signed-in account as last seen, without asking the server.
pub fn stored(db: &Db) -> Option<Account> {
    let json = db.get_setting(SETTING).ok()??;
    serde_json::from_str(&json).ok()
}

fn store(db: &Db, token: &str, account: &Account) -> Result<()> {
    keychain()?.set_password(token).context("saving the sign-in in the keychain")?;
    db.set_setting(SETTING, &serde_json::to_string(account)?)
}

fn forget(db: &Db) -> Result<()> {
    if let Ok(entry) = keychain() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(anyhow!(e).context("removing the sign-in from the keychain")),
        }
    }
    db.set_setting(SETTING, "")
}

// ---------------------------------------------------------------- talking to the server

fn http() -> &'static reqwest::Client {
    &crate::podcasts::HTTP
}

async fn api_error(r: reqwest::Response) -> anyhow::Error {
    #[derive(Deserialize)]
    struct Body {
        error: Inner,
    }
    #[derive(Deserialize)]
    struct Inner {
        message: String,
    }
    let status = r.status();
    match r.json::<Body>().await {
        Ok(b) => anyhow!(b.error.message),
        Err(_) => anyhow!("The server answered {status}"),
    }
}

/// The account as the server has it now (name, plan). `None` when the session has ended (signed out elsewhere,
/// expired, account deleted), which also signs this computer out. Offline: the stored account.
pub async fn refresh(db: &Db) -> Result<Option<Account>> {
    let Some(token) = token() else {
        if stored(db).is_some() {
            forget(db)?;
        }
        return Ok(None);
    };
    let r = match http().get(format!("{}/v1/me", *API)).bearer_auth(&token).timeout(Duration::from_secs(15)).send().await {
        Ok(r) => r,
        Err(_) => return Ok(stored(db)),
    };
    if r.status() == reqwest::StatusCode::UNAUTHORIZED {
        forget(db)?;
        return Ok(None);
    }
    if !r.status().is_success() {
        return Ok(stored(db));
    }
    let account: Account = r.json().await?;
    db.set_setting(SETTING, &serde_json::to_string(&account)?)?;
    Ok(Some(account))
}

pub async fn sign_out(db: &Db) -> Result<()> {
    if let Some(token) = token() {
        // Best effort: the session ends on this computer either way.
        let _ = http().post(format!("{}/v1/auth/sign-out", *API)).bearer_auth(token).timeout(Duration::from_secs(10)).send().await;
    }
    forget(db)
}

/// Delete the account on the server, then sign out here. Words on this computer stay.
pub async fn delete(db: &Db) -> Result<()> {
    let Some(token) = token() else {
        forget(db)?;
        return Ok(());
    };
    let r = http()
        .delete(format!("{}/v1/me", *API))
        .bearer_auth(token)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| anyhow!("Couldn't reach the Eksigo server. Check the connection and try again."))?;
    if !r.status().is_success() && r.status() != reqwest::StatusCode::UNAUTHORIZED {
        return Err(api_error(r).await);
    }
    forget(db)
}

// ---------------------------------------------------------------- signing in

pub(crate) fn random(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("the system's random numbers");
    URL_SAFE_NO_PAD.encode(buf)
}

pub(crate) fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Sign in with "apple" or "google". `open` opens a URL in the browser. Returns once the browser came back, the
/// learner cancelled, or the server's time ran out.
pub async fn sign_in(db: &Db, state: &SignIn, provider: &str, open: impl Fn(&str) -> Result<()>) -> Result<Account, NotSignedIn> {
    let failed = |e: anyhow::Error| NotSignedIn::Failed(format!("{e:#}"));
    if provider != "apple" && provider != "google" {
        return Err(NotSignedIn::Failed(format!("Unknown provider {provider}")));
    }
    // A sign-in already waiting is replaced by this one.
    state.cancel();
    let listener = TcpListener::bind("127.0.0.1:0").await.context("listening for the browser").map_err(failed)?;
    let port = listener.local_addr().map_err(|e| failed(e.into()))?.port();
    let app_state = random(24);
    let verifier = random(48);
    let url = format!(
        "{}/v1/auth/desktop/{provider}?port={port}&state={app_state}&challenge={}",
        *API,
        challenge(&verifier)
    );
    *state.url.lock().unwrap() = Some(url.clone());
    let cancelled = state.cancel.notified();
    tokio::pin!(cancelled);
    let result = async {
        open(&url).map_err(failed)?;
        tokio::select! {
            r = wait_for_browser(&listener, &app_state, provider, &verifier, db) => r,
            _ = &mut cancelled => Err(NotSignedIn::Cancelled),
            _ = tokio::time::sleep(WAIT) => Err(NotSignedIn::Failed("Signing in took too long. Try again.".into())),
        }
    }
    .await;
    *state.url.lock().unwrap() = None;
    result
}

/// Answer the browser's requests until one carries this sign-in's answer.
async fn wait_for_browser(listener: &TcpListener, app_state: &str, provider: &str, verifier: &str, db: &Db) -> Result<Account, NotSignedIn> {
    loop {
        let Ok((mut stream, _)) = listener.accept().await else { continue };
        let Ok(Some(query)) = read_callback(&mut stream, "/callback").await else {
            let _ = respond(&mut stream, "404 Not Found", None).await;
            continue;
        };
        if query.get("state").map(String::as_str) != Some(app_state) {
            let _ = respond(&mut stream, "400 Bad Request", None).await;
            continue;
        }
        let done = |ok: bool| format!("{}/v1/auth/done?ok={}&provider={provider}", *API, ok as u8);
        let result = match (query.get("code"), query.get("error").map(String::as_str)) {
            (Some(code), _) => redeem(db, code, verifier).await.map_err(|e| NotSignedIn::Failed(format!("{e:#}"))),
            (None, Some("cancelled")) => Err(NotSignedIn::Cancelled),
            _ => Err(NotSignedIn::Failed(format!(
                "{} didn't confirm the sign-in. Try again.",
                if provider == "apple" { "Apple" } else { "Google" }
            ))),
        };
        let _ = respond(&mut stream, "302 Found", Some(&done(result.is_ok()))).await;
        return result;
    }
}

async fn redeem(db: &Db, code: &str, verifier: &str) -> Result<Account> {
    let r = http()
        .post(format!("{}/v1/auth/desktop/token", *API))
        .json(&serde_json::json!({ "code": code, "verifier": verifier }))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .context("Couldn't reach the Eksigo server")?;
    if !r.status().is_success() {
        return Err(api_error(r).await);
    }
    let signed: SignedIn = r.json().await?;
    store(db, &signed.token, &signed.user)?;
    Ok(signed.user)
}

/// The query of a `GET {path}?…` request; `None` for anything else (the browser also asks for a favicon).
pub(crate) async fn read_callback(stream: &mut TcpStream, path: &str) -> Result<Option<std::collections::HashMap<String, String>>> {
    let mut buf = Vec::with_capacity(2048);
    let mut chunk = [0u8; 2048];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut chunk)).await??;
        if n == 0 || buf.len() > 16 * 1024 {
            bail!("not a request");
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let head = String::from_utf8_lossy(&buf);
    let target = head.lines().next().and_then(|l| l.strip_prefix("GET ")).and_then(|l| l.split(' ').next()).unwrap_or("");
    let url = url::Url::parse(&format!("http://127.0.0.1{target}"))?;
    Ok((url.path() == path).then(|| url.query_pairs().into_owned().collect()))
}

/// A small page for the browser tab, styled like the server's (it has no address of its own to go to).
pub(crate) async fn respond_page(stream: &mut TcpStream, title: &str, text: &str) -> Result<()> {
    let html = format!(
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>{title}</title>\
         <style>body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:15px/1.55 Inter,-apple-system,system-ui,'Segoe UI',sans-serif;\
         background:#fcfcfd;color:#3a3d44}}@media (prefers-color-scheme:dark){{body{{background:#010102;color:#d0d6e0}}h1{{color:#f7f8f8}}}}\
         main{{max-width:420px;padding:24px}}h1{{font-size:22px;letter-spacing:-0.4px;color:#121316;margin:0 0 8px}}</style>\
         <main><h1>{title}</h1><p>{text}</p></main></html>"
    );
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n\
         Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nConnection: close\r\n\r\n",
        html.len()
    );
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(html.as_bytes()).await?;
    stream.shutdown().await?;
    Ok(())
}

pub(crate) async fn respond(stream: &mut TcpStream, status: &str, location: Option<&str>) -> Result<()> {
    let location = location.map(|l| format!("Location: {l}\r\n")).unwrap_or_default();
    let head = format!("HTTP/1.1 {status}\r\n{location}Content-Length: 0\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n");
    stream.write_all(head.as_bytes()).await?;
    stream.shutdown().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_challenge_is_pkce_s256() {
        // RFC 7636, appendix B.
        assert_eq!(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn random_values_are_long_enough_for_the_server() {
        // The server asks for a state of at least 16 characters and a verifier of 43 to 128.
        assert_eq!(random(24).len(), 32);
        assert_eq!(random(48).len(), 64);
        assert_ne!(random(24), random(24));
    }

    #[tokio::test]
    async fn the_browser_comes_back_to_the_app() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = tokio::spawn(async move {
            let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            s.write_all(b"GET /callback?state=abc&error=cancelled HTTP/1.1\r\nHost: x\r\n\r\n").await.unwrap();
            let mut answer = String::new();
            s.read_to_string(&mut answer).await.unwrap();
            answer
        });
        let db = Db::open_in_memory().unwrap();
        let r = wait_for_browser(&listener, "abc", "google", "v", &db).await;
        assert_eq!(r, Err(NotSignedIn::Cancelled));
        let answer = browser.await.unwrap();
        assert!(answer.starts_with("HTTP/1.1 302"));
        assert!(answer.contains("/v1/auth/done?ok=0&provider=google"));
    }

    #[tokio::test]
    async fn requests_for_other_sign_ins_are_ignored() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            for req in ["GET /favicon.ico HTTP/1.1\r\n\r\n", "GET /callback?state=other&code=x HTTP/1.1\r\n\r\n",
                        "GET /callback?state=abc&error=failed HTTP/1.1\r\n\r\n"] {
                let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
                s.write_all(req.as_bytes()).await.unwrap();
                let mut answer = String::new();
                s.read_to_string(&mut answer).await.unwrap();
            }
        });
        let db = Db::open_in_memory().unwrap();
        let r = wait_for_browser(&listener, "abc", "apple", "v", &db).await;
        assert_eq!(r, Err(NotSignedIn::Failed("Apple didn't confirm the sign-in. Try again.".into())));
    }
}
