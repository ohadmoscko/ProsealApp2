/**
 * Supabase Edge Function: generate-weekly-report
 *
 * [Req #163] Modernized 7 fixed categories
 * [Req #166] Focus on anomalies and successes
 * [Req #169] Filter logistical noise (routine shipments)
 * [Req #177] AI surfaces cool-downs/abandoned offers
 * [Req #179] Reduce redundant numbers — action-oriented
 * [Req #168] Bold operational representation (CNC/repairs)
 * [Req #173] Operational "failures" category
 * [Req #178] Push/pull direction analysis
 *
 * Input: { week_start?: string } — ISO date, defaults to current week (Sun-Sat)
 * Output: JSON report with 7 cube categories the UI renders as drill-down tiles
 *
 * Env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// [Req #163] 7 fixed cube categories for CEO report
const SYSTEM_PROMPT = `אתה עוזר AI שמכין דוח שבועי למנכ"ל חברת אטמים תעשייתית (Proseal).
התפקיד שלך: לקבל נתוני שבוע ולהחזיר דוח מובנה ב-7 קטגוריות קבועות.

[Req #163] הדוח מאורגן ב-7 קוביות קבועות:
1. sales — מכירות והצעות מחיר (הצעות חדשות, סגירות, מחזור)
2. production — ייצור ו-CNC (פרויקטים בייצור, עומסים, עיכובים)
3. logistics — לוגיסטיקה ומשלוחים (שנשלח, מה בהמתנה, תקלות)
4. clients — לקוחות ומעקב (VIP, חדשים, נטושים, קירור)
5. operations — תפעול ותקלות (בעיות, תיקונים, מחסור מלאי)
6. ceo_messages — הודעות למנכ"ל (הודעות ישירות מהעובד)
7. achievements — הישגים והצלחות (עסקאות, שיפורים, אבני דרך)

החזר JSON בלבד (בלי markdown, בלי backticks):
{
  "executive_summary": "2-3 משפטים ממוקדים: מה הכי דחוף, מה הצליח, מה דורש החלטה",
  "mood": "positive | neutral | warning | critical",
  "categories": [
    {
      "key": "sales",
      "title": "מכירות",
      "icon": "📊",
      "summary": "שורה אחת: סיכום המצב",
      "severity": "ok | warn | critical",
      "items": [
        { "text": "פריט 1 — תמציתי", "type": "highlight | risk | action | info", "is_recurring": false }
      ]
    }
  ],
  "cool_downs": [
    { "quote_number": "...", "client_code": "...", "days_silent": 0, "original_temp": 0, "current_temp": 0, "recommendation": "..." }
  ]
}

כללים קריטיים:
[Req #166] התמקד בחריגים, אנומליות, והצלחות — לא ברוטינה. אם הכל שגרתי, אמור "שבוע שגרתי" ואל תנפח.
[Req #169] סנן רעשי לוגיסטיקה — אל תציין משלוחים שגרתיים. רק עיכובים, תקלות, או נפחים חריגים.
[Req #179] אל תחזור על מספרים שכבר בסטטיסטיקות. התמקד בתובנות ופעולות.
[Req #168] תן ייצוג בולט לפרויקטי ייצור מורכבים (CNC, תיקונים, פרויקטים מרובי-עובדים).
[Req #173] ציין בעיות תפעוליות בגלוי (תקלות, חומרי גלם חסרים, איחורים).
[Req #177] זהה הצעות שהתקררו (טמפרטורה ירדה) ונטושות (ימים רבים ללא קשר) — הוסף אותן ל-cool_downs.
[Req #198] שמור על איזון אסטרטגי: ~50% בעיות/סיכונים ו-~50% הישגים/הצלחות. המנכ"ל צריך לראות את התמונה המלאה — גם מה שבור וגם מה שעובד. אם שבוע טוב — הדגש הצלחות. אם שבוע קשה — הדגש פעולות נדרשות.
[Req #202] סנן רעש תפעולי במפורש: התעלם ממשלוחים שגרתיים, שיחות מעקב סטנדרטיות, ועדכוני סטטוס צפויים. דווח רק על חריגות, שיאים, כשלים, או אירועים בלתי צפויים.
[Req #281] הפרד רגשות מעובדות — דווח עובדתי ללא הטיה רגשית.
[Req #288] הסר ז'רגון טכני — כתוב בשפה שהמנכ"ל מבין ללא צורך בהסבר.

שפה: עברית תמציתית ומקצועית.
כל category חייבת להופיע גם אם ריקה (items=[]).
severity: "ok" = הכל תקין, "warn" = דורש תשומת לב, "critical" = דורש פעולה מיידית.
is_recurring: true אם הפריט חוזר מדוחות קודמים (חסימה חוזרת).`;

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
      max_tokens: 2500,
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
      .select('*, client:clients(code, is_vip, customer_style, is_new_customer)')
      .order('temperature', { ascending: false });

    // 2. Fetch this week's interactions (with direction for push/pull analysis)
    const { data: interactions } = await supabase
      .from('interactions')
      .select('*, quote:quotes(quote_number, status, client:clients(code, is_vip))')
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

    // 4. Compute derived data
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
    // [Req #157, #240] Production / shipped quotes
    const inProduction = (quotes ?? []).filter(
      (q: Record<string, unknown>) => (q.status as string) === 'in_production',
    );
    const shipped = (quotes ?? []).filter(
      (q: Record<string, unknown>) => (q.status as string) === 'shipped',
    );

    // [Req #177] Cool-down detection: quotes where temp decayed significantly
    const coolDowns = activeQuotes
      .filter((q: Record<string, unknown>) => {
        const dsc = (q.days_since_contact as number) ?? 0;
        const temp = q.temperature as number;
        return (temp >= 3 && dsc >= 7) || (temp >= 4 && dsc >= 5);
      })
      .slice(0, 10)
      .map((q: Record<string, unknown>) => {
        const client = q.client as Record<string, unknown> | null;
        const dsc = (q.days_since_contact as number) ?? 0;
        const temp = q.temperature as number;
        // Simple decay calculation
        let penalty = 0;
        if (dsc >= 14) penalty = 3;
        else if (dsc >= 7) penalty = 2;
        else if (dsc >= 4) penalty = 1;
        return {
          quote_number: q.quote_number,
          client_code: client?.code ?? '?',
          days_silent: dsc,
          original_temp: temp,
          current_temp: Math.max(1, temp - penalty),
        };
      });

    // [Req #202] Pre-filter operational noise before sending to Claude
    // Routine interactions: standard follow-ups with no special outcome or content
    const NOISE_TYPES = new Set(['system']);
    const allInteractions = interactions ?? [];
    const signalInteractions = allInteractions.filter((ix: Record<string, unknown>) => {
      // Filter out system-generated noise
      if (NOISE_TYPES.has(ix.type as string)) return false;
      // Filter out empty content interactions (no useful signal)
      const content = (ix.content as string) ?? '';
      if (!content.trim() && !(ix.is_milestone as boolean)) return false;
      return true;
    });
    const filteredCount = allInteractions.length - signalInteractions.length;

    // [Req #178] Push/pull analysis
    const pushCount = signalInteractions.filter((ix: Record<string, unknown>) => (ix.direction as string) === 'push').length;
    const pullCount = signalInteractions.filter((ix: Record<string, unknown>) => (ix.direction as string) === 'pull').length;

    // [Req #174] CEO messages
    const ceoCaptures = (captures ?? []).filter(
      (c: Record<string, unknown>) => {
        const raw = c.raw_text as string;
        const parsed = c.ai_parsed as Record<string, unknown> | null;
        return raw.startsWith('/מאור') ||
               raw.startsWith('/מ ') ||
               parsed?.category === 'הודעה_למנכל';
      },
    );

    // Format data for AI prompt
    // [Req #202] Use filtered signal interactions for AI prompt
    const ixSummary = signalInteractions.slice(0, 60).map((ix: Record<string, unknown>) => {
      const quote = ix.quote as Record<string, unknown> | null;
      const qNum = quote?.quote_number ?? '?';
      const client = quote?.client as Record<string, unknown> | null;
      const cCode = client?.code ?? '';
      const dir = (ix.direction as string) === 'pull' ? '[לקוח]' : '';
      const milestone = (ix.is_milestone as boolean) ? '[אבן דרך]' : '';
      return `${(ix.created_at as string).slice(0, 10)} | ${ix.type} | ${qNum} (${cCode}) ${dir}${milestone} | ${ix.content ?? ''}`;
    }).join('\n');

    const capSummary = (captures ?? []).slice(0, 30).map((c: Record<string, unknown>) => {
      const parsed = c.ai_parsed as Record<string, unknown> | null;
      return `${(c.created_at as string).slice(0, 10)} | ${parsed?.category ?? 'כללי'} | ${parsed?.summary ?? c.raw_text}`;
    }).join('\n');

    const ceoSummary = ceoCaptures.map((c: Record<string, unknown>) => {
      const parsed = c.ai_parsed as Record<string, unknown> | null;
      return parsed?.summary ?? c.raw_text;
    }).join('\n');

    // Hot / VIP / New customer quotes
    const hotQuotes = activeQuotes
      .filter((q: Record<string, unknown>) => (q.temperature as number) >= 4)
      .slice(0, 5)
      .map((q: Record<string, unknown>) => {
        const client = q.client as Record<string, unknown> | null;
        const isVip = (client?.is_vip as boolean) ? ' [VIP]' : '';
        const isNew = (client?.is_new_customer as boolean) ? ' [חדש]' : '';
        return `${q.quote_number} (${client?.code ?? '?'})${isVip}${isNew} — טמפ' ${q.temperature}/5, סטטוס: ${q.status}, ימים ללא קשר: ${q.days_since_contact ?? 'N/A'}`;
      }).join('\n');

    // Cool-down formatted
    const coolDownSummary = coolDowns.length > 0
      ? coolDowns.map((cd) =>
          `${cd.quote_number} (${cd.client_code}) — טמפ' ירדה מ-${cd.original_temp} ל-${cd.current_temp}, שקט ${cd.days_silent} ימים`
        ).join('\n')
      : '(אין)';

    // Build the comprehensive prompt
    const prompt = [
      `=== דוח שבועי: ${start} עד ${end} ===`,
      '',
      `סטטיסטיקות מהירות:`,
      `- הצעות פעילות: ${activeQuotes.length}`,
      `- חדשות השבוע: ${newThisWeek.length}`,
      `- נסגרו (זכייה): ${wonThisWeek.length}`,
      `- נסגרו (הפסד): ${lostThisWeek.length}`,
      `- בייצור: ${inProduction.length}`,
      `- נשלחו: ${shipped.length}`,
      `- אינטראקציות: ${signalInteractions.length} (${pushCount} יוזמה שלנו, ${pullCount} יוזמת לקוח) [סוננו ${filteredCount} רשומות שגרתיות]`,
      `- הקלדות: ${(captures ?? []).length}`,
      '',
      `הצעות חמות:`,
      hotQuotes || '(אין)',
      '',
      `התקררויות (הצעות שהתקררו):`,
      coolDownSummary,
      '',
      `ציר זמן אינטראקציות (עד 60 אחרונות):`,
      ixSummary || '(ריק)',
      '',
      `הקלדות ואירועים:`,
      capSummary || '(ריק)',
      '',
      ceoCaptures.length > 0 ? `הודעות למנכ"ל:\n${ceoSummary}` : 'אין הודעות ישירות למנכ"ל',
    ].join('\n');

    const report = await callClaude(prompt);

    // Add raw stats + cool_downs to the report
    const result = {
      ...report,
      cool_downs: coolDowns,
      week_start: start,
      week_end: end,
      generated_at: new Date().toISOString(),
      raw_stats: {
        total_active: activeQuotes.length,
        new_this_week: newThisWeek.length,
        closed_won: wonThisWeek.length,
        closed_lost: lostThisWeek.length,
        in_production: inProduction.length,
        shipped: shipped.length,
        interactions_count: signalInteractions.length,
        interactions_filtered: filteredCount,  // [Req #202] noise filtered out
        push_count: pushCount,
        pull_count: pullCount,
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
