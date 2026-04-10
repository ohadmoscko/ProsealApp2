/**
 * Supabase Edge Function: generate-summary
 *
 * AI Intern: Generates one-liner summaries for quotes based on their
 * interaction timeline (Rolling Log). Used for CEO accordion view.
 *
 * Input: { quote_id: string } or { batch: true } for all active quotes
 * Output: Updates quotes.ai_summary and quotes.ai_summary_at
 *
 * Env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const SYSTEM_PROMPT = `אתה עוזר AI למנכ"ל חברת אטמים תעשייתית (Proseal).
התפקיד שלך: לקבל ציר זמן של אינטראקציות עבור הצעת מחיר, ולהחזיר שורה תחתונה — משפט אחד בעברית שמסכם את המצב הנוכחי.

כללים:
- משפט אחד בלבד, קצר וחד
- התמקד במה שהמנכ"ל צריך לדעת: האם צריך פעולה? מה הסיכון? מה ההזדמנות?
- אם אין אינטראקציות, כתוב "אין פעילות — נדרש מגע ראשון"
- אל תחזיר JSON, רק טקסט חופשי

דוגמאות:
קלט: הצעה 5092, לקוח ABC, טמפרטורה 4, 3 שיחות בשבוע האחרון, ביקש הנחה
פלט: עסקה חמה — ביקש הנחה, צריך אישור מנכ"ל לסגירה

קלט: הצעה 3301, לקוח XYZ, טמפרטורה 2, אינטראקציה אחרונה לפני 12 יום, סטטוס ממתין
פלט: נרדם — 12 יום ללא מגע, כדאי לבדוק אם עדיין רלוונטי`;

async function callClaude(prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text?.trim() ?? '';
}

async function summarizeQuote(quoteId: string): Promise<{ id: string; summary: string }> {
  // Fetch quote with client
  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .select('*, client:clients(code)')
    .eq('id', quoteId)
    .single();

  if (qErr || !quote) throw new Error(`Quote not found: ${quoteId}`);

  // Fetch recent interactions (last 20)
  const { data: interactions } = await supabase
    .from('interactions')
    .select('type, content, outcome, created_at')
    .eq('quote_id', quoteId)
    .order('created_at', { ascending: false })
    .limit(20);

  const timeline = (interactions ?? [])
    .map((ix) => `${ix.created_at?.slice(0, 10)} | ${ix.type} | ${ix.content ?? ''} | ${ix.outcome ?? ''}`)
    .join('\n');

  const prompt = [
    `הצעה ${quote.quote_number}`,
    `לקוח: ${quote.client?.code ?? 'לא ידוע'}`,
    `טמפרטורה: ${quote.temperature}/5`,
    `סטטוס: ${quote.status}`,
    quote.days_since_contact != null ? `ימים ללא קשר: ${quote.days_since_contact}` : '',
    quote.loss_reason ? `סיבת הפסד: ${quote.loss_reason}` : '',
    '',
    'ציר זמן:',
    timeline || '(ריק)',
  ].filter(Boolean).join('\n');

  const summary = await callClaude(prompt);

  // Save to quote
  await supabase
    .from('quotes')
    .update({ ai_summary: summary, ai_summary_at: new Date().toISOString() })
    .eq('id', quoteId);

  return { id: quoteId, summary };
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
    const body = await req.json();

    // Single quote
    if (body.quote_id) {
      const result = await summarizeQuote(body.quote_id);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Batch: all active quotes
    if (body.batch) {
      const { data: activeQuotes } = await supabase
        .from('quotes')
        .select('id')
        .not('status', 'in', '("won","lost","dormant")');

      const results = [];
      for (const q of activeQuotes ?? []) {
        try {
          const r = await summarizeQuote(q.id);
          results.push(r);
        } catch (err) {
          results.push({ id: q.id, error: String(err) });
        }
      }

      return new Response(JSON.stringify({ ok: true, count: results.length, results }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'quote_id or batch required' }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
