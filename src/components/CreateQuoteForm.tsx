import { useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useClients, useCreateQuote, useQuotes } from '@/lib/data';
import { useToast } from '@/lib/toast';

interface CreateQuoteFormProps {
  onCreated: (quoteId: string) => void;
  onCancel: () => void;
}

/**
 * [Req #75] Modal form for creating a new quote.
 * [Req #89] Hard block on duplicate Unified IDs — checks locally before server call.
 * Renders inside a modal overlay (see Dashboard.tsx).
 */
export default function CreateQuoteForm({ onCreated, onCancel }: CreateQuoteFormProps) {
  const { data: clients = [], isLoading: clientsLoading } = useClients();
  const { data: existingQuotes = [] } = useQuotes(); // [Req #89] for local duplicate check
  const createQuote = useCreateQuote();
  const { toast } = useToast();

  const [quoteNumber, setQuoteNumber] = useState('');
  const [clientId, setClientId] = useState('');
  const [localFilePath, setLocalFilePath] = useState('');
  // [Req #89] Duplicate detection state
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  // [Req #214] Type-ahead autocomplete for client search
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientInputRef = useRef<HTMLInputElement>(null);

  const selectedClient = clients.find((c) => c.id === clientId);

  // [Req #214] Filtered client list for autocomplete
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    const q = clientSearch.toLowerCase();
    return clients.filter((c) => c.code.toLowerCase().includes(q) || (c.erp_number ?? '').toLowerCase().includes(q));
  }, [clients, clientSearch]);

  // [Req #89] Check for local duplicates when quote number or client changes
  function checkDuplicate(num: string, cId: string) {
    if (!num.trim() || !cId) {
      setDuplicateWarning(null);
      return;
    }
    const match = existingQuotes.find(
      (q) => q.quote_number === num.trim() && q.client_id === cId && !q.deleted_at,
    );
    if (match) {
      setDuplicateWarning(`הצעה ${num} כבר קיימת עבור לקוח זה`);
    } else {
      setDuplicateWarning(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = quoteNumber.trim();
    if (!num || !clientId) return;

    // [Req #89] Block submission if duplicate detected
    if (duplicateWarning) {
      toast('לא ניתן ליצור כפילות — ההצעה כבר קיימת', 'error');
      return;
    }

    try {
      const result = await createQuote.mutateAsync({
        quoteNumber: num,
        clientId,
        erpNumber: selectedClient?.erp_number ?? null,
        initials: selectedClient?.initials ?? null,
        localFilePath: localFilePath.trim() || undefined,
      });

      if (result.merged) {
        // [Req #89] Server-side duplicate found — redirect to existing
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
            onChange={(e) => { setQuoteNumber(e.target.value); checkDuplicate(e.target.value, clientId); }}
            placeholder='לדוגמה: Q-920'
            autoFocus
            dir="ltr"
            className={cn(
              'w-full rounded-lg border bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none placeholder:text-(--color-text-secondary)/40',
              duplicateWarning ? 'border-red-500 focus:border-red-400' : 'border-(--color-border) focus:border-(--color-accent)',
            )}
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
            // [Req #214] Type-ahead autocomplete client picker
            <div className="relative">
              <input
                ref={clientInputRef}
                id="cqf-client"
                type="text"
                value={clientId ? (selectedClient?.code ?? '') : clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setClientId('');
                  setShowClientDropdown(true);
                  checkDuplicate(quoteNumber, '');
                }}
                onFocus={() => setShowClientDropdown(true)}
                onBlur={() => setTimeout(() => setShowClientDropdown(false), 150)}
                placeholder="הקלד קוד לקוח..."
                dir="rtl"
                className={cn(
                  'w-full rounded-lg border bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none placeholder:text-(--color-text-secondary)/40',
                  clientId ? 'border-(--color-accent)' : 'border-(--color-border) focus:border-(--color-accent)',
                )}
              />
              {clientId && (
                <button
                  type="button"
                  onClick={() => { setClientId(''); setClientSearch(''); clientInputRef.current?.focus(); }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-(--color-text-secondary)/60 hover:text-(--color-text-secondary)"
                >
                  ✕
                </button>
              )}
              {showClientDropdown && !clientId && (
                <div className="absolute z-20 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-surface) shadow-lg">
                  {filteredClients.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-(--color-text-secondary)/50">לא נמצאו לקוחות</div>
                  ) : (
                    filteredClients.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={() => {
                          setClientId(c.id);
                          setClientSearch('');
                          setShowClientDropdown(false);
                          checkDuplicate(quoteNumber, c.id);
                        }}
                        className="w-full px-3 py-2 text-right text-sm text-(--color-text) hover:bg-(--color-accent)/10 transition-colors"
                      >
                        <span className="font-semibold">{c.code}</span>
                        {c.erp_number && <span className="mr-2 text-xs text-(--color-text-secondary)">{c.erp_number}</span>}
                        {c.is_vip && <span className="mr-1 text-[10px] font-bold text-amber-500">VIP</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
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

        {/* [Req #89] Duplicate warning */}
        {duplicateWarning && (
          <div className="rounded-lg border border-red-700 bg-red-950/20 light:border-red-200 light:bg-red-50 px-3 py-2">
            <p className="text-xs font-bold text-red-400 light:text-red-700">
              ⚠ {duplicateWarning}
            </p>
            <p className="text-[10px] text-red-400/60 light:text-red-600/60 mt-0.5">
              לא ניתן ליצור הצעה כפולה. שנה מספר הצעה או לקוח.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={!quoteNumber.trim() || !clientId || createQuote.isPending || !!duplicateWarning}
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
