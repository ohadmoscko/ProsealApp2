import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useClients, useCreateQuote } from '@/lib/data';
import { useToast } from '@/lib/toast';

interface CreateQuoteFormProps {
  onCreated: (quoteId: string) => void;
  onCancel: () => void;
}

/**
 * Inline form for creating a new quote.
 * Renders inside the main panel — no modals, no page navigation.
 */
export default function CreateQuoteForm({ onCreated, onCancel }: CreateQuoteFormProps) {
  const { data: clients = [], isLoading: clientsLoading } = useClients();
  const createQuote = useCreateQuote();
  const { toast } = useToast();

  const [quoteNumber, setQuoteNumber] = useState('');
  const [clientId, setClientId] = useState('');
  const [localFilePath, setLocalFilePath] = useState('');

  const selectedClient = clients.find((c) => c.id === clientId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = quoteNumber.trim();
    if (!num || !clientId) return;

    try {
      const result = await createQuote.mutateAsync({
        quoteNumber: num,
        clientId,
        erpNumber: selectedClient?.erp_number ?? null,
        initials: selectedClient?.initials ?? null,
        localFilePath: localFilePath.trim() || undefined,
      });

      if (result.merged) {
        toast('הצעה קיימת נמצאה — מועבר אליה', 'info');
      } else {
        toast('הצעה חדשה נוצרה', 'success');
      }
      onCreated(result.id);
    } catch (error: any) {
      console.error('[CreateQuoteForm]', error);
      toast(`שגיאה ביצירת הצעה: ${error?.message || 'שגיאת מסד נתונים'}`, 'error');
    }
  }

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto py-10 px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-5 rounded-xl border border-(--color-border) bg-(--color-surface-dim) p-6"
      >
        <div>
          <h2 className="text-lg font-bold text-(--color-text)">הצעת מחיר חדשה</h2>
          <p className="text-xs text-(--color-text-secondary) mt-0.5">מלא את הפרטים הבסיסיים — שאר השדות ניתנים לעריכה אחר כך.</p>
        </div>

        {/* Quote number */}
        <div className="space-y-1.5">
          <label htmlFor="cqf-num" className="block text-xs font-semibold text-(--color-text-secondary)">
            מספר הצעה
          </label>
          <input
            id="cqf-num"
            type="text"
            value={quoteNumber}
            onChange={(e) => setQuoteNumber(e.target.value)}
            placeholder='לדוגמה: Q-920'
            autoFocus
            dir="ltr"
            className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none placeholder:text-(--color-text-secondary)/40 focus:border-(--color-accent)"
          />
        </div>

        {/* Client picker */}
        <div className="space-y-1.5">
          <label htmlFor="cqf-client" className="block text-xs font-semibold text-(--color-text-secondary)">
            לקוח
          </label>
          {clientsLoading ? (
            <div className="h-9 rounded-lg bg-(--color-border)/30 animate-pulse" />
          ) : clients.length === 0 ? (
            <p className="text-xs text-(--color-text-secondary)/50">
              אין לקוחות במערכת. צור לקוח ב-Supabase לפני יצירת הצעה.
            </p>
          ) : (
            <select
              id="cqf-client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none focus:border-(--color-accent)"
              dir="rtl"
            >
              <option value="">— בחר לקוח —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.code}</option>
              ))}
            </select>
          )}
        </div>

        {/* Local file path (optional) */}
        <div className="space-y-1.5">
          <label htmlFor="cqf-path" className="block text-xs font-semibold text-(--color-text-secondary)">
            נתיב קובץ מקומי
            <span className="mr-1 text-(--color-text-secondary)/40 font-normal">(לא חובה)</span>
          </label>
          <input
            id="cqf-path"
            type="text"
            value={localFilePath}
            onChange={(e) => setLocalFilePath(e.target.value)}
            placeholder='C:\Quotes\Q-920.pdf'
            dir="ltr"
            className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none placeholder:text-(--color-text-secondary)/40 focus:border-(--color-accent)"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={!quoteNumber.trim() || !clientId || createQuote.isPending}
            className="rounded-lg bg-(--color-accent) px-5 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-30 hover:opacity-90"
          >
            {createQuote.isPending ? 'יוצר...' : 'צור הצעה'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-(--color-text-secondary) hover:text-(--color-text) transition-colors"
          >
            ביטול
          </button>
        </div>
      </form>
    </div>
  );
}
