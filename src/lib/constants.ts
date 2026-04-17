import type { QuoteStatus, InteractionType, DeferReasonCategory, PreferredChannel, CustomerStyle, InteractionDirection } from './database.types';

// [Req #157, #222, #240] - Extended status labels including new states
export const STATUS_LABELS: Record<QuoteStatus, string> = {
  new: 'חדש',
  open: 'פתוח',
  waiting: 'ממתין',
  follow_up: 'מעקב',
  won: 'נסגר',
  lost: 'הפסד',
  dormant: 'רדום',
  verbal_approval: 'אישור בע״פ',   // [Req #222]
  in_production: 'בייצור',          // [Req #240]
  shipped: 'נשלח',                  // [Req #157]
};

// [Req #157, #222, #240] - Extended status colors
export const STATUS_COLORS: Record<QuoteStatus, string> = {
  new: 'bg-blue-950/40 text-blue-300 light:bg-blue-100 light:text-blue-700',
  open: 'bg-emerald-950/40 text-emerald-300 light:bg-emerald-100 light:text-emerald-700',
  waiting: 'bg-amber-950/40 text-amber-300 light:bg-amber-100 light:text-amber-700',
  follow_up: 'bg-orange-950/40 text-orange-300 light:bg-orange-100 light:text-orange-700',
  won: 'bg-green-950/40 text-green-300 light:bg-green-100 light:text-green-700',
  lost: 'bg-red-950/40 text-red-300 light:bg-red-100 light:text-red-700',
  dormant: 'bg-zinc-800/40 text-zinc-400 light:bg-zinc-100 light:text-zinc-500',
  verbal_approval: 'bg-teal-950/40 text-teal-300 light:bg-teal-100 light:text-teal-700',  // [Req #222]
  in_production: 'bg-violet-950/40 text-violet-300 light:bg-violet-100 light:text-violet-700', // [Req #240]
  shipped: 'bg-cyan-950/40 text-cyan-300 light:bg-cyan-100 light:text-cyan-700',            // [Req #157]
};

export const INTERACTION_LABELS: Record<InteractionType, string> = {
  call: 'טלפון',
  whatsapp: 'וואטסאפ',
  email: 'מייל',
  note: 'הערה',
  system: 'מערכת',
};

/** Strategic rank labels (1-3) — replaces financial amounts in CEO view */
export const STRATEGIC_RANK_LABELS: Record<number, string> = {
  1: 'קריטי',
  2: 'חשוב',
  3: 'שגרתי',
};

/** Defer reason categories — required before snoozing a quote */
export const DEFER_REASON_LABELS: Record<DeferReasonCategory, string> = {
  client_abroad: 'הלקוח בחו״ל',
  awaiting_technical: 'ממתין לאישור טכני',
  price_objection: 'יקר לו',
  busy_period: 'תקופה עמוסה',
  other: 'אחר',
};

// [Req #105] - Preferred communication channel labels
export const CHANNEL_LABELS: Record<PreferredChannel, string> = {
  whatsapp: 'וואטסאפ',
  email: 'מייל',
  phone: 'טלפון',
};

// [Req #101] - Customer style/tenure labels
export const CUSTOMER_STYLE_LABELS: Record<CustomerStyle, string> = {
  new: 'חדש',
  recurring: 'חוזר',
  veteran: 'ותיק',
  one_time: 'חד-פעמי',
};

// [Req #178] - Interaction direction labels
export const DIRECTION_LABELS: Record<InteractionDirection, string> = {
  push: 'יוזמה שלנו',
  pull: 'יוזמת לקוח',
};

// [Req #131] Structured interaction tags — legal-safe structured input
export const INTERACTION_TAGS = [
  { value: 'price_sent', label: 'נשלח מחיר' },
  { value: 'follow_up', label: 'מעקב שגרתי' },
  { value: 'negotiation', label: 'משא ומתן' },
  { value: 'technical_q', label: 'שאלה טכנית' },
  { value: 'sample_sent', label: 'נשלחה דוגמא' },
  { value: 'meeting_set', label: 'נקבעה פגישה' },
  { value: 'awaiting_approval', label: 'ממתין לאישור' },
  { value: 'complaint', label: 'תלונה' },
  { value: 'general', label: 'כללי' },
] as const;

export type InteractionTag = typeof INTERACTION_TAGS[number]['value'];
