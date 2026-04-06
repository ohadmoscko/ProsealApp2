import type { QuoteStatus, InteractionType } from './database.types';

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
  new: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  open: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  waiting: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  follow_up: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
  won: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300',
  lost: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  dormant: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800/40 dark:text-zinc-400',
};

export const INTERACTION_LABELS: Record<InteractionType, string> = {
  call: 'טלפון',
  whatsapp: 'וואטסאפ',
  email: 'מייל',
  note: 'הערה',
  system: 'מערכת',
};
