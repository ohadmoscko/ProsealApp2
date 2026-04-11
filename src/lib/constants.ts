import type { QuoteStatus, InteractionType, DeferReasonCategory } from './database.types';

export const STATUS_LABELS: Record<QuoteStatus, string> = {
  new: 'חדש',
  open: 'פתוח',
  waiting: 'ממתין',
  follow_up: 'מעקב',
  won: 'נסגר',
  lost: 'הפסד',
  dormant: 'רדום',
};

export const STATUS_COLORS: Record<QuoteStatus, string> = {
  new: 'bg-blue-950/40 text-blue-300 light:bg-blue-100 light:text-blue-700',
  open: 'bg-emerald-950/40 text-emerald-300 light:bg-emerald-100 light:text-emerald-700',
  waiting: 'bg-amber-950/40 text-amber-300 light:bg-amber-100 light:text-amber-700',
  follow_up: 'bg-orange-950/40 text-orange-300 light:bg-orange-100 light:text-orange-700',
  won: 'bg-green-950/40 text-green-300 light:bg-green-100 light:text-green-700',
  lost: 'bg-red-950/40 text-red-300 light:bg-red-100 light:text-red-700',
  dormant: 'bg-zinc-800/40 text-zinc-400 light:bg-zinc-100 light:text-zinc-500',
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
