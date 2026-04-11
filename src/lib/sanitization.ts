/**
 * Data Sanitization — defensive layer enforcing the "no PII / financial
 * data in cloud-synced text fields" security rule.
 *
 * Run BEFORE any interaction / capture content is written to Supabase.
 * The `phone` column on the clients table is exempt (it's a designated field).
 *
 * Two classes of blocked content:
 *  1. Monetary — currency symbols + numeric amounts (₪, $, €, £, ¥, Hebrew words)
 *  2. Phone numbers — Israeli mobile/landline/toll-free patterns
 */

// ── Patterns ─────────────────────────────────────────────────────────

/**
 * Monetary: ₪100, $50.00, 1,000€, ש"ח 500, 200 דולר, etc.
 * Deliberately broad — false positives are safer than false negatives.
 */
const MONETARY_PATTERN =
  /(?:[\u20AA$\u20AC\u00A3\u00A5]\s*[\d,.]{2,}|[\d,.]{2,}\s*[\u20AA$\u20AC\u00A3\u00A5]|(?:ש"ח|שקל|שקלים|דולר|אירו|יורו)\s*[\d,.]{2,}|[\d,.]{2,}\s*(?:ש"ח|שקל|שקלים|דולר|אירו|יורו))/i;

/**
 * Israeli phone numbers:
 *  - Mobile:    05X-XXX-XXXX (with optional +972 prefix)
 *  - Landline:  0X-XXX-XXXX
 *  - Toll-free: 1-800-XXX-XXXX, *XXXX
 *
 * Separators: space, dash, dot, or nothing.
 * We require at least 7 consecutive digit groups to reduce false positives
 * on short numbers like quote IDs ("Q-840").
 */
const PHONE_PATTERN =
  /(?:(?:\+?972|0)[\s.\-]?\d{1,2}[\s.\-]?\d{3}[\s.\-]?\d{4}|1[\s.\-]?800[\s.\-]?\d{3}[\s.\-]?\d{3,4}|\*\d{4,6})/;

// ── Public API ───────────────────────────────────────────────────────

export interface SanitizationResult {
  /** Whether the content was blocked */
  blocked: boolean;
  /** Hebrew-language reason shown to the user */
  reason: string | null;
  /** The specific substring that triggered the block (for logging, never shown to user) */
  match: string | null;
}

/**
 * Scan free-text for sensitive content that must not be stored in the cloud.
 *
 * @param text - The raw user input to check
 * @returns `{ blocked: false }` if clean, or `{ blocked: true, reason, match }` if not
 */
export function detectSensitiveContent(text: string): SanitizationResult {
  if (!text || text.length < 3) return CLEAN;

  const monetaryMatch = text.match(MONETARY_PATTERN);
  if (monetaryMatch) {
    return {
      blocked: true,
      reason: 'הטקסט מכיל נתון כספי. אין להזין סכומים במערכת הענן — השתמש ב-ERP.',
      match: monetaryMatch[0],
    };
  }

  const phoneMatch = text.match(PHONE_PATTERN);
  if (phoneMatch) {
    return {
      blocked: true,
      reason: 'הטקסט מכיל מספר טלפון. נתונים מזהים אסורים בשדות טקסט חופשי.',
      match: phoneMatch[0],
    };
  }

  return CLEAN;
}

/** Sentinel object — avoids allocating a new object on every clean check */
const CLEAN: SanitizationResult = Object.freeze({ blocked: false, reason: null, match: null });
