/**
 * Supabase Edge Function: generate-weekly-report
 *
 * Aggregates the current week's data (quotes, interactions, captures)
 * and generates a structured CEO Weekly Report using Claude AI.
 *
 * Input: { week_start?: string } — ISO date, defaults to current week (Sun-Sat)
 * Output: JSON report with sections the UI renders directly
 *
 * Env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const SYSTEM_PROMPT = `אתה עוזר AI שמכין דוח שבועי למנכ"ל חברת אטמים תעשייתית (Proseal).
התפקיד שלך: לקבל נתוני שבוע (הצעות מחיר, אינטראקציות, הקלדות עובדים) ולהחזיר דוח מובנה ב-JSON.

החזר JSON בלבד (בלי markdown, בלי backticks):
{
  "executive_summary": "3-4 משפטים: מה קרה השבוע, מה דורש תשומת לב מיידית, מה ההמלצה",
  "highlights": ["נקודה חשובה 1", "נקודה חשובה 2", "..."],
  "risks": ["סיכון 1", "סיכון 2"],
  "action_items": ["פעולה נדרשת 1", "פעולה נדרשת 2"],
  "ceo_messages": ["הודעה ישירה 1", "..."],
  "quote_summary": {
    "total_active": 0,
    "new_this_week": 0,
    "closed_won": 0,
    "closed_lost": 0,
    "overdue_followups": 0,
    "hottest": "מספר הצעה + תקציר קצר"
  },
  "mood": "positive | neutral | warning | critical"
}

כללים:
- כתוב עברית תמציתית ומקצועית
- executive_summary: מקסימום 4 משפטים, מנקודת המבט של המנכ"ל
- highlights: מקסימום 5 נקודות
- risks: רק סיכונים אמיתיים, לא יותר מ-3
- action_items: פעולות קונקרטיות שהמנכ"ל צריך לבצע
- ceo_messages: רק אם יש הודעות שסומנו עם /מ או /מאור
- mood: "positive" אם הכל בסדר, "critical" אם יש בעיות דחופות`;

async function callClaude(prompt: string): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text?.trim() ?? '{}';
  return JSON.parse(text);
}

/** Get ISO date string for the start of the current week (Sunday) */
function currentWeekStart(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const start = new Date(now);
  start.setDate(start.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return start.toISOString().slice(0, 10);
}

function weekEnd(weekStart: string): string {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const start = (body as Record<string, unknown>).week_start as string ?? currentWeekStart();
    const end = weekEnd(start);

    // 1. Fetch all active quotes with client info
    const { data: quotes } = await supabase
      .from('quotes')
      .select('*, client:clients(code)')
      .order('temperature', { ascending: false });

    // 2. Fetch this week's interactions
    const { data: interactions } = await supabase
      .from('interactions')
      .select('*, quote:quotes(quote_number, client:clients(code))')
      .gte('created_at', `${start}T00:00:00`)
      .lte('created_at', `${end}T23:59:59`)
      .order('created_at', { ascending: true });

    // 3. Fetch this week's captures
    const { data: captures } = await supabase
      .from('captures')
      .select('*')
      .gte('created_at', `${start}T00:00:00`)
      .lte('created_at', `${end}T23:59:59`)
      .order('created_at', { ascending: true });

    // 4. Build prompt with real data
    const activeQuotes = (quotes ?? []).filter(
      (q: Record<string, unknown>) => !['won', 'lost', 'dormant'].includes(q.status as string),
    );
    const newThisWeek = (quotes ?? []).filter(
      (q: Record<string, unknown>) =>
        (q.created_at as string) >= `${start}T00:00:00` &&
        (q.status as string) !== 'dormant',
    );
    const wonThisWeek = (quotes ?? []).filter(
      (q: Record<string, unknown>) =>
        (q.status as string) === 'won' &&
        (q.updated_at as string) >= `${start}T00:00:00`,
    );
    const lostThisWeek = (quotes ?? []).filter(
      (q: Record<string, unknown>) =>
        (q.status as string) === 'lost' &&
        (q.updated_at as string) >= `${start}T00:00:00`,
    );

    // CEO messages (from captures marked with /מ or /מאור)
    const ceoCaptures = (captures ?? []).filter(
      (c: Record<string, unknown>) => {
        const raw = c.raw_text as string;
        const parsed = c.ai_parsed as Record<string, unknown> | null;
        return raw.startsWith('/מאור') ||
               raw.startsWith('/מ ') ||
               parsed?.category === 'הודעה_למנכל';
      },
    );

    // Format interactions timeline
    const ixSummary = (interactions ?? []).slice(0, 50).map((ix: Record<string, unknown>) => {
      const quote = ix.quote as Record<string, unknown> | null;
      const qNum = quote?.quote_number ?? '?';
      const client = quote?.client as Record<string, unknown> | null;
      const cCode = client?.code ?? '';
      return `${(ix.created_at as string).slice(0, 10)} | ${ix.type} | ${qNum} (${cCode}) | ${ix.content ?? ''}`;
    }).join('\n');

    // Format captures
    const capSummary = (captures ?? []).slice(0, 30).map((c: Record<string, unknown>) => {
      const parsed = c.ai_parsed as Record<string, unknown> | null;
      return `${(c.created_at as string).slice(0, 10)} | ${parsed?.category ?? 'כללי'} | ${parsed?.summary ?? c.raw_text}`;
    }).join('\n');

    // Format CEO messages
    const ceoSummary = ceoCaptures.map((c: Record<string, unknown>) => {
      const parsed = c.ai_parsed as Record<string, unknown> | null;
      return parsed?.summary ?? c.raw_text;
    }).join('\n');

    // Hot quotes
    const hotQuotes = activeQuotes
      .filter((q: Record<string, unknown>) => (q.temperature as number) >= 4)
      .slice(0, 5)
      .map((q: Record<string, unknown>) => {
        const client = q.client as Record<string, unknown> | null;
        return `${q.quote_number} (${client?.code ?? '?'}) — טמפ' ${q.temperature}/5, סטטוס: ${q.status}, ימים ללא קשר: ${q.days_since_contact ?? 'N/A'}`;
      }).join('\n');

    const prompt = [
      `=== דוח שבועי: ${start} עד ${end} ===`,
      '',
      `סטטיסטיקות:`,
      `- הצעות פעילות: ${activeQuotes.length}`,
      `- חדשות השבוע: ${newThisWeek.length}`,
      `- נסגרו (זכייה): ${wonThisWeek.length}`,
      `- נסגרו (הפסד): ${lostThisWeek.length}`,
      `- אינטראקציות השבוע: ${(interactions ?? []).length}`,
      `- הקלדות השבוע: ${(captures ?? []).length}`,
      '',
      `הצעות חמות:`,
      hotQuotes || '(אין)',
      '',
      `ציר זמן אינטראקציות:`,
      ixSummary || '(ריק)',
      '',
      `הקלדות ואירועים:`,
      capSummary || '(ריק)',
      '',
      ceoCaptures.length > 0 ? `הודעות למנכ"ל:\n${ceoSummary}` : 'אין הודעות ישירות למנכ"ל',
    ].join('\n');

    const report = await callClaude(prompt);

    // Add raw stats to the report
    const result = {
      ...report,
      week_start: start,
      week_end: end,
      generated_at: new Date().toISOString(),
      raw_stats: {
        total_active: activeQuotes.length,
        new_this_week: newThisWeek.length,
        closed_won: wonThisWeek.length,
        closed_lost: lostThisWeek.length,
        interactions_count: (interactions ?? []).length,
        captures_count: (captures ?? []).length,
        ceo_messages_count: ceoCaptures.length,
      },
    };

    return new Response(JSON.stringify({ ok: true, report: result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
