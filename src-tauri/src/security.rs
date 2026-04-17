// [Req #301, #292] Security layer — financial hard-block before AI egress,
// plus SQLCipher passphrase acquisition from OS keyring.
//
// CRITICAL: No prompt may leave this process with monetary values embedded.
// Every outbound AI payload MUST pass through `sanitize_for_ai()` first.

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

// ── Keyring constants ──────────────────────────────────────────────
const KEYRING_SERVICE: &str = "com.proseal.brain";
const KEYRING_USER: &str = "db_passphrase";

/// [Req #292] Load SQLCipher passphrase from OS keyring.
/// Falls back to env `PROSEAL_DEV_PASSPHRASE` in dev builds only.
pub fn load_db_passphrase() -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("keyring init failed: {}", e))?;

    match entry.get_password() {
        Ok(pw) => Ok(pw),
        Err(keyring::Error::NoEntry) => {
            #[cfg(debug_assertions)]
            {
                if let Ok(dev) = std::env::var("PROSEAL_DEV_PASSPHRASE") {
                    log::warn!("[security] using dev passphrase from env");
                    return Ok(dev);
                }
            }
            Err("no passphrase set; user must initialize app".into())
        }
        Err(e) => Err(format!("keyring read failed: {}", e)),
    }
}

/// [Req #292] Persist passphrase to OS keyring (first-run setup).
pub fn save_db_passphrase(pw: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("keyring init failed: {}", e))?;
    entry
        .set_password(pw)
        .map_err(|e| format!("keyring write failed: {}", e))
}

// ────────────────────────────────────────────────────────────────────
// [Req #301] FINANCIAL HARD-BLOCK — no currency/money data to external AI
// ────────────────────────────────────────────────────────────────────

/// Field names that are ALWAYS stripped from AI payloads, regardless of value.
/// Matches quote/client/interaction schema fields carrying monetary data.
const BLOCKED_KEYS: &[&str] = &[
    "price", "prices", "total", "subtotal", "grand_total",
    "discount", "discount_percent", "margin", "markup",
    "cost", "costs", "unit_cost",
    "revenue", "profit", "loss_amount",
    "amount", "amounts", "currency_amount",
    "tax", "vat", "net", "gross",
    "payment", "payments", "paid", "due",
    "balance", "deposit", "refund",
    // Hebrew keys (per proseal operator context)
    "מחיר", "סכום", "עלות", "רווח", "הנחה",
];

/// Currency literal patterns: $1,234.56  |  €99.99  |  ₪ 100  |  100 USD  |  100 שח
/// Case-insensitive. Applied to every string value in a JSON payload.
static MONEY_REGEXES: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        // Symbol-prefix: $1,234.56  €99  ₪100  £50  ¥1000
        Regex::new(r"(?i)[\$€£¥₪₩₹]\s*\d[\d,]*(\.\d+)?").unwrap(),
        // Amount-suffix: 1234 USD / 99.99 EUR / 100 ILS / 100 שח / 100 ש״ח
        Regex::new(r"(?i)\b\d[\d,]*(\.\d+)?\s*(USD|EUR|GBP|ILS|NIS|JPY|CNY|INR|שח|ש״ח|ש''ח)\b").unwrap(),
        // Large comma-grouped numbers (4+ digits with comma) — conservative heuristic
        Regex::new(r"\b\d{1,3}(,\d{3}){1,}(\.\d+)?\b").unwrap(),
    ]
});

/// Result of sanitization — used by callers for logging/telemetry.
#[derive(Debug, Serialize, Deserialize)]
pub struct SanitizeReport {
    pub stripped_keys: Vec<String>,
    pub redacted_values: usize,
}

/// [Req #301] Remove monetary fields & redact currency literals from JSON.
/// Returns a new sanitized Value plus a report of what was touched.
pub fn sanitize_for_ai(input: &JsonValue) -> (JsonValue, SanitizeReport) {
    let mut report = SanitizeReport {
        stripped_keys: Vec::new(),
        redacted_values: 0,
    };
    let cleaned = sanitize_rec(input, &mut report);
    (cleaned, report)
}

fn sanitize_rec(v: &JsonValue, rep: &mut SanitizeReport) -> JsonValue {
    match v {
        JsonValue::Object(map) => {
            let mut out = serde_json::Map::with_capacity(map.len());
            for (k, val) in map {
                if is_blocked_key(k) {
                    rep.stripped_keys.push(k.clone());
                    continue;
                }
                out.insert(k.clone(), sanitize_rec(val, rep));
            }
            JsonValue::Object(out)
        }
        JsonValue::Array(arr) => JsonValue::Array(arr.iter().map(|x| sanitize_rec(x, rep)).collect()),
        JsonValue::String(s) => {
            let (redacted, hits) = redact_money_literals(s);
            rep.redacted_values += hits;
            JsonValue::String(redacted)
        }
        JsonValue::Number(n) => {
            // Bare numbers with no key context — leave numeric (key filter did its job).
            JsonValue::Number(n.clone())
        }
        other => other.clone(),
    }
}

fn is_blocked_key(k: &str) -> bool {
    let lk = k.to_lowercase();
    BLOCKED_KEYS.iter().any(|b| lk == b.to_lowercase())
}

fn redact_money_literals(input: &str) -> (String, usize) {
    let mut out = input.to_string();
    let mut total_hits = 0usize;
    for re in MONEY_REGEXES.iter() {
        let hits = re.find_iter(&out).count();
        if hits > 0 {
            out = re.replace_all(&out, "[REDACTED]").into_owned();
            total_hits += hits;
        }
    }
    (out, total_hits)
}

// ── Tests ──────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn strips_blocked_keys() {
        let input = json!({
            "client": "ACME",
            "price": 1500,
            "notes": "normal text"
        });
        let (out, rep) = sanitize_for_ai(&input);
        assert!(out.get("price").is_none());
        assert_eq!(rep.stripped_keys, vec!["price".to_string()]);
    }

    #[test]
    fn redacts_currency_symbols() {
        let input = json!({ "notes": "client said $1,234.56 is too high" });
        let (out, rep) = sanitize_for_ai(&input);
        assert!(out["notes"].as_str().unwrap().contains("[REDACTED]"));
        assert_eq!(rep.redacted_values, 1);
    }

    #[test]
    fn redacts_suffix_currency() {
        let input = json!({ "notes": "total was 9999 USD plus 50 ILS fee" });
        let (out, rep) = sanitize_for_ai(&input);
        let s = out["notes"].as_str().unwrap();
        assert!(!s.contains("USD"));
        assert!(!s.contains("ILS"));
        assert_eq!(rep.redacted_values, 2);
    }

    #[test]
    fn redacts_hebrew_shekel() {
        let input = json!({ "notes": "שילם 500 שח על הזמנה" });
        let (out, rep) = sanitize_for_ai(&input);
        assert!(!out["notes"].as_str().unwrap().contains("500"));
        assert_eq!(rep.redacted_values, 1);
    }

    #[test]
    fn strips_hebrew_blocked_keys() {
        let input = json!({ "client": "X", "מחיר": 500, "סכום": 1000 });
        let (out, rep) = sanitize_for_ai(&input);
        assert!(out.get("מחיר").is_none());
        assert!(out.get("סכום").is_none());
        assert_eq!(rep.stripped_keys.len(), 2);
    }

    #[test]
    fn preserves_non_financial_numbers() {
        // Phone-like / ID-like numbers without comma grouping must pass through
        let input = json!({ "notes": "Call back at 972-54-1234567 about quote 840" });
        let (out, _rep) = sanitize_for_ai(&input);
        assert!(out["notes"].as_str().unwrap().contains("840"));
    }

    #[test]
    fn recurses_into_nested_objects() {
        let input = json!({
            "quote": { "number": "Q-1", "total": 9999 },
            "items": [{ "name": "A", "cost": 50 }]
        });
        let (out, rep) = sanitize_for_ai(&input);
        assert!(out["quote"].get("total").is_none());
        assert!(out["items"][0].get("cost").is_none());
        assert_eq!(rep.stripped_keys.len(), 2);
    }
}
