/** Merge class names (simple implementation, no clsx dependency) */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Format date to Hebrew-friendly display: "3 באפריל 2026" */
export function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso; // Return raw string if unparseable
  return d.toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Relative time in Hebrew: "לפני 3 ימים" */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return iso; // Return raw string if unparseable

  const diffMs = Date.now() - then;

  // Future date — show as absolute
  if (diffMs < 0) return fmtDate(iso.slice(0, 10));

  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return 'עכשיו';
  if (diffMins === 1) return 'לפני דקה';
  if (diffMins < 60) return `לפני ${diffMins} דק׳`;
  if (diffHours === 1) return 'לפני שעה';
  if (diffHours < 24) return `לפני ${diffHours} שעות`;
  if (diffDays === 1) return 'אתמול';
  if (diffDays < 7) return `לפני ${diffDays} ימים`;
  const weeks = Math.floor(diffDays / 7);
  if (diffDays < 30) return weeks === 1 ? 'לפני שבוע' : `לפני ${weeks} שבועות`;
  return fmtDate(iso.slice(0, 10));
}

/** Temperature (1-5) to Tailwind color class */
export function tempColor(temp: number): string {
  if (temp >= 4) return 'text-red-600';
  if (temp >= 3) return 'text-orange-500';
  if (temp >= 2) return 'text-yellow-500';
  return 'text-zinc-400';
}

/**
 * Dynamic temperature decay based on days since last contact.
 * Returns the effective temperature (may be lower than stored value)
 * when a quote has gone stale without follow-up.
 *
 * Default decay thresholds (days → temperature penalty):
 *   0-3 days:  no change
 *   4-6 days:  -1
 *   7-13 days: -2
 *   14+ days:  -3
 *
 * Minimum effective temperature is always 1.
 */
export function effectiveTemperature(storedTemp: number, daysSinceContact: number | null): number {
  if (daysSinceContact == null || daysSinceContact <= 3) return storedTemp;
  let penalty = 0;
  if (daysSinceContact >= 14) penalty = 3;
  else if (daysSinceContact >= 7) penalty = 2;
  else if (daysSinceContact >= 4) penalty = 1;
  return Math.max(1, storedTemp - penalty);
}

/** Temperature (1-5) to Hebrew label */
export function tempLabel(temp: number): string {
  const labels: Record<number, string> = {
    1: 'קר',
    2: 'פושר',
    3: 'חם',
    4: 'רותח',
    5: 'בוער',
  };
  return labels[temp] ?? '';
}

// ============================================================
// [Req #12, #81] Weighted prioritization composite score
// ============================================================

/**
 * Compute a composite priority score for a quote.
 * Higher score = more urgent / more important.
 *
 * Weights (tuned for Proseal business logic):
 *   - Effective temperature (1-5):    ×10  (max 50)
 *   - Strategic rank (1=critical=3pt, 2=important=2pt, 3=routine=1pt): ×8  (max 24)
 *   - VIP client:                      +15
 *   - Staleness (days_since_contact):   ×1.5 (capped at 21 = 31.5)
 *   - Overdue follow-up:               +20
 *   - Follow-up status:                +10
 *
 * Theoretical max ≈ 150. Higher = act first.
 */
export function computePriorityScore(
  temperature: number,
  daysSinceContact: number | null,
  strategicRank: number | null,
  isVip: boolean,
  followUpDate: string | null,
  status: string,
): number {
  const eff = effectiveTemperature(temperature, daysSinceContact);
  let score = eff * 10; // [Req #12] base: effective temp

  // [Req #81] Strategic rank bonus (inverted: rank 1=critical → highest bonus)
  if (strategicRank === 1) score += 24;
  else if (strategicRank === 2) score += 16;
  else if (strategicRank === 3) score += 8;

  // [Req #81] VIP bonus
  if (isVip) score += 15;

  // [Req #12] Staleness factor (capped at 21 days)
  const dsc = daysSinceContact ?? 0;
  score += Math.min(dsc, 21) * 1.5;

  // [Req #12] Overdue follow-up boost
  if (followUpDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (followUpDate < today) score += 20;
  }

  // [Req #12] Follow-up status boost
  if (status === 'follow_up') score += 10;

  return Math.round(score * 10) / 10;
}

// ============================================================
// [Req #15] Time-based ice-breaker opener generation
// ============================================================

/**
 * Generate a context-aware ice-breaker opener based on
 * days since last contact and time of day.
 *
 * Returns a Hebrew conversation starter for the operator.
 */
export function generateIceBreaker(
  daysSinceContact: number | null,
  clientCode: string,
  lastInteractionType?: string,
): string {
  const dsc = daysSinceContact ?? 0;
  const hour = new Date().getHours();

  // Time-of-day greeting prefix
  const greeting = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'צהריים טובים' : 'ערב טוב';

  // [Req #15] Context-specific openers based on staleness
  if (dsc <= 1) {
    return `${greeting} ${clientCode}, חוזר אלייך בהמשך לשיחה שלנו`;
  }
  if (dsc <= 3) {
    return `${greeting} ${clientCode}, רציתי לעדכן אותך`;
  }
  if (dsc <= 7) {
    const verb = lastInteractionType === 'whatsapp' ? 'ההודעה' : lastInteractionType === 'email' ? 'המייל' : 'השיחה';
    return `${greeting} ${clientCode}, בהמשך ל${verb} שלנו מלפני כמה ימים`;
  }
  if (dsc <= 14) {
    return `${greeting} ${clientCode}, לא דיברנו כבר שבוע - רציתי לבדוק מה המצב`;
  }
  if (dsc <= 30) {
    return `${greeting} ${clientCode}, עבר זמן מה מאז ששוחחנו - חשבתי עלייך`;
  }
  return `${greeting} ${clientCode}, שמח לחזור אלייך אחרי הפסקה`;
}

// ============================================================
// [Req #5] Next call topic derivation
// ============================================================

/**
 * Derive the next recommended call topic from quote context.
 * Returns a short Hebrew suggestion for what to discuss.
 */
export function deriveNextCallTopic(
  status: string,
  temperature: number,
  daysSinceContact: number | null,
  followUpDate: string | null,
  salesAmmo: string[],
  _lossReason: string | null,
  aiSummary: string | null,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = followUpDate && followUpDate < today;

  // Priority-ordered topics
  if (isOverdue) return 'מעקב דחוף — תאריך מעקב עבר';
  if (status === 'verbal_approval') return 'קבלת אישור רשמי בכתב';
  if (status === 'in_production') return 'עדכון על מצב הייצור';
  if (status === 'waiting') return 'בירור — האם קיבלו החלטה?';
  if (temperature >= 4 && salesAmmo.length > 0) return `חיזוק עמדה: ${salesAmmo[0]}`;
  if (temperature >= 4) return 'סגירת עסקה — הצעה חמה';
  if ((daysSinceContact ?? 0) >= 7) return 'שיחת ריענון — שמירת קשר';
  if (status === 'follow_up') return 'מעקב לפי תזכורת';
  if (status === 'new') return 'הצגת הצעת מחיר ראשונית';
  if (aiSummary) {
    // Extract first meaningful phrase from AI summary
    const snippet = aiSummary.slice(0, 40).trim();
    return snippet.length > 30 ? snippet.slice(0, 30) + '...' : snippet;
  }
  return 'בירור צרכים ועדכון';
}

// ============================================================
// [Req #106] Relationship Strength — composite metric (0-100)
// ============================================================

/**
 * Computes relationship strength based on:
 * - Interaction frequency (higher = stronger)
 * - Temperature (higher = stronger)
 * - Days since last contact (lower = stronger)
 * - Customer style (veteran > recurring > new)
 */
export function computeRelationshipStrength(
  temperature: number,
  daysSinceContact: number | null,
  interactionCount: number,
  customerStyle?: string | null,
): number {
  const dsc = daysSinceContact ?? 30;

  // Temperature factor: 0-25 points (temp 1-5 scaled)
  const tempFactor = Math.min(25, (temperature / 5) * 25);

  // Recency factor: 0-30 points (recent contact = high)
  const recencyFactor = dsc <= 1 ? 30 : dsc <= 3 ? 25 : dsc <= 7 ? 20 : dsc <= 14 ? 12 : dsc <= 30 ? 5 : 0;

  // Interaction volume factor: 0-25 points
  const volumeFactor = Math.min(25, interactionCount * 2.5);

  // Style factor: 0-20 points
  const styleFactor = customerStyle === 'veteran' ? 20
    : customerStyle === 'recurring' ? 14
    : customerStyle === 'new' ? 5
    : customerStyle === 'one_time' ? 2
    : 8; // unknown

  return Math.min(100, Math.round(tempFactor + recencyFactor + volumeFactor + styleFactor));
}
