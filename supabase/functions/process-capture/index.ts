/**
 * Supabase Edge Function: process-capture
 *
 * Called after a capture is inserted. Uses Claude API to:
 * 1. Parse the raw Hebrew text into structured data
 * 2. Link to a quote if a quote number is mentioned
 * 3. Generate a short AI response/acknowledgment
 *
 * Trigger: can be called via database webhook or client-side after insert.
 * Env vars required: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface CapturePayload {
  capture_id: string;
}

const SYSTEM_PROMPT = `אתה עוזר AI למנהל תפעול בחברת אטמים תעשייתית (Proseal).
התפקיד שלך: לקבל הודעה חופשית בעברית שהמשתמש הקליד, ולהחזיר JSON מובנה.

החזר JSON בלבד (בלי markdown, בלי backticks):
{
  "summary": "תקציר קצר של מה שקרה (עברית, משפט אחד)",
  "category": "אחת מ: הצעה | משלוח | תקלה | לקוח | כללי | הודעה_למנכל",
  "quote_number": "מספר הצעה אם מוזכר (null אם לא)",
  "client_code": "קוד לקוח אם מוזכר (null אם לא)",
  "importance": "normal | medium | high",
  "ai_response": "תגובה קצרה ועניינית למשתמש (עברית, 1-2 משפטים). אם זה אירוע חשוב, ציין למה. אם מוזכר מספר הצעה, אשר שזוהה."
}

דוגמאות:
קלט: "שלחנו הצעה 5092 ליעקב, ביקש הנחה של 10%"
פלט: {"summary":"נשלחה הצעה 5092 ליעקב עם בקשת הנחה 10%","category":"הצעה","quote_number":"5092","client_code":null,"importance":"medium","ai_response":"הצעה 5092 נרשמה. שים לב — בקשת הנחה 10% דורשת מעקב."}

קלט: "/מאור יש בעיה עם מכונת ה-CNC, צריך להחליט על תקציב תיקון"
פלט: {"summary":"תקלה במכונת CNC, דרוש אישור תקציב","category":"הודעה_למנכל","quote_number":null,"client_code":null,"importance":"high","ai_response":"נרשם כהודעה למנכ\\"ל. תקלת CNC + תקציב — יופיע בדוח."}

קלט: "/מ ממתין לאישור מאור על הצעה 3301"
פלט: {"summary":"ממתין לאישור מנכל על הצעה 3301","category":"הצעה","quote_number":"3301","client_code":null,"importance":"medium","ai_response":"סומן כממתין למנכ\\"ל. הצעה 3301 תופיע בסעיף 'ממתין לאישור'."}`;

async function callClaude(rawText: string): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: rawText }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text ?? '{}';
  return JSON.parse(text);
}

Deno.serve(async (req) => {
  // CORS headers
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const { capture_id } = (await req.json()) as CapturePayload;
    if (!capture_id) {
      return new Response(JSON.stringify({ error: 'capture_id required' }), { status: 400 });
    }

    // Fetch the capture
    const { data: capture, error: fetchErr } = await supabase
      .from('captures')
      .select('*')
      .eq('id', capture_id)
      .single();

    if (fetchErr || !capture) {
      return new Response(JSON.stringify({ error: 'Capture not found' }), { status: 404 });
    }

    // Skip if already processed
    if (capture.status !== 'pending') {
      return new Response(JSON.stringify({ ok: true, skipped: true }));
    }

    // Call Claude
    const parsed = await callClaude(capture.raw_text);

    // Try to link to a quote by number
    let linkedQuoteId: string | null = null;
    if (parsed.quote_number) {
      const { data: matchedQuote } = await supabase
        .from('quotes')
        .select('id')
        .ilike('quote_number', `%${parsed.quote_number}%`)
        .limit(1)
        .single();
      if (matchedQuote) linkedQuoteId = matchedQuote.id;
    }

    // Update the capture with AI results
    const { error: updateErr } = await supabase
      .from('captures')
      .update({
        ai_parsed: parsed,
        ai_response: (parsed.ai_response as string) ?? null,
        linked_quote_id: linkedQuoteId,
        status: 'processed',
      })
      .eq('id', capture_id);

    if (updateErr) throw updateErr;

    return new Response(JSON.stringify({ ok: true, parsed }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
