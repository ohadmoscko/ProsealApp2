/**
 * TanStack Query hooks for proseal-brain data layer.
 * All Supabase calls live here — components stay dumb.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from './auth';
import type { Quote, Client, Interaction, Capture, InteractionType, InteractionOutcome, DeferReasonCategory, ReleaseStatus, TelemetryAction } from './database.types';

// ============================================================
//  Queued Release: weekend notes → released Sunday 08:00
// ============================================================

/** Check if current time is during Israeli weekend (Friday 14:00 – Sunday 08:00) */
function isWeekendWindow(): boolean {
  const now = new Date();
  // Israel timezone offset — approximate with Intl
  const ilTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const day = ilTime.getDay(); // 0=Sun, 5=Fri, 6=Sat
  const hour = ilTime.getHours();

  if (day === 6) return true;                      // Saturday — always weekend
  if (day === 5 && hour >= 14) return true;         // Friday after 14:00
  if (day === 0 && hour < 8) return true;           // Sunday before 08:00
  return false;
}

/** Compute next Sunday 08:00 Israel time as ISO string */
function nextSundayRelease(): string {
  const now = new Date();
  const ilNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const day = ilNow.getDay();
  let daysUntilSunday = (7 - day) % 7;
  if (day === 0 && ilNow.getHours() < 8) daysUntilSunday = 0;
  if (daysUntilSunday === 0 && ilNow.getHours() >= 8) daysUntilSunday = 7;
  const target = new Date(ilNow);
  target.setDate(target.getDate() + daysUntilSunday);
  target.setHours(8, 0, 0, 0);
  return target.toISOString();
}

// ============================================================
//  Quotes
// ============================================================

export function useQuotes() {
  return useQuery({
    queryKey: ['quotes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quotes')
        .select('*, client:clients(*)')
        .not('status', 'in', '("won","lost","dormant")')
        .order('temperature', { ascending: false })
        .order('follow_up_date', { ascending: true, nullsFirst: false });

      if (error) throw new Error(error.message);
      return data as (Quote & { client?: Client })[];
    },
  });
}

// ============================================================
//  Interactions
// ============================================================

export function useInteractions(quoteId: string | null) {
  return useQuery({
    queryKey: ['interactions', quoteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('interactions')
        .select('*')
        .eq('quote_id', quoteId!)
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message);
      return data as Interaction[];
    },
    enabled: !!quoteId,
  });
}

export function useAddInteraction() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      quoteId,
      type,
      content,
      outcome,
      followUpDate,
      deferCategory,
    }: {
      quoteId: string;
      type: InteractionType;
      content: string;
      outcome?: InteractionOutcome;
      followUpDate?: string | null; // ISO date YYYY-MM-DD, updates quote.follow_up_date
      deferCategory?: DeferReasonCategory;
    }) => {
      // 1. Queued release: notes written during weekend are held until Sunday 08:00
      const weekend = isWeekendWindow();
      const releaseStatus: ReleaseStatus = (weekend && type === 'note') ? 'pending' : 'immediate';
      const releaseAt = releaseStatus === 'pending' ? nextSundayRelease() : null;

      // 2. Insert interaction
      const { data, error } = await supabase
        .from('interactions')
        .insert({
          quote_id: quoteId,
          type,
          content,
          outcome: outcome ?? null,
          defer_category: deferCategory ?? null,
          release_status: releaseStatus,
          release_at: releaseAt,
          created_by: user?.id ?? null,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);

      // 3. Optionally update follow-up date on the quote
      if (followUpDate !== undefined) {
        const { error: qErr } = await supabase
          .from('quotes')
          .update({ follow_up_date: followUpDate, status: followUpDate ? 'follow_up' : 'open' })
          .eq('id', quoteId);
        if (qErr) throw new Error(qErr.message);
      }

      return data as Interaction;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['interactions', vars.quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
    },
  });
}

/**
 * Release pending weekend notes that are past their release_at time.
 * Called once on app load (Sunday morning check).
 */
export function useReleasePendingNotes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('interactions')
        .update({ release_status: 'released' })
        .eq('release_status', 'pending')
        .lte('release_at', now)
        .select('id');

      if (error) throw new Error(error.message);
      return data?.length ?? 0;
    },
    onSuccess: (count) => {
      if (count > 0) {
        queryClient.invalidateQueries({ queryKey: ['interactions'] });
        queryClient.invalidateQueries({ queryKey: ['quotes'] });
      }
    },
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ id, fields }: { id: string; fields: Partial<Client> }) => {
      const patch: Record<string, unknown> = { ...fields };
      // Track VIP audit fields automatically
      if ('is_vip' in fields) {
        patch.vip_set_at = fields.is_vip ? new Date().toISOString() : null;
        patch.vip_set_by = fields.is_vip ? (user?.id ?? null) : null;
      }
      const { data, error } = await supabase
        .from('clients')
        .update(patch)
        .eq('id', id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data as Client;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotes'] }); // quotes join clients
    },
  });
}

// ============================================================
//  Captures
// ============================================================

/** Fetch captures created in the last 7 days, newest first for feed display. */
export function useCaptures() {
  return useQuery({
    queryKey: ['captures'],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 7);

      const { data, error } = await supabase
        .from('captures')
        .select('*')
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw new Error(error.message);
      return data as Capture[];
    },
  });
}

export function useAddCapture() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (rawText: string) => {
      const { data, error } = await supabase
        .from('captures')
        .insert({ raw_text: rawText, created_by: user?.id ?? null })
        .select()
        .single();

      if (error) throw new Error(error.message);
      const capture = data as Capture;

      // Fire-and-forget: trigger AI processing via Edge Function
      supabase.functions
        .invoke('process-capture', { body: { capture_id: capture.id } })
        .then(({ error: fnErr }) => {
          if (fnErr) console.warn('[process-capture] Edge Function error:', fnErr);
          // Re-fetch captures to pick up ai_response
          queryClient.invalidateQueries({ queryKey: ['captures'] });
        });

      return capture;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captures'] });
    },
  });
}

// ============================================================
//  Quote creation with Unified ID de-duplication
// ============================================================

/** Build the unified ID locally for display / pre-check */
export function buildUnifiedId(erpNumber: string | null, initials: string | null, quoteNumber: string): string {
  return `${erpNumber ?? 'NO-ERP'}-${initials ?? 'XX'}-${quoteNumber}`;
}

/**
 * Create a quote with anti-duplication.
 * If [ERP]-[Initials]-[QuoteNumber] already exists, silently returns the
 * existing quote ID so the caller can link the interaction there instead.
 */
export function useCreateQuote() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      quoteNumber,
      clientId,
      erpNumber,
      initials,
      localFilePath,
    }: {
      quoteNumber: string;
      clientId: string;
      erpNumber: string | null;
      initials: string | null;
      localFilePath?: string;
    }): Promise<{ id: string; merged: boolean }> => {
      // 1. Check for existing quote via Supabase RPC
      const { data: existingId, error: rpcErr } = await supabase.rpc(
        'find_quote_by_unified_id',
        {
          p_erp_number: erpNumber ?? 'NO-ERP',
          p_initials: initials ?? 'XX',
          p_quote_number: quoteNumber,
        },
      );

      if (rpcErr) throw new Error(rpcErr.message);

      // 2. If exists — silently return existing ID (merge/link)
      if (existingId) {
        return { id: existingId as string, merged: true };
      }

      // 3. Create new quote
      const { data, error } = await supabase
        .from('quotes')
        .insert({
          quote_number: quoteNumber,
          client_id: clientId,
          local_file_path: localFilePath ?? null,
          status: 'new',
          opened_at: new Date().toISOString().slice(0, 10),
          created_by: user?.id ?? null,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      return { id: (data as Quote).id, merged: false };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
    },
  });
}

// ============================================================
//  AI Intern: Refresh quote summary via Edge Function
// ============================================================

export function useRefreshSummary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ quoteId, batch }: { quoteId?: string; batch?: boolean }) => {
      const body = batch ? { batch: true } : { quote_id: quoteId };
      const { error } = await supabase.functions.invoke('generate-summary', { body });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
    },
  });
}

// ============================================================
//  AI Training Telemetry: track CEO behavior for AI learning
// ============================================================

/**
 * Fire-and-forget telemetry event.
 * Logs CEO interactions with the AI accordion (expand, pin, refresh, drill-down)
 * to the ai_training_telemetry table for future model tuning.
 */
export function useLogTelemetry() {
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      quoteId,
      action,
      metadata,
    }: {
      quoteId: string;
      action: TelemetryAction;
      metadata?: Record<string, unknown>;
    }) => {
      const { error } = await supabase
        .from('ai_training_telemetry')
        .insert({
          quote_id: quoteId,
          user_id: user?.id ?? null,
          action_type: action,
          metadata: metadata ?? {},
        });

      if (error) throw new Error(error.message);
    },
    // Silent — no cache invalidation needed, pure background logging
  });
}

// ============================================================
//  Quote mutations
// ============================================================

export function useUpdateQuote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, fields }: { id: string; fields: Partial<Quote> }) => {
      const { data, error } = await supabase
        .from('quotes')
        .update(fields)
        .eq('id', id)
        .select('*, client:clients(*)')
        .single();

      if (error) throw new Error(error.message);
      return data as Quote & { client?: Client };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
    },
  });
}
