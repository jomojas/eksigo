//! Finding podcasts: Apple's podcast directory (search, top charts, lookup by id), our own
//! *Good for learners* list, and reading RSS feeds.

use std::{sync::LazyLock, time::Duration};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};

pub static HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(concat!("Eksigo/", env!("CARGO_PKG_VERSION"), " (+https://eksigo.com)"))
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .build()
        .expect("building the HTTP client")
});

/// A show as listed in search results, charts and recommendations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub apple_id: Option<String>,
    pub title: String,
    pub author: String,
    /// Missing in Apple's charts; found with `lookup` when the show is opened.
    pub feed_url: Option<String>,
    pub artwork_url: Option<String>,
    /// Genre for search results, a line about the show for recommendations.
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Deserialize)]
struct Learner {
    #[serde(rename = "appleId")]
    apple_id: String,
    title: String,
    author: String,
    #[serde(rename = "feedUrl")]
    feed_url: String,
    #[serde(rename = "artworkUrl")]
    artwork_url: String,
    blurb: String,
}

/// Podcasts with clear speech at a steady pace, chosen by us.
pub fn for_learners() -> Vec<Listing> {
    let list: Vec<Learner> = serde_json::from_str(include_str!("../data/learners.json")).expect("data/learners.json");
    list.into_iter()
        .map(|l| Listing {
            apple_id: Some(l.apple_id),
            title: l.title,
            author: l.author,
            feed_url: Some(l.feed_url),
            artwork_url: Some(l.artwork_url),
            note: Some(l.blurb),
        })
        .collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItunesResult {
    collection_id: Option<u64>,
    collection_name: Option<String>,
    artist_name: Option<String>,
    feed_url: Option<String>,
    artwork_url600: Option<String>,
    artwork_url100: Option<String>,
    primary_genre_name: Option<String>,
}

#[derive(Deserialize)]
struct ItunesResults {
    results: Vec<ItunesResult>,
}

impl ItunesResult {
    fn listing(self) -> Option<Listing> {
        Some(Listing {
            apple_id: self.collection_id.map(|id| id.to_string()),
            title: self.collection_name?,
            author: self.artist_name.unwrap_or_default(),
            feed_url: Some(self.feed_url?),
            artwork_url: self.artwork_url600.or(self.artwork_url100),
            note: self.primary_genre_name,
        })
    }
}

fn country_code(country: &str) -> String {
    let c = country.trim().to_ascii_lowercase();
    if c.len() == 2 && c.chars().all(|ch| ch.is_ascii_lowercase()) { c } else { "us".into() }
}

/// Apple podcast search. Only shows with an RSS feed are returned, since those are the ones we can play.
pub async fn search(term: &str, country: &str) -> Result<Vec<Listing>> {
    let term = term.trim();
    if term.is_empty() {
        return Ok(Vec::new());
    }
    let res: ItunesResults = HTTP
        .get("https://itunes.apple.com/search")
        .query(&[("media", "podcast"), ("entity", "podcast"), ("limit", "40"), ("term", term), ("country", &country_code(country))])
        .send()
        .await
        .context("Apple's podcast search can't be reached")?
        .error_for_status()?
        .json()
        .await
        .context("Apple's podcast search sent something unexpected")?;
    Ok(res.results.into_iter().filter_map(ItunesResult::listing).collect())
}

/// Finds a show's feed from its Apple id.
pub async fn lookup(apple_id: &str) -> Result<Listing> {
    let res: ItunesResults = HTTP
        .get("https://itunes.apple.com/lookup")
        .query(&[("id", apple_id), ("entity", "podcast")])
        .send()
        .await
        .context("Apple's podcast directory can't be reached")?
        .error_for_status()?
        .json()
        .await?;
    res.results
        .into_iter()
        .find_map(ItunesResult::listing)
        .ok_or_else(|| anyhow!("This show has no public RSS feed, so it can't be played in Eksigo."))
}

/// Apple's top podcasts in a country, overall or in one genre (Apple's genre ids, e.g. 1304 Education).
pub async fn chart(country: &str, genre: Option<u32>) -> Result<Vec<Listing>> {
    let genre = genre.map(|g| format!("/genre={g}")).unwrap_or_default();
    let url = format!("https://itunes.apple.com/{}/rss/toppodcasts/limit=30{genre}/json", country_code(country));
    let body: serde_json::Value = HTTP
        .get(url)
        .send()
        .await
        .context("Apple's charts can't be reached")?
        .error_for_status()?
        .json()
        .await?;
    let label = |v: &serde_json::Value| v.get("label").and_then(|l| l.as_str()).map(str::to_string);
    let entries = body["feed"]["entry"].as_array().cloned().unwrap_or_default();
    Ok(entries
        .iter()
        .filter_map(|e| {
            Some(Listing {
                apple_id: e["id"]["attributes"]["im:id"].as_str().map(str::to_string),
                title: label(&e["im:name"])?,
                author: label(&e["im:artist"]).unwrap_or_default(),
                feed_url: None,
                artwork_url: e["im:image"].as_array().and_then(|imgs| imgs.last()).and_then(label),
                note: e["category"]["attributes"]["label"].as_str().map(str::to_string),
            })
        })
        .collect())
}

/// A show and its episodes, read from its feed.
#[derive(Debug, Clone, PartialEq)]
pub struct Feed {
    pub title: String,
    pub author: String,
    pub description: String,
    pub artwork_url: Option<String>,
    pub episodes: Vec<FeedEpisode>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FeedEpisode {
    pub guid: String,
    pub title: String,
    /// Unix seconds.
    pub published_at: Option<i64>,
    pub duration_s: Option<f64>,
    pub audio_url: String,
    pub audio_bytes: Option<i64>,
    pub description: String,
    pub artwork_url: Option<String>,
}

pub async fn fetch_feed(url: &str) -> Result<Feed> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        bail!("A feed link starts with http:// or https://");
    }
    let bytes = HTTP
        .get(url)
        .send()
        .await
        .context("The feed can't be reached")?
        .error_for_status()
        .context("The feed's server refused")?
        .bytes()
        .await
        .context("The feed stopped loading partway")?;
    parse_feed(&bytes)
}

pub fn parse_feed(bytes: &[u8]) -> Result<Feed> {
    let channel = rss::Channel::read_from(bytes).map_err(|_| anyhow!("This link isn't a podcast feed."))?;
    let itunes = channel.itunes_ext();
    let artwork_url = itunes
        .and_then(|i| i.image())
        .map(str::to_string)
        .or_else(|| channel.image().map(|i| i.url().to_string()));
    let episodes = channel
        .items()
        .iter()
        .filter_map(|item| {
            let enc = item.enclosure()?;
            let kind = enc.mime_type();
            let playable = kind.starts_with("audio/") || kind.starts_with("video/") || kind.is_empty();
            if !playable || enc.url().is_empty() {
                return None;
            }
            let it = item.itunes_ext();
            Some(FeedEpisode {
                guid: item.guid().map(|g| g.value().to_string()).unwrap_or_else(|| enc.url().to_string()),
                title: item.title().map(clean_text).unwrap_or_else(|| "Untitled episode".into()),
                published_at: item.pub_date().and_then(parse_date),
                duration_s: it.and_then(|i| i.duration()).and_then(parse_duration),
                audio_url: enc.url().trim().to_string(),
                audio_bytes: enc.length().trim().parse().ok().filter(|n: &i64| *n > 0),
                description: item
                    .description()
                    .or_else(|| it.and_then(|i| i.summary()))
                    .map(clean_text)
                    .unwrap_or_default(),
                artwork_url: it.and_then(|i| i.image()).map(str::to_string),
            })
        })
        .collect();
    Ok(Feed {
        title: clean_text(channel.title()),
        author: itunes.and_then(|i| i.author()).map(clean_text).unwrap_or_default(),
        description: clean_text(itunes.and_then(|i| i.summary()).unwrap_or(channel.description())),
        artwork_url,
        episodes,
    })
}

/// RFC 2822 as the RSS spec says, with the variants found in real feeds.
fn parse_date(s: &str) -> Option<i64> {
    let s = s.trim();
    chrono::DateTime::parse_from_rfc2822(s)
        .or_else(|_| chrono::DateTime::parse_from_rfc3339(s))
        .ok()
        .map(|d| d.timestamp())
        .or_else(|| {
            // "Mon, 3 Nov 2025 10:00:00 GMT" with a named zone chrono doesn't know: read it as UTC.
            let no_zone = s.rsplit_once(' ').map(|(head, _)| head)?;
            chrono::NaiveDateTime::parse_from_str(no_zone, "%a, %d %b %Y %H:%M:%S").ok().map(|d| d.and_utc().timestamp())
        })
}

/// "1:02:03", "26:40" or "1600" (seconds).
fn parse_duration(s: &str) -> Option<f64> {
    let parts: Vec<f64> = s.trim().split(':').map(|p| p.trim().parse::<f64>()).collect::<Result<_, _>>().ok()?;
    let secs = parts.iter().fold(0.0, |acc, p| acc * 60.0 + p);
    (parts.len() <= 3 && secs > 0.0).then_some(secs)
}

/// Feed text without HTML tags, entities decoded and whitespace tidied.
pub fn clean_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '<' => {
                in_tag = true;
                // Paragraph and line breaks become spaces, so words don't run together.
                out.push(' ');
            }
            '>' if in_tag => in_tag = false,
            _ if in_tag => {}
            '&' => {
                let mut entity = String::new();
                while let Some(&n) = chars.peek() {
                    if n == ';' || entity.len() > 8 {
                        break;
                    }
                    entity.push(n);
                    chars.next();
                }
                if chars.peek() == Some(&';') {
                    chars.next();
                    out.push_str(&decode_entity(&entity).unwrap_or_else(|| format!("&{entity};")));
                } else {
                    out.push('&');
                    out.push_str(&entity);
                }
            }
            _ => out.push(c),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn decode_entity(e: &str) -> Option<String> {
    let c = match e {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => ' ',
        "rsquo" | "lsquo" => '’',
        "ldquo" | "rdquo" => '"',
        "mdash" => '—',
        "ndash" => '–',
        "hellip" => '…',
        _ => {
            let n = e.strip_prefix('#')?;
            let code = match n.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => n.parse().ok()?,
            };
            char::from_u32(code)?
        }
    };
    Some(c.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <title>The Morning Walk</title>
  <description>Fallback description</description>
  <itunes:author>Northfield Audio</itunes:author>
  <itunes:summary><![CDATA[<p>Two friends walk &amp; talk.</p>]]></itunes:summary>
  <itunes:image href="https://example.com/show.jpg"/>
  <item>
    <title>Why small habits beat big plans</title>
    <guid isPermaLink="false">ep-2</guid>
    <pubDate>Mon, 03 Nov 2025 06:00:00 +0000</pubDate>
    <itunes:duration>24:10</itunes:duration>
    <enclosure url="https://example.com/ep2.mp3" length="23000000" type="audio/mpeg"/>
    <description>Tiny &#8220;boring&#8221; steps.</description>
  </item>
  <item>
    <title>A post with no audio</title>
    <guid>post-1</guid>
  </item>
  <item>
    <title>Sleep, coffee and the afternoon dip</title>
    <pubDate>Mon, 13 Oct 2025 06:00:00 GMT</pubDate>
    <itunes:duration>1755</itunes:duration>
    <enclosure url="https://example.com/ep1.mp3" length="0" type="audio/mpeg"/>
  </item>
</channel>
</rss>"#;

    #[test]
    fn reads_a_podcast_feed() {
        let f = parse_feed(FEED.as_bytes()).unwrap();
        assert_eq!(f.title, "The Morning Walk");
        assert_eq!(f.author, "Northfield Audio");
        assert_eq!(f.description, "Two friends walk & talk.");
        assert_eq!(f.artwork_url.as_deref(), Some("https://example.com/show.jpg"));
        assert_eq!(f.episodes.len(), 2, "the item without audio is left out");

        let e = &f.episodes[0];
        assert_eq!(e.guid, "ep-2");
        assert_eq!(e.duration_s, Some(1450.0));
        assert_eq!(e.audio_bytes, Some(23_000_000));
        assert_eq!(e.published_at, Some(1_762_149_600));
        assert_eq!(e.description, "Tiny \u{201c}boring\u{201d} steps.");

        let e = &f.episodes[1];
        assert_eq!(e.guid, "https://example.com/ep1.mp3", "no guid: the audio link identifies it");
        assert_eq!(e.duration_s, Some(1755.0));
        assert_eq!(e.audio_bytes, None);
        assert!(e.published_at.is_some());
    }

    #[test]
    fn rejects_a_web_page() {
        assert!(parse_feed(b"<!doctype html><html><body>Hi</body></html>").is_err());
    }

    #[test]
    fn durations_in_every_form() {
        assert_eq!(parse_duration("1:02:03"), Some(3723.0));
        assert_eq!(parse_duration("26:40"), Some(1600.0));
        assert_eq!(parse_duration("95"), Some(95.0));
        assert_eq!(parse_duration(""), None);
        assert_eq!(parse_duration("soon"), None);
    }

    #[test]
    fn cleans_html() {
        assert_eq!(clean_text("<p>One</p><p>two &amp; three&nbsp;&#x2014; four</p>"), "One two & three — four");
        assert_eq!(clean_text("Fish & chips"), "Fish & chips");
    }

    #[test]
    fn the_learners_list_loads() {
        let l = for_learners();
        assert!(l.len() >= 8);
        assert!(l.iter().all(|s| s.feed_url.as_deref().is_some_and(|u| u.starts_with("http"))));
    }
}

/// Reads every feed on the learners list over the network: `cargo test -- --ignored`.
#[cfg(test)]
mod network {
    use super::*;

    #[tokio::test]
    #[ignore = "uses the network"]
    async fn every_learner_feed_reads() {
        for l in for_learners() {
            let f = fetch_feed(l.feed_url.as_deref().unwrap()).await.unwrap_or_else(|e| panic!("{}: {e:#}", l.title));
            let e = &f.episodes[0];
            println!("{:40} {:>5} episodes · latest {:?} · {:?} s", l.title, f.episodes.len(), e.published_at, e.duration_s);
            assert!(!f.episodes.is_empty(), "{}", l.title);
        }
        assert!(!search("6 minute english", "gb").await.unwrap().is_empty());
        assert!(!chart("gb", Some(1304)).await.unwrap().is_empty());
        assert!(lookup("262026947").await.unwrap().feed_url.is_some());
    }
}
