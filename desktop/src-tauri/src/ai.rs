//! AI (DESIGN.md section 6, designs D16–D19): explaining words in their sentence when asked, a conversation about
//! one sentence (why it was misheard, by reason, and the learner's own questions), and a review of each finished
//! episode by reason, using an AI the learner already has.
//!
//! Two ways in, tried in this order:
//! - **ChatGPT** (Plus or Pro): OpenAI's *Sign in with ChatGPT* with plan usage, open to open-source apps that run
//!   on the user's computer. The browser signs in and asks to let Eksigo use the plan; the first time, OpenAI
//!   registers this install and gives it a client ID. No secret and no key, and Eksigo's server isn't involved.
//!   Requests go to OpenAI's Responses API with the access token, streamed and not stored.
//! - **Their own API key**: OpenAI, DeepSeek, Anthropic, Groq, OpenRouter or any OpenAI-compatible address.
//!
//! Tokens and keys live in the macOS Keychain or the Windows Credential Manager; the rest (which account, which
//! provider) in the settings. Only the sentence and what was typed are sent, never the audio.

use std::{
    collections::{HashMap, HashSet},
    fmt,
    sync::{LazyLock, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::StreamExt;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::{net::TcpListener, sync::OnceCell};

use crate::{
    account::{self, NotSignedIn, SignIn},
    compare::{Mark, Marked},
    db::Db,
    dictation, transcribe,
};

const ISSUER: &str = "https://auth.openai.com";
const RESOURCE: &str = "https://api.openai.com/v1";
const SCOPES: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
/// The permission to use the plan; without it the sign-in is identity only.
const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
const CALLBACK: &str = "/auth/callback";

const KEYCHAIN_SERVICE: &str = "com.eksigo.desktop";
const CHATGPT_SECRET: &str = "chatgpt";
const KEY_SECRET: &str = "ai-key";
const SETTING: &str = "ai";
/// One stable, opaque ID for this install (`urn:uuid:…`), sent with every ChatGPT sign-in.
const HOST_SETTING: &str = "chatgpt_host";
const WAIT: Duration = Duration::from_secs(15 * 60);
/// A limit that was reached counts as reached for this long, unless a request works again before.
const LIMIT_SHOWN_FOR: i64 = 7 * 24 * 3600;

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn http() -> &'static reqwest::Client {
    &crate::podcasts::HTTP
}

// ---------------------------------------------------------------- what the interface sees

/// Why an AI request didn't give an answer.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum AiError {
    /// Neither ChatGPT nor a key: the interface offers Settings › AI.
    NotSetUp,
    /// The weekly limit the learner set for Eksigo in ChatGPT is used up.
    Limit,
    /// ChatGPT's sign-in ended (revoked, expired): connect again.
    Reconnect,
    Failed(String),
}

impl From<anyhow::Error> for AiError {
    fn from(e: anyhow::Error) -> Self {
        AiError::Failed(format!("{e:#}"))
    }
}

impl fmt::Display for AiError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            AiError::NotSetUp => write!(f, "AI isn't set up yet."),
            AiError::Limit => write!(f, "You've used this week's ChatGPT limit for Eksigo."),
            AiError::Reconnect => write!(f, "Connect ChatGPT again."),
            AiError::Failed(m) => write!(f, "{m}"),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// What explanations use now: "chatgpt", "key", or None when AI isn't set up.
    pub using: Option<&'static str>,
    pub chatgpt: Option<ChatGptStatus>,
    pub key: Option<KeyStatus>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptStatus {
    pub email: Option<String>,
    /// "plus", "pro" … as OpenAI names it, when it says.
    pub plan: Option<String>,
    /// The weekly limit was reached and no request has worked since.
    pub limited: bool,
    /// The sign-in ended; the account is remembered so connecting again is one click.
    pub reconnect: bool,
    /// The model in use, once known.
    pub model: Option<String>,
    /// The learner picked the model; otherwise Eksigo picks a small one.
    pub chosen: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    pub provider: String,
    pub name: String,
    pub model: String,
    pub base_url: String,
}

// ---------------------------------------------------------------- stored settings

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
struct Stored {
    /// OpenAI's registration of this install, kept after disconnecting so connecting again doesn't register anew.
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    chatgpt: Option<ChatGpt>,
    #[serde(default)]
    key: Option<Key>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct ChatGpt {
    subject: String,
    email: Option<String>,
    plan: Option<String>,
    /// The model Eksigo picked from the plan's list, until it goes away.
    model: Option<String>,
    /// The model the learner picked in Settings › AI; None: Eksigo picks.
    #[serde(default)]
    chosen: Option<String>,
    limited_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Key {
    pub provider: String,
    /// Only for "other"; the others have their own.
    #[serde(default)]
    pub base_url: String,
    /// Empty: the provider's usual one.
    #[serde(default)]
    pub model: String,
}

fn load(db: &Db) -> Stored {
    db.get_setting(SETTING).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save(db: &Db, s: &Stored) -> Result<()> {
    db.set_setting(SETTING, &serde_json::to_string(s)?)
}

fn keychain(user: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, user).context("opening the keychain")
}

fn secret(user: &str) -> Option<String> {
    keychain(user).ok()?.get_password().ok()
}

fn set_secret(user: &str, value: &str) -> Result<()> {
    keychain(user)?.set_password(value).context("saving to the keychain")
}

fn forget_secret(user: &str) -> Result<()> {
    match keychain(user)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(anyhow!(e).context("removing from the keychain")),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Tokens {
    access: String,
    refresh: Option<String>,
    expires_at: i64,
}

fn tokens() -> Option<Tokens> {
    serde_json::from_str(&secret(CHATGPT_SECRET)?).ok()
}

fn host_id(db: &Db) -> Result<String> {
    if let Some(id) = db.get_setting(HOST_SETTING)?.filter(|s| !s.is_empty()) {
        return Ok(id);
    }
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("the system's random numbers");
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
    let h = hex::encode(b);
    let id = format!("urn:uuid:{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32]);
    db.set_setting(HOST_SETTING, &id)?;
    Ok(id)
}

pub fn status(db: &Db) -> Status {
    let s = load(db);
    let connected = s.chatgpt.is_some() && tokens().is_some();
    let key = s.key.as_ref().filter(|_| secret(KEY_SECRET).is_some()).and_then(|k| {
        let p = provider(&k.provider)?;
        Some(KeyStatus {
            provider: p.id.into(),
            name: p.name.into(),
            model: if k.model.is_empty() { p.model.into() } else { k.model.clone() },
            base_url: if p.id == "other" { k.base_url.clone() } else { p.base.into() },
        })
    });
    Status {
        using: if connected {
            Some("chatgpt")
        } else if key.is_some() {
            Some("key")
        } else {
            None
        },
        chatgpt: s.chatgpt.map(|c| ChatGptStatus {
            email: c.email,
            plan: c.plan,
            limited: c.limited_at.is_some_and(|t| now() - t < LIMIT_SHOWN_FOR),
            reconnect: !connected,
            chosen: c.chosen.is_some(),
            model: c.chosen.or(c.model),
        }),
        key,
    }
}

// ---------------------------------------------------------------- talking to OpenAI's sign-in

/// An error answer from OpenAI, by its code ("invalid_grant", "subscription_sharing_usage_limit_exceeded" …).
#[derive(Debug)]
struct Remote {
    status: u16,
    code: String,
}

impl fmt::Display for Remote {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "OpenAI answered {} ({})", self.status, self.code)
    }
}

impl std::error::Error for Remote {}

/// The machine-readable code in an error body: OAuth puts it in `error`, the API in `error.code`.
fn error_code(body: &Value) -> String {
    let mut d = body;
    for _ in 0..4 {
        if d.get("error").is_some_and(Value::is_object) {
            d = &d["error"];
        } else if d.get("detail").is_some_and(Value::is_object) {
            d = &d["detail"];
        } else {
            break;
        }
    }
    let code = d.get("error").and_then(Value::as_str).or_else(|| d.get("code").and_then(Value::as_str)).unwrap_or("api_error");
    // Only identifiers: messages can echo what was sent.
    if code.len() <= 100 && code.chars().all(|c| c.is_ascii_alphanumeric() || "_.:-".contains(c)) {
        code.into()
    } else {
        "api_error".into()
    }
}

#[derive(Debug, Clone, Deserialize)]
struct Discovery {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    revocation_endpoint: Option<String>,
}

static DISCOVERY: OnceCell<Discovery> = OnceCell::const_new();

async fn discovery() -> Result<&'static Discovery> {
    DISCOVERY
        .get_or_try_init(|| async {
            let d: Discovery = http()
                .get(format!("{ISSUER}/.well-known/openid-configuration"))
                .timeout(Duration::from_secs(15))
                .send()
                .await
                .context("Couldn't reach OpenAI")?
                .error_for_status()?
                .json()
                .await?;
            let ours = |u: &str| u.starts_with(&format!("{ISSUER}/"));
            if d.issuer != ISSUER || !ours(&d.authorization_endpoint) || !ours(&d.token_endpoint) || d.revocation_endpoint.as_deref().is_some_and(|u| !ours(u)) {
                bail!("OpenAI's sign-in settings didn't check out");
            }
            Ok(d)
        })
        .await
}

async fn token_request(form: &[(&str, &str)]) -> Result<Value> {
    let d = discovery().await?;
    let r = http()
        .post(&d.token_endpoint)
        .header("accept", "application/json")
        .form(form)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .context("Couldn't reach OpenAI")?;
    let status = r.status().as_u16();
    let body: Value = r.json().await.unwrap_or(Value::Null);
    if !(200..300).contains(&status) {
        return Err(Remote { status, code: error_code(&body) }.into());
    }
    Ok(body)
}

/// What the ID token says, checked: it came straight from the token endpoint over TLS (OpenID Connect 3.1.3.7),
/// so the signature isn't checked again here, but the issuer, audience, nonce and expiry are.
#[derive(Debug, PartialEq)]
struct Identity {
    subject: String,
    email: Option<String>,
    plan: Option<String>,
}

fn identity(id_token: &str, client_id: &str, nonce: &str, now: i64) -> Result<Identity> {
    let payload = id_token.split('.').nth(1).context("not an ID token")?;
    let c: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload.trim_end_matches('='))?)?;
    let aud_ok = match &c["aud"] {
        Value::String(a) => a == client_id,
        Value::Array(a) => a.iter().any(|v| v == client_id),
        _ => false,
    };
    if c["iss"] != ISSUER || !aud_ok || c["nonce"] != nonce || c["exp"].as_i64().is_none_or(|e| e < now - 300) {
        bail!("ChatGPT's answer didn't check out. Try again.");
    }
    let subject = c["sub"].as_str().filter(|s| !s.is_empty()).context("no account in the ID token")?.to_string();
    Ok(Identity {
        subject,
        email: c["email"].as_str().map(String::from),
        plan: c["https://api.openai.com/auth"]["chatgpt_plan_type"].as_str().map(String::from),
    })
}

fn tokens_from(data: &Value, old_refresh: Option<String>) -> Result<Tokens> {
    let access = data["access_token"].as_str().filter(|s| !s.is_empty()).context("ChatGPT sent no access token")?;
    let expires_in = data["expires_in"].as_i64().filter(|e| *e > 0).context("ChatGPT sent no expiry")?;
    Ok(Tokens {
        access: access.into(),
        refresh: data["refresh_token"].as_str().filter(|s| !s.is_empty()).map(String::from).or(old_refresh),
        expires_at: now() + expires_in,
    })
}

// ---------------------------------------------------------------- connecting ChatGPT

/// The ChatGPT connection waiting for the browser (the same shape as an account sign-in).
#[derive(Default)]
pub struct Connect(pub SignIn);

/// Opens OpenAI's page in the browser and waits for it to come back to the app.
pub async fn connect(db: &Db, state: &Connect, open: impl Fn(&str) -> Result<()>) -> Result<Status, NotSignedIn> {
    let failed = |e: anyhow::Error| NotSignedIn::Failed(format!("{e:#}"));
    state.0.cancel();
    let d = discovery().await.map_err(failed)?;
    let listener = TcpListener::bind("127.0.0.1:0").await.context("listening for the browser").map_err(failed)?;
    let port = listener.local_addr().map_err(|e| failed(e.into()))?.port();
    let redirect = format!("http://127.0.0.1:{port}{CALLBACK}");
    let saved = load(db).client_id;
    let app_state = account::random(24);
    let nonce = account::random(24);
    let verifier = account::random(48);
    let mut url = url::Url::parse(&d.authorization_endpoint).map_err(|e| failed(e.into()))?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("client_id", saved.as_deref().unwrap_or("dynamic_agent_client"))
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &redirect)
            .append_pair("scope", SCOPES)
            .append_pair("resource", RESOURCE)
            .append_pair("state", &app_state)
            .append_pair("nonce", &nonce)
            .append_pair("code_challenge_method", "S256")
            .append_pair("code_challenge", &account::challenge(&verifier))
            .append_pair("ext_agent_host_id", &host_id(db).map_err(failed)?);
        if saved.is_none() {
            q.append_pair("agent_name_hint", "Eksigo");
        }
    }
    let url = url.to_string();
    *state.0.url.lock().unwrap() = Some(url.clone());
    let cancelled = state.0.cancel.notified();
    tokio::pin!(cancelled);
    let result = async {
        open(&url).map_err(failed)?;
        tokio::select! {
            r = wait_for_browser(db, &listener, &app_state, &nonce, &verifier, &redirect, saved.as_deref()) => r,
            _ = &mut cancelled => Err(NotSignedIn::Cancelled),
            _ = tokio::time::sleep(WAIT) => Err(NotSignedIn::Failed("Connecting took too long. Try again.".into())),
        }
    }
    .await;
    *state.0.url.lock().unwrap() = None;
    result
}

async fn wait_for_browser(
    db: &Db,
    listener: &TcpListener,
    app_state: &str,
    nonce: &str,
    verifier: &str,
    redirect: &str,
    saved: Option<&str>,
) -> Result<Status, NotSignedIn> {
    loop {
        let Ok((mut stream, _)) = listener.accept().await else { continue };
        let Ok(Some(q)) = account::read_callback(&mut stream, CALLBACK).await else {
            let _ = account::respond(&mut stream, "404 Not Found", None).await;
            continue;
        };
        if q.get("state").map(String::as_str) != Some(app_state) {
            let _ = account::respond(&mut stream, "400 Bad Request", None).await;
            continue;
        }
        let result = answer(db, &q, nonce, verifier, redirect, saved).await;
        let _ = match &result {
            Ok(_) => account::respond_page(&mut stream, "ChatGPT is connected", "Go back to Eksigo: explanations and reviews now use your ChatGPT plan. You can close this tab.").await,
            Err(NotSignedIn::Cancelled) => account::respond_page(&mut stream, "Not connected", "Nothing changed. You can close this tab and go back to Eksigo.").await,
            Err(NotSignedIn::Failed(e)) => account::respond_page(&mut stream, "Connecting didn't work", &html_escape(e)).await,
        };
        return result;
    }
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

async fn answer(db: &Db, q: &HashMap<String, String>, nonce: &str, verifier: &str, redirect: &str, saved: Option<&str>) -> Result<Status, NotSignedIn> {
    if let Some(e) = q.get("error") {
        return Err(if e == "access_denied" {
            NotSignedIn::Cancelled
        } else {
            NotSignedIn::Failed(format!("ChatGPT didn't connect ({}). Try again.", error_code(&json!({ "error": e }))))
        });
    }
    let fail = |m: &str| NotSignedIn::Failed(m.into());
    let code = q.get("code").ok_or_else(|| fail("ChatGPT didn't finish connecting. Try again."))?;
    let client_id = q.get("client_id").map(String::as_str).or(saved).ok_or_else(|| fail("ChatGPT didn't register Eksigo. Try again."))?;
    if client_id == "dynamic_agent_client" || client_id.len() > 200 || !client_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err(fail("ChatGPT didn't register Eksigo. Try again."));
    }
    // Kept before the code is traded, so a retry doesn't register another app.
    let mut s = load(db);
    s.client_id = Some(client_id.into());
    save(db, &s).map_err(|e| NotSignedIn::Failed(format!("{e:#}")))?;
    exchange(db, client_id, code, verifier, redirect, nonce).await.map_err(|e| NotSignedIn::Failed(format!("{e:#}")))
}

async fn exchange(db: &Db, client_id: &str, code: &str, verifier: &str, redirect: &str, nonce: &str) -> Result<Status> {
    let data = token_request(&[
        ("grant_type", "authorization_code"),
        ("client_id", client_id),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", redirect),
        ("resource", RESOURCE),
    ])
    .await?;
    if !data["scope"].as_str().unwrap_or("").split_whitespace().any(|s| s == PLAN_SCOPE) {
        bail!("This ChatGPT account can't lend its plan to apps. That needs ChatGPT Plus or Pro, and allowing Eksigo to use it.");
    }
    let id = identity(data["id_token"].as_str().context("ChatGPT sent no identity")?, client_id, nonce, now())?;
    let t = tokens_from(&data, None)?;
    set_secret(CHATGPT_SECRET, &serde_json::to_string(&t)?)?;
    let mut s = load(db);
    let same = s.chatgpt.as_ref().filter(|c| c.subject == id.subject);
    let (model, chosen) = (same.and_then(|c| c.model.clone()), same.and_then(|c| c.chosen.clone()));
    s.chatgpt = Some(ChatGpt { subject: id.subject, email: id.email, plan: id.plan, model, chosen, limited_at: None });
    save(db, &s)?;
    Ok(status(db))
}

/// Ends the connection here and at OpenAI (best effort: it can also be removed in ChatGPT's settings).
pub async fn disconnect(db: &Db) -> Result<()> {
    let s = load(db);
    if let (Some(t), Some(client)) = (tokens(), s.client_id.as_deref()) {
        if let (Some(refresh), Ok(d)) = (t.refresh, discovery().await) {
            if let Some(revoke) = &d.revocation_endpoint {
                let _ = http()
                    .post(revoke)
                    .form(&[("token", refresh.as_str()), ("token_type_hint", "refresh_token"), ("client_id", client)])
                    .timeout(Duration::from_secs(10))
                    .send()
                    .await;
            }
        }
    }
    forget_secret(CHATGPT_SECRET)?;
    let mut s = load(db);
    s.chatgpt = None;
    save(db, &s)
}

/// Refreshes are one at a time: each one replaces the refresh token.
static REFRESHING: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

const ENDED: &[&str] = &[
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
    "invalid_client",
];

/// A working access token, refreshed when it's about to run out (or `force`d after a 401).
async fn access_token(db: &Db, force: bool) -> Result<String, AiError> {
    let _one = REFRESHING.lock().await;
    let t = tokens().ok_or(AiError::Reconnect)?;
    if !force && t.expires_at > now() + 60 {
        return Ok(t.access);
    }
    let client = load(db).client_id.ok_or(AiError::Reconnect)?;
    let refresh = t.refresh.clone().ok_or(AiError::Reconnect)?;
    match token_request(&[("grant_type", "refresh_token"), ("client_id", &client), ("refresh_token", &refresh), ("resource", RESOURCE)]).await {
        Ok(data) => {
            let fresh = tokens_from(&data, Some(refresh))?;
            set_secret(CHATGPT_SECRET, &serde_json::to_string(&fresh).map_err(anyhow::Error::from)?)?;
            Ok(fresh.access)
        }
        Err(e) => match e.downcast_ref::<Remote>() {
            Some(r) if ENDED.contains(&r.code.as_str()) || r.status == 401 => {
                forget_secret(CHATGPT_SECRET)?;
                Err(AiError::Reconnect)
            }
            _ => Err(AiError::Failed("Couldn't reach ChatGPT. Check the connection and try again.".into())),
        },
    }
}

// ---------------------------------------------------------------- asking ChatGPT

/// A model the plan offers to apps, for Settings › AI.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub slug: String,
    pub name: String,
    /// Small and fast: answers sooner and uses less of the plan's limit.
    pub small: bool,
}

fn is_small(slug: &str) -> bool {
    slug.contains("mini") || slug.contains("nano")
}

/// The model Eksigo picks: a small fast one ("mini") when there is one.
fn pick_model(models: &[ModelInfo]) -> Option<String> {
    models
        .iter()
        .find(|m| m.slug.contains("mini"))
        .or_else(|| models.iter().find(|m| m.small))
        .or_else(|| models.first())
        .map(|m| m.slug.clone())
}

async fn plan_models(token: &str) -> Result<Vec<ModelInfo>, AiError> {
    let r = http().get(format!("{RESOURCE}/models")).bearer_auth(token).timeout(Duration::from_secs(20)).send().await.map_err(|_| offline())?;
    let status = r.status().as_u16();
    let body: Value = r.json().await.unwrap_or(Value::Null);
    if !(200..300).contains(&status) {
        return Err(problem(status, &error_code(&body)));
    }
    Ok(models_in(&body))
}

fn models_in(body: &Value) -> Vec<ModelInfo> {
    body["models"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|m| m["visibility"] == "list")
                .filter_map(|m| {
                    let slug = m["slug"].as_str()?.to_string();
                    let name = m["display_name"].as_str().filter(|n| !n.is_empty()).unwrap_or(&slug).to_string();
                    Some(ModelInfo { small: is_small(&slug), slug, name })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The models the plan offers, for choosing one in Settings › AI.
pub async fn models(db: &Db) -> Result<Vec<ModelInfo>, AiError> {
    let token = access_token(db, false).await?;
    plan_models(&token).await
}

/// None: Eksigo picks (a small model).
pub fn set_model(db: &Db, model: Option<String>) -> Result<Status> {
    let mut s = load(db);
    if let Some(c) = s.chatgpt.as_mut() {
        c.chosen = model.filter(|m| !m.trim().is_empty());
    }
    save(db, &s)?;
    Ok(status(db))
}

async fn chatgpt_model(db: &Db, token: &str) -> Result<String, AiError> {
    if let Some(c) = load(db).chatgpt {
        if let Some(m) = c.chosen.or(c.model) {
            return Ok(m);
        }
    }
    let model = pick_model(&plan_models(token).await?).ok_or_else(|| AiError::Failed("Your ChatGPT plan has no models for apps right now.".into()))?;
    let mut s = load(db);
    if let Some(c) = s.chatgpt.as_mut() {
        c.model = Some(model.clone());
    }
    save(db, &s)?;
    Ok(model)
}

fn offline() -> AiError {
    AiError::Failed("Couldn't reach the AI. Check the connection and try again.".into())
}

/// An error answer from ChatGPT, as the learner should see it.
fn problem(status: u16, code: &str) -> AiError {
    match code.trim_start_matches("subscription_sharing_v2_").trim_start_matches("subscription_sharing_") {
        "usage_limit_exceeded" => return AiError::Limit,
        "user_not_eligible" => return AiError::Failed("This ChatGPT account can't lend its plan to apps. That needs ChatGPT Plus or Pro.".into()),
        "usage_unavailable" | "user_unavailable" => return AiError::Failed("ChatGPT couldn't check your plan just now. Try again in a moment.".into()),
        _ => {}
    }
    if ENDED.contains(&code) || code == "invalid_token" || code == "invalid_api_key" {
        return AiError::Reconnect;
    }
    match status {
        429 => AiError::Failed("Too many requests at once. Wait a moment and try again.".into()),
        500.. => AiError::Failed("ChatGPT is busy. Try again in a moment.".into()),
        _ => AiError::Failed(format!("ChatGPT couldn't answer ({code}).")),
    }
}

/// Reads the Responses API's event stream: the text as it comes, until `response.completed`.
#[derive(Default)]
struct Events {
    pending: String,
    text: String,
    done: bool,
}

impl Events {
    fn feed(&mut self, chunk: &str) -> Result<(), AiError> {
        self.pending.push_str(chunk);
        while let Some(end) = self.pending.find('\n') {
            let line: String = self.pending.drain(..=end).collect();
            let Some(data) = line.trim_end().strip_prefix("data:") else { continue };
            let Ok(e) = serde_json::from_str::<Value>(data.trim()) else { continue };
            match e["type"].as_str().unwrap_or("") {
                "response.output_text.delta" => self.text.push_str(e["delta"].as_str().unwrap_or("")),
                "response.completed" => self.done = true,
                "response.failed" => return Err(problem(200, &error_code(&e["response"]))),
                "error" => return Err(problem(200, &error_code(&e))),
                "response.incomplete" => return Err(AiError::Failed("ChatGPT stopped before finishing. Try again.".into())),
                _ => {}
            }
            if self.text.len() > 256 * 1024 {
                return Err(AiError::Failed("The answer was too long.".into()));
            }
        }
        Ok(())
    }
}

/// One turn of a conversation with the AI.
#[derive(Debug, Clone, PartialEq)]
pub struct Turn {
    /// "user" or "assistant".
    pub role: &'static str,
    pub text: String,
}

fn user(text: impl Into<String>) -> Turn {
    Turn { role: "user", text: text.into() }
}

/// Told each piece of an answer as it arrives, to show it being written.
pub type OnText<'a> = &'a (dyn Fn(&str) + Send + Sync);

/// Models that refused the reasoning setting: asked again without it, and from then on.
static NO_REASONING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

async fn chatgpt_ask(db: &Db, instructions: &str, turns: &[Turn], on_text: OnText<'_>) -> Result<String, AiError> {
    let mut force = false;
    let mut fresh_model = false;
    let input: Vec<Value> = turns.iter().map(|t| json!({ "role": t.role, "content": t.text })).collect();
    loop {
        let token = access_token(db, force).await?;
        let model = chatgpt_model(db, &token).await?;
        // These are short answers about one sentence: little thinking keeps them quick and light on the limit.
        let reasoning = !NO_REASONING.lock().unwrap().contains(&model);
        let mut body = json!({ "model": model, "instructions": instructions, "input": input, "store": false, "stream": true });
        if reasoning {
            body["reasoning"] = json!({ "effort": "low" });
        }
        let r = http()
            .post(format!("{RESOURCE}/responses"))
            .bearer_auth(&token)
            .header("accept", "text/event-stream")
            .json(&body)
            .timeout(Duration::from_secs(120))
            .send()
            .await
            .map_err(|_| offline())?;
        let status = r.status().as_u16();
        if !(200..300).contains(&status) {
            let code = error_code(&r.json::<Value>().await.unwrap_or(Value::Null));
            if status == 401 && !force && !ENDED.contains(&code.as_str()) {
                force = true;
                continue;
            }
            if status == 400 && reasoning {
                NO_REASONING.lock().unwrap().insert(model);
                continue;
            }
            if code == "model_not_found" && !fresh_model {
                fresh_model = true;
                set_limit_and_model(db, None, true)?;
                continue;
            }
            let e = problem(status, &code);
            if e == AiError::Limit {
                set_limit_and_model(db, Some(now()), false)?;
            }
            return Err(e);
        }
        let mut events = Events::default();
        let mut stream = r.bytes_stream();
        // Whole lines only: a chunk can end in the middle of a character (Chinese, Japanese …).
        let mut raw: Vec<u8> = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| AiError::Failed("The connection to ChatGPT broke. Try again.".into()))?;
            raw.extend_from_slice(&chunk);
            let Some(end) = raw.iter().rposition(|b| *b == b'\n') else { continue };
            let lines: Vec<u8> = raw.drain(..=end).collect();
            let before = events.text.len();
            if let Err(e) = events.feed(&String::from_utf8_lossy(&lines)) {
                if e == AiError::Limit {
                    set_limit_and_model(db, Some(now()), false)?;
                }
                return Err(e);
            }
            if events.text.len() > before {
                on_text(&events.text[before..]);
            }
            if events.done {
                break;
            }
        }
        let before = events.text.len();
        events.feed(&format!("{}\n", String::from_utf8_lossy(&raw)))?;
        if events.text.len() > before {
            on_text(&events.text[before..]);
        }
        if !events.done {
            return Err(AiError::Failed("ChatGPT's answer was cut off. Try again.".into()));
        }
        if load(db).chatgpt.is_some_and(|c| c.limited_at.is_some()) {
            set_limit_and_model(db, None, false)?;
        }
        return Ok(events.text);
    }
}

/// Records the limit (or that requests work again), and forgets the model when it went away (the learner's
/// choice too: Eksigo picks again).
fn set_limit_and_model(db: &Db, limited_at: Option<i64>, forget_model: bool) -> Result<()> {
    let mut s = load(db);
    if let Some(c) = s.chatgpt.as_mut() {
        c.limited_at = limited_at;
        if forget_model {
            c.model = None;
            c.chosen = None;
        }
    }
    save(db, &s)
}

// ---------------------------------------------------------------- the learner's own key

pub struct Provider {
    pub id: &'static str,
    pub name: &'static str,
    pub base: &'static str,
    /// The usual model, small and cheap: the learner can name another under Advanced.
    pub model: &'static str,
}

pub const PROVIDERS: &[Provider] = &[
    Provider { id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-5-mini" },
    Provider { id: "deepseek", name: "DeepSeek", base: "https://api.deepseek.com", model: "deepseek-chat" },
    Provider { id: "anthropic", name: "Anthropic", base: "https://api.anthropic.com/v1", model: "claude-haiku-5-5" },
    Provider { id: "groq", name: "Groq", base: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
    Provider { id: "openrouter", name: "OpenRouter", base: "https://openrouter.ai/api/v1", model: "openai/gpt-5-mini" },
    Provider { id: "other", name: "your provider", base: "", model: "" },
];

fn provider(id: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|p| p.id == id)
}

async fn key_ask(key: &Key, secret: &str, instructions: &str, turns: &[Turn]) -> Result<String, AiError> {
    let p = provider(&key.provider).ok_or_else(|| AiError::Failed(format!("Unknown provider {}", key.provider)))?;
    let base = if p.id == "other" { key.base_url.trim_end_matches('/') } else { p.base };
    let model = if key.model.is_empty() { p.model } else { key.model.as_str() };
    let anthropic = p.id == "anthropic";
    let messages: Vec<Value> = turns.iter().map(|t| json!({ "role": t.role, "content": t.text })).collect();
    let req = if anthropic {
        http()
            .post(format!("{base}/messages"))
            .header("x-api-key", secret)
            .header("anthropic-version", "2023-06-01")
            .json(&json!({ "model": model, "max_tokens": 2000, "system": instructions, "messages": messages }))
    } else {
        let mut all = vec![json!({ "role": "system", "content": instructions })];
        all.extend(messages);
        http().post(format!("{base}/chat/completions")).bearer_auth(secret).json(&json!({ "model": model, "messages": all }))
    };
    let r = req.timeout(Duration::from_secs(120)).send().await.map_err(|_| offline())?;
    let status = r.status().as_u16();
    let body: Value = r.json().await.unwrap_or(Value::Null);
    let name = p.name;
    match status {
        200..=299 => {}
        401 | 403 => return Err(AiError::Failed(format!("{name} didn't accept the key. Check it and try again."))),
        402 => return Err(AiError::Failed(format!("{name} says the account has no credit left."))),
        404 => return Err(AiError::Failed(format!("{name} doesn't have the model {model}."))),
        429 => return Err(AiError::Failed(format!("{name} says too many requests, or no credit left. Try again later."))),
        _ => {
            let code = error_code(&body);
            return Err(AiError::Failed(format!("{name} couldn't answer ({status}, {code}).")));
        }
    }
    let text = if anthropic {
        body["content"].as_array().map(|c| c.iter().filter_map(|b| b["text"].as_str()).collect::<String>())
    } else {
        body["choices"][0]["message"]["content"].as_str().map(String::from)
    };
    text.filter(|t| !t.trim().is_empty()).ok_or_else(|| AiError::Failed(format!("{name} sent an empty answer.")))
}

/// Tries the key with a tiny request, and keeps it only when it works.
pub async fn set_key(db: &Db, key: Key, secret: &str) -> Result<Status, AiError> {
    let p = provider(&key.provider).ok_or_else(|| AiError::Failed("Choose a provider.".into()))?;
    let secret = secret.trim();
    if secret.is_empty() {
        return Err(AiError::Failed("Paste the key first.".into()));
    }
    if p.id == "other" && (!key.base_url.starts_with("https://") && !key.base_url.starts_with("http://localhost") && !key.base_url.starts_with("http://127.0.0.1")) {
        return Err(AiError::Failed("The address starts with https:// (or http://localhost for a model on this computer).".into()));
    }
    if p.id == "other" && key.model.trim().is_empty() {
        return Err(AiError::Failed("Name the model to use.".into()));
    }
    let key = Key { provider: p.id.into(), base_url: if p.id == "other" { key.base_url.trim().into() } else { String::new() }, model: key.model.trim().into() };
    key_ask(&key, secret, "Answer with the single word OK.", &[user("Are you there?")]).await?;
    set_secret(KEY_SECRET, secret)?;
    let mut s = load(db);
    s.key = Some(key);
    save(db, &s)?;
    Ok(status(db))
}

pub fn remove_key(db: &Db) -> Result<()> {
    forget_secret(KEY_SECRET)?;
    let mut s = load(db);
    s.key = None;
    save(db, &s)
}

/// Asks whichever AI is set up: ChatGPT first, then the key. ChatGPT's answer arrives piece by piece; a key's
/// all at once.
async fn ask(db: &Db, instructions: &str, turns: &[Turn], on_text: OnText<'_>) -> Result<String, AiError> {
    let s = load(db);
    if s.chatgpt.is_some() && tokens().is_some() {
        return chatgpt_ask(db, instructions, turns, on_text).await;
    }
    match (s.key, secret(KEY_SECRET)) {
        (Some(k), Some(secret)) => {
            let text = key_ask(&k, &secret, instructions, turns).await?;
            on_text(&text);
            Ok(text)
        }
        _ if s.chatgpt.is_some() => Err(AiError::Reconnect),
        _ => Err(AiError::NotSetUp),
    }
}

// ---------------------------------------------------------------- what the AI is asked

fn language(code: &str) -> &'static str {
    match code {
        "zh" => "Simplified Chinese",
        "ja" => "Japanese",
        "ko" => "Korean",
        "es" => "Spanish",
        "fr" => "French",
        _ => "English",
    }
}

fn learner(lang: &str) -> String {
    let l = language(lang);
    if l == "English" {
        "The learner listens to English podcasts to improve their listening. Write in plain, simple English.".into()
    } else {
        format!("The learner listens to English podcasts to improve their listening. Their own language is {l}: write in {l}, keeping English words, phrases and examples in English.")
    }
}

const FOLLOW_UP: &str = "If they write in another language, answer in that language. Plain text in short paragraphs: no Markdown \
                         headings, tables or bold.";

/// A question asked before and its answer, sent again so a follow-up makes sense.
#[derive(Debug, Clone, Deserialize)]
pub struct Exchange {
    /// Empty for the first explanation, which wasn't a question.
    #[serde(default)]
    pub question: String,
    pub answer: String,
}

/// What a word or phrase means in this sentence (pressing Explain, or by itself when neither the dictionary nor
/// the translator had anything), or, with `question`, the learner's own question about these words.
pub async fn explain(db: &Db, lang: &str, text: &str, sentence: &str, history: &[Exchange], question: Option<&str>, on_text: OnText<'_>) -> Result<String, AiError> {
    let instructions = format!(
        "{} Explain what the selected words mean in this sentence: the sense they have here, and anything that makes \
         them tricky (an idiom, a phrasal verb, a usual pattern). Two or three short sentences, under 70 words, without \
         repeating the sentence. When they then ask about these words, answer directly, under 100 words. {FOLLOW_UP}",
        learner(lang)
    );
    let mut turns = vec![user(format!("Sentence: {sentence}\nSelected: {text}"))];
    for (i, e) in history.iter().enumerate() {
        if i > 0 || !e.question.is_empty() {
            turns.push(user(e.question.clone()));
        }
        turns.push(Turn { role: "assistant", text: e.answer.clone() });
    }
    match question.map(str::trim).filter(|q| !q.is_empty()) {
        Some(q) if history.is_empty() => turns[0].text.push_str(&format!("\n\n{q}")),
        Some(q) => turns.push(user(q)),
        None if history.is_empty() => {}
        None => return Err(AiError::Failed("Ask a question first.".into())),
    }
    let answer = ask(db, &instructions, &turns, on_text).await?;
    Ok(answer.trim().to_string())
}

/// The original or typed words with each mistake in ⟦ ⟧, so the AI sees exactly what went wrong.
fn marked(words: &[Marked]) -> String {
    let mut out = String::new();
    let mut open = false;
    for w in words {
        let bad = matches!(w.mark, Mark::Missing | Mark::Wrong | Mark::Spelling | Mark::Extra | Mark::Gap);
        if !bad && open {
            out.push('⟧');
            open = false;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        if bad && !open {
            out.push('⟦');
            open = true;
        }
        out.push_str(&w.text);
    }
    if open {
        out.push('⟧');
    }
    out
}

/// Why a mistake happened. The same five everywhere: a sentence's answer, and the episode review.
const REASONS: &str = "- newWord: they don't know the word or phrase: they typed its sounds as other words or syllables, or \
                       left a gap at an uncommon word. Not for a word already in their saved words.\n\
                       - soundsDifferent: they know the words, but fast speech changes how they sound (weak forms, \
                       linking, sounds dropped at the end of a word, similar vowels).\n\
                       - didntCatch: it went by too fast or too quietly, or it's a name or a number, and nothing \
                       suggests they don't know it.\n\
                       - spelling: they heard it right and spelled it wrong.\n\
                       - guessed: they typed other real words that fit the meaning or the grammar but aren't what was said.";

const REASON_KEYS: &[&str] = &["newWord", "soundsDifferent", "didntCatch", "spelling", "guessed"];

fn reason_or_other(r: &str) -> String {
    if REASON_KEYS.contains(&r) { r.into() } else { "didntCatch".into() }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Why {
    pub items: Vec<WhyItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WhyItem {
    /// One of `REASON_KEYS`.
    #[serde(default)]
    pub reason: String,
    pub original: String,
    #[serde(default)]
    pub typed: String,
    /// How it sounds, in IPA.
    #[serde(default)]
    pub said: String,
    /// For a new word: a short meaning in the learner's language.
    #[serde(default)]
    pub meaning: String,
    pub why: String,
}

/// One question about a sentence and its answer: `why` for *Why did I miss this?*, `answer` for the rest.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: i64,
    pub question: String,
    pub why: Option<Why>,
    pub answer: String,
}

/// The conversation about one sentence: per attempt on Results, per episode on Listen (no attempt).
pub fn thread(conn: &Connection, item_id: i64, attempt_id: Option<i64>, idx: i64) -> Result<Vec<Message>> {
    let mut st = conn.prepare("SELECT id, question, why, answer FROM ai_messages WHERE item_id = ?1 AND attempt_id IS ?2 AND idx = ?3 ORDER BY id")?;
    let rows = st
        .query_map(params![item_id, attempt_id, idx], |r| {
            let why: Option<String> = r.get(2)?;
            Ok(Message { id: r.get(0)?, question: r.get(1)?, why: why.and_then(|w| serde_json::from_str(&w).ok()), answer: r.get(3)? })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// The sentences with a conversation, to mark them on the page.
pub fn asked(conn: &Connection, item_id: i64, attempt_id: Option<i64>) -> Result<Vec<i64>> {
    let mut st = conn.prepare("SELECT DISTINCT idx FROM ai_messages WHERE item_id = ?1 AND attempt_id IS ?2 ORDER BY idx")?;
    let rows = st.query_map(params![item_id, attempt_id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

fn why_as_text(w: &Why) -> String {
    w.items.iter().map(|i| format!("{} — {} (typed: {}): {}", i.reason, i.original, i.typed, i.why)).collect::<Vec<_>>().join("\n")
}

/// The learner's saved words that appear in `text`, so the AI doesn't call them new.
fn saved_in(conn: &Connection, text: &str) -> Result<Vec<String>> {
    let plain = |s: &str| format!(" {} ", crate::dictionary::tokens(s).join(" "));
    let hay = plain(text);
    let mut st = conn.prepare("SELECT text FROM saved_words")?;
    let all: Vec<String> = st.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(all.into_iter().filter(|w| hay.contains(&plain(w))).collect())
}

/// What the AI is told about a sentence: the sentence (with the mistakes marked), what was typed, the sentences
/// around it, and hints for the reasons. Also whether there were mistakes to explain.
fn sentence_context(conn: &Connection, item_id: i64, attempt_id: Option<i64>, idx: i64) -> Result<(String, bool), AiError> {
    let sentences = transcribe::sentences(conn, item_id)?;
    let text = |i: i64| sentences.iter().find(|s| s.idx == i).map(|s| s.text.clone());
    let title: String = conn.query_row("SELECT title FROM items WHERE id = ?1", [item_id], |r| r.get(0)).unwrap_or_default();
    let answer = match attempt_id {
        Some(a) => dictation::answers(conn, a)?.into_iter().find(|a| a.idx == idx && a.kind == "typed"),
        None => None,
    };
    let plain = answer.as_ref().map(|a| a.original.clone()).or_else(|| text(idx)).ok_or_else(|| AiError::Failed("That sentence isn't in the transcript.".into()))?;
    let mut out = format!("Episode: {title}\n");
    let mut mistakes = false;
    match &answer {
        Some(a) => {
            let (o, t) = match &a.comparison {
                Some(c) => (marked(&c.original), marked(&c.typed)),
                None => (a.original.clone(), a.typed.clone()),
            };
            mistakes = a.credit < a.total as f64;
            out.push_str(&format!("Sentence {}: {o}\nWhat they typed: {}\n", idx + 1, if t.trim().is_empty() { "(nothing)".into() } else { t }));
            if let Some(c) = &a.comparison {
                let spelled: Vec<_> = c.original.iter().filter(|w| w.mark == Mark::Spelling).map(|w| w.text.as_str()).collect();
                if !spelled.is_empty() {
                    out.push_str(&format!("Marked by the app as spelling only: {}\n", spelled.join(", ")));
                }
            }
        }
        None => out.push_str(&format!("Sentence {}: {plain}\n", idx + 1)),
    }
    if let Some(b) = text(idx - 1) {
        out.push_str(&format!("The sentence before: {b}\n"));
    }
    if let Some(n) = text(idx + 1) {
        out.push_str(&format!("The sentence after: {n}\n"));
    }
    let saved = saved_in(conn, &plain)?;
    if !saved.is_empty() {
        out.push_str(&format!("Already in their saved words: {}\n", saved.join(", ")));
    }
    Ok((out, mistakes))
}

/// The question the *Why did I miss this?* chip asks: answered by reason, as cards.
pub const WHY_QUESTION: &str = "Why did I miss this?";

/// Asks about one sentence and keeps the question and answer with it. `why`: the *Why did I miss this?* chip,
/// answered by reason; otherwise the learner's own question (or another chip), answered as it's written.
pub async fn ask_sentence(
    db: &Db,
    lang: &str,
    item_id: i64,
    attempt_id: Option<i64>,
    idx: i64,
    question: &str,
    why: bool,
    on_text: OnText<'_>,
) -> Result<Message, AiError> {
    let question = question.trim();
    if question.is_empty() && !why {
        return Err(AiError::Failed("Type a question first.".into()));
    }
    let (context, earlier) = {
        let conn = db.conn();
        (sentence_context(&conn, item_id, attempt_id, idx)?, thread(&conn, item_id, attempt_id, idx)?)
    };
    let (context, mistakes) = context;
    let message = if why {
        if !mistakes {
            return Err(AiError::Failed("This sentence has no mistakes to explain.".into()));
        }
        let instructions = format!(
            "{} They typed what they heard in one sentence of an episode. Mistakes are in ⟦ ⟧: in the sentence, the words \
             they missed or got wrong; in what they typed, their wrong words (_ is a gap they left). Work out why each \
             mistake happened, choosing one reason:\n{REASONS}\nAnswer only with JSON: {{\"items\": [{{\"reason\": \"one of \
             the five\", \"original\": \"the words in the sentence\", \"typed\": \"what they typed instead, or _ when \
             nothing\", \"said\": \"how it sounds here, in IPA between slashes\", \"meaning\": \"for newWord only: a short \
             meaning, else empty\", \"why\": \"one or two short sentences\"}}]}}. Words next to each other are one \
             mistake. At most four items, most useful first.",
            learner(lang)
        );
        let mut w: Why = json_in(&ask(db, &instructions, &[user(context)], &|_| {}).await?)?;
        if w.items.is_empty() {
            return Err(AiError::Failed("The AI found nothing to explain in this sentence.".into()));
        }
        for i in &mut w.items {
            i.reason = reason_or_other(&i.reason);
        }
        (WHY_QUESTION.to_string(), Some(w), String::new())
    } else {
        let instructions = format!(
            "{} They're working on one sentence from an episode they listen to, and ask about it. Answer their question \
             directly and briefly: under 120 words unless they ask for more. Use the sentences around it only to \
             understand this one. {FOLLOW_UP}",
            learner(lang)
        );
        // The last few questions, so a follow-up makes sense; the sentence goes with the first.
        let recent = &earlier[earlier.len().saturating_sub(6)..];
        let mut turns: Vec<Turn> = Vec::new();
        for m in recent {
            turns.push(user(m.question.clone()));
            turns.push(Turn { role: "assistant", text: m.why.as_ref().map(why_as_text).unwrap_or_else(|| m.answer.clone()) });
        }
        turns.push(user(question));
        turns[0].text = format!("{context}\n{}", turns[0].text);
        let answer = ask(db, &instructions, &turns, on_text).await?;
        (question.to_string(), None, answer.trim().to_string())
    };
    let (question, why, answer) = message;
    let conn = db.conn();
    conn.execute(
        "INSERT INTO ai_messages (item_id, attempt_id, idx, question, why, answer, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![item_id, attempt_id, idx, question, why.as_ref().map(serde_json::to_string).transpose().map_err(anyhow::Error::from)?, answer, now()],
    )
    .map_err(anyhow::Error::from)?;
    Ok(Message { id: conn.last_insert_rowid(), question, why, answer })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Review {
    pub summary: String,
    pub patterns: Vec<Pattern>,
    #[serde(default)]
    pub next: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Pattern {
    /// One of `REASON_KEYS`.
    #[serde(default)]
    pub reason: String,
    pub count: i64,
    /// A few of the words or phrases, as in the original: for new words, the ones to add to My words.
    #[serde(default)]
    pub words: Vec<String>,
    pub explanation: String,
    /// Sentence numbers as shown (from 1).
    #[serde(default)]
    pub sentences: Vec<i64>,
}

/// The JSON object in an answer, even with a sentence or a code fence around it.
fn json_in<T: for<'de> Deserialize<'de>>(answer: &str) -> Result<T, AiError> {
    let (Some(a), Some(b)) = (answer.find('{'), answer.rfind('}')) else {
        return Err(AiError::Failed("The AI's answer wasn't in the expected form. Try again.".into()));
    };
    serde_json::from_str(&answer[a..=b]).map_err(|_| AiError::Failed("The AI's answer wasn't in the expected form. Try again.".into()))
}

fn cached<T: for<'de> Deserialize<'de>>(conn: &Connection, attempt_id: i64, idx: i64, lang: &str) -> Option<T> {
    let json: String = conn
        .query_row("SELECT json FROM ai_notes WHERE attempt_id = ?1 AND idx = ?2 AND lang = ?3", params![attempt_id, idx, lang], |r| r.get(0))
        .optional()
        .ok()??;
    serde_json::from_str(&json).ok()
}

fn keep<T: Serialize>(conn: &Connection, attempt_id: i64, idx: i64, lang: &str, value: &T) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO ai_notes (attempt_id, idx, lang, json, created) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![attempt_id, idx, lang, serde_json::to_string(value)?, now()],
    )?;
    Ok(())
}

/// At most this many sentences go into a review: enough to see the patterns.
const REVIEW_SENTENCES: usize = 60;

/// The review of a finished attempt: its mistakes grouped by reason. None when there were no mistakes. Worked out
/// once and kept.
pub async fn review(db: &Db, lang: &str, attempt_id: i64) -> Result<Option<Review>, AiError> {
    let input = {
        let conn = db.conn();
        if let Some(r) = cached::<Review>(&conn, attempt_id, -1, lang).filter(|r| r.patterns.iter().all(|p| !p.reason.is_empty())) {
            return Ok(Some(r));
        }
        let attempt = dictation::attempt(&conn, attempt_id)?;
        if attempt.finished_at.is_none() {
            return Err(AiError::Failed("The review comes when the episode is finished.".into()));
        }
        let title: String = conn.query_row("SELECT title FROM items WHERE id = ?1", [attempt.item_id], |r| r.get(0)).unwrap_or_default();
        let answers = dictation::answers(&conn, attempt_id)?;
        let typed: Vec<_> = answers.iter().filter(|a| a.kind == "typed").collect();
        let wrong: Vec<_> = typed.iter().filter(|a| a.credit < a.total as f64).collect();
        if wrong.is_empty() {
            return Ok(None);
        }
        let (credit, total) = typed.iter().fold((0.0, 0i64), |(c, t), a| (c + a.credit, t + a.total));
        let mut input = format!("Episode: {title}\nWords right: {}%\nSentences with mistakes: {}\n\n", (100.0 * credit / total.max(1) as f64).round(), wrong.len());
        let mut saved = Vec::new();
        for a in wrong.iter().take(REVIEW_SENTENCES) {
            let (o, t) = match &a.comparison {
                Some(c) => (marked(&c.original), marked(&c.typed)),
                None => (a.original.clone(), a.typed.clone()),
            };
            input.push_str(&format!("{}. Original: {o}\n   Typed: {t}\n", a.idx + 1));
            saved.extend(saved_in(&conn, &a.original)?);
        }
        saved.sort();
        saved.dedup();
        if !saved.is_empty() {
            input.push_str(&format!("\nAlready in their saved words: {}\n", saved.join(", ")));
        }
        input
    };
    let instructions = format!(
        "{} They just finished dictating an episode, sentence by sentence. Below are the sentences they got wrong, \
         numbered; mistakes are in ⟦ ⟧. Give each mistake one reason:\n{REASONS}\nThen group the mistakes by reason, \
         biggest group first. Answer only with JSON: {{\"summary\": \"one or two sentences on how it went and the main \
         reason for the mistakes\", \"patterns\": [{{\"reason\": \"one of the five\", \"count\": number of mistakes, \
         \"words\": [up to five of the missed words or phrases, as in the original; for newWord, the words worth \
         learning], \"explanation\": \"one or two sentences about this group\", \"sentences\": [the sentence \
         numbers]}}], \"next\": \"one concrete thing to do next time, in a sentence or two\"}}. One pattern per reason \
         that occurs.",
        learner(lang)
    );
    let mut r: Review = json_in(&ask(db, &instructions, &[user(input)], &|_| {}).await?)?;
    for p in &mut r.patterns {
        p.reason = reason_or_other(&p.reason);
    }
    keep(&db.conn(), attempt_id, -1, lang, &r)?;
    Ok(Some(r))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(claims: Value) -> String {
        format!("e30.{}.sig", URL_SAFE_NO_PAD.encode(claims.to_string()))
    }

    #[test]
    fn the_identity_is_checked() {
        let good = json!({ "iss": ISSUER, "aud": "app_1", "nonce": "n", "exp": 2000, "sub": "user-1", "email": "a@b.c",
                           "https://api.openai.com/auth": { "chatgpt_plan_type": "plus" } });
        let id = identity(&token(good.clone()), "app_1", "n", 1000).unwrap();
        assert_eq!(id, Identity { subject: "user-1".into(), email: Some("a@b.c".into()), plan: Some("plus".into()) });
        for (k, v) in [("iss", json!("https://evil.example")), ("aud", json!("other")), ("nonce", json!("x")), ("exp", json!(10))] {
            let mut bad = good.clone();
            bad[k] = v;
            assert!(identity(&token(bad), "app_1", "n", 1000).is_err(), "{k}");
        }
        let mut list = good;
        list["aud"] = json!(["x", "app_1"]);
        assert!(identity(&token(list), "app_1", "n", 1000).is_ok());
    }

    #[test]
    fn error_codes_come_from_either_shape() {
        assert_eq!(error_code(&json!({ "error": "invalid_grant" })), "invalid_grant");
        assert_eq!(error_code(&json!({ "error": { "code": "subscription_sharing_usage_limit_exceeded", "message": "…" } })), "subscription_sharing_usage_limit_exceeded");
        assert_eq!(error_code(&json!({ "detail": { "error": { "code": "model_not_found" } } })), "model_not_found");
        assert_eq!(error_code(&json!({ "error": { "code": "has spaces <script>" } })), "api_error");
        assert_eq!(error_code(&Value::Null), "api_error");
    }

    #[test]
    fn errors_are_sorted_for_the_learner() {
        assert_eq!(problem(429, "subscription_sharing_usage_limit_exceeded"), AiError::Limit);
        assert_eq!(problem(429, "subscription_sharing_v2_usage_limit_exceeded"), AiError::Limit);
        assert_eq!(problem(401, "invalid_token"), AiError::Reconnect);
        assert!(matches!(problem(403, "subscription_sharing_user_not_eligible"), AiError::Failed(m) if m.contains("Plus or Pro")));
        assert!(matches!(problem(503, "api_error"), AiError::Failed(m) if m.contains("busy")));
    }

    #[test]
    fn the_stream_is_read_across_chunks() {
        let mut e = Events::default();
        e.feed("event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"Hel").unwrap();
        e.feed("lo\"}\n\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\" there\"}\n").unwrap();
        assert!(!e.done);
        e.feed("data: {\"type\":\"response.completed\",\"response\":{}}\n").unwrap();
        assert_eq!((e.text.as_str(), e.done), ("Hello there", true));

        let mut limit = Events::default();
        let r = limit.feed("data: {\"type\":\"error\",\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}\n");
        assert_eq!(r, Err(AiError::Limit));
    }

    #[test]
    fn a_small_model_is_chosen() {
        let list = models_in(&json!({ "models": [
            { "slug": "gpt-5", "display_name": "GPT-5", "visibility": "list" },
            { "slug": "gpt-5-nano", "visibility": "list" },
            { "slug": "gpt-5-mini", "display_name": "GPT-5 mini", "visibility": "list" },
            { "slug": "internal", "visibility": "hide" },
        ] }));
        assert_eq!(list.iter().map(|m| (m.name.as_str(), m.small)).collect::<Vec<_>>(), [("GPT-5", false), ("gpt-5-nano", true), ("GPT-5 mini", true)]);
        assert_eq!(pick_model(&list).as_deref(), Some("gpt-5-mini"));
        assert_eq!(pick_model(&list[..2]).as_deref(), Some("gpt-5-nano"));
        assert_eq!(pick_model(&list[..1]).as_deref(), Some("gpt-5"));
        assert_eq!(pick_model(&[]), None);
    }

    #[test]
    fn the_chosen_model_wins_and_is_forgotten_when_it_goes_away() {
        let db = Db::open_in_memory().unwrap();
        let mut s = Stored::default();
        s.chatgpt = Some(ChatGpt { subject: "u".into(), email: None, plan: None, model: Some("gpt-5-mini".into()), chosen: None, limited_at: None });
        save(&db, &s).unwrap();
        let st = set_model(&db, Some("gpt-5".into())).unwrap();
        assert_eq!((st.chatgpt.as_ref().unwrap().model.as_deref(), st.chatgpt.as_ref().unwrap().chosen), (Some("gpt-5"), true));
        set_limit_and_model(&db, None, true).unwrap();
        let c = load(&db).chatgpt.unwrap();
        assert_eq!((c.model, c.chosen), (None, None));
    }

    #[test]
    fn a_conversation_is_kept_with_its_sentence() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        conn.execute("INSERT INTO items (id, title, source, state, added_at) VALUES (1, 'x', 'My files', 'ready', 0)", []).unwrap();
        conn.execute("INSERT INTO attempts (id, item_id, started_at, updated_at) VALUES (7, 1, 0, 0)", []).unwrap();
        let add = |attempt: Option<i64>, idx: i64, q: &str| {
            conn.execute("INSERT INTO ai_messages (item_id, attempt_id, idx, question, why, answer, created) VALUES (1, ?1, ?2, ?3, NULL, 'a', 0)", params![attempt, idx, q]).unwrap();
        };
        add(Some(7), 3, "one");
        add(Some(7), 3, "two");
        add(None, 3, "on listen");
        add(Some(7), 5, "other");
        assert_eq!(thread(&conn, 1, Some(7), 3).unwrap().iter().map(|m| m.question.as_str()).collect::<Vec<_>>(), ["one", "two"]);
        assert_eq!(thread(&conn, 1, None, 3).unwrap().len(), 1);
        assert_eq!(asked(&conn, 1, Some(7)).unwrap(), [3, 5]);
        conn.execute("DELETE FROM attempts WHERE id = 7", []).unwrap();
        assert!(thread(&conn, 1, Some(7), 3).unwrap().is_empty(), "kept no longer than the attempt");
    }

    #[test]
    fn saved_words_are_found_in_a_sentence() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        for w in ["follow through", "plan", "ugh"] {
            conn.execute("INSERT INTO saved_words (text, added_at, updated_at) VALUES (?1, 0, 0)", [w]).unwrap();
        }
        assert_eq!(saved_in(&conn, "People who wrote plans were likely to Follow through.").unwrap(), ["follow through"]);
    }

    #[test]
    fn mistakes_are_marked_for_the_ai() {
        let m = |t: &str, mark| Marked { text: t.into(), mark };
        let words = [m("you", Mark::Correct), m("don't", Mark::Missing), m("have", Mark::Missing), m("to", Mark::Missing), m("feel", Mark::Correct), m("start", Mark::Wrong)];
        assert_eq!(marked(&words), "you ⟦don't have to⟧ feel ⟦start⟧");
    }

    #[test]
    fn json_is_found_inside_an_answer() {
        let w: Why = json_in("Sure!\n```json\n{\"items\":[{\"original\":\"start\",\"typed\":\"stay\",\"said\":\"/stɑː/\",\"why\":\"t is dropped\"}]}\n```").unwrap();
        assert_eq!(w.items[0].typed, "stay");
        assert!(json_in::<Why>("no json here").is_err());
    }

    #[test]
    fn the_host_id_is_made_once() {
        let db = Db::open_in_memory().unwrap();
        let a = host_id(&db).unwrap();
        assert!(a.starts_with("urn:uuid:") && a.len() == 45, "{a}");
        assert_eq!(host_id(&db).unwrap(), a);
    }

    #[test]
    fn notes_are_kept_per_attempt_and_language() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        conn.execute("INSERT INTO items (id, title, source, state, added_at) VALUES (1, 'x', 'My files', 'ready', 0)", []).unwrap();
        conn.execute("INSERT INTO attempts (id, item_id, started_at, updated_at) VALUES (7, 1, 0, 0)", []).unwrap();
        let w = Why { items: vec![WhyItem { reason: "soundsDifferent".into(), original: "a".into(), typed: "_".into(), said: "/ə/".into(), meaning: String::new(), why: "weak".into() }] };
        keep(&conn, 7, 3, "zh", &w).unwrap();
        assert_eq!(cached::<Why>(&conn, 7, 3, "zh"), Some(w));
        assert_eq!(cached::<Why>(&conn, 7, 3, "ja"), None);
        conn.execute("DELETE FROM attempts WHERE id = 7", []).unwrap();
        assert_eq!(cached::<Why>(&conn, 7, 3, "zh"), None, "kept no longer than the attempt");
    }
}
