import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import SplitView from '@/layouts/SplitView';
import QuoteList from '@/panels/QuoteList';
import QuoteDetail from '@/panels/QuoteDetail';
import CaptureChat from '@/panels/CaptureChat';
import WeeklyReport from '@/panels/WeeklyReport';
import CopilotBriefing from '@/components/CopilotBriefing';
import AiInternAccordion from '@/components/AiInternAccordion';
import CreateQuoteForm from '@/components/CreateQuoteForm';
import { useQuotes, useInteractions, useReleasePendingNotes } from '@/lib/data';

export default function Dashboard() {
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [mode, setMode] = useState<'quotes' | 'captures' | 'report'>('quotes');
  const [focusMode, setFocusMode] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const { data: quotes = [], isLoading: quotesLoading } = useQuotes();
  const { data: interactions = [] } = useInteractions(selectedQuoteId);

  // Queued Release: check for pending weekend notes on app load
  const releasePending = useReleasePendingNotes();
  const releaseChecked = useRef(false);
  useEffect(() => {
    if (!releaseChecked.current) {
      releaseChecked.current = true;
      releasePending.mutate();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select first quote when data arrives and nothing is selected
  useEffect(() => {
    if (!selectedQuoteId && quotes.length > 0 && !showCreateForm) {
      setSelectedQuoteId(quotes[0].id);
    }
  }, [quotes, selectedQuoteId, showCreateForm]);

  const selectedQuote = quotes.find((q) => q.id === selectedQuoteId) ?? null;

  function focusQuote(id: string) {
    setSelectedQuoteId(id);
    setMode('quotes');
    setShowCreateForm(false);
  }

  function handleQuoteCreated(quoteId: string) {
    setShowCreateForm(false);
    setSelectedQuoteId(quoteId);
    setMode('quotes');
  }

  function handleCreateNew() {
    setShowCreateForm(true);
    setSelectedQuoteId(null);
  }

  // ── Sidebar ─────────────────────────────────────────────────────

  const sidebar = (
    <QuoteList
      quotes={quotes}
      selectedId={selectedQuoteId}
      onSelect={(id) => {
        setSelectedQuoteId(id);
        setShowCreateForm(false);
      }}
      onModeChange={setMode}
      mode={mode}
      isLoading={quotesLoading}
      focusMode={focusMode}
      onCreateNew={handleCreateNew}
    />
  );

  // ── Main content ────────────────────────────────────────────────

  const main = (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Copilot briefing bar ── */}
      {mode === 'quotes' && !quotesLoading && quotes.length > 0 && (
        <div className="shrink-0 flex items-center justify-between border-b border-(--color-border) bg-(--color-surface) px-6 py-2">
          <CopilotBriefing quotes={quotes} onFocusQuote={focusQuote} />
          <button
            onClick={() => setFocusMode(!focusMode)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors',
              focusMode
                ? 'border-(--color-accent) bg-(--color-accent) text-white'
                : 'border-(--color-border) text-(--color-text-secondary) hover:border-(--color-accent)/50',
            )}
          >
            {focusMode ? 'מצב מיקוד' : 'מיקוד'}
          </button>
        </div>
      )}

      {/* ── AI Intern accordion (collapsed summaries) ── */}
      {mode === 'quotes' && !quotesLoading && !focusMode && quotes.length > 0 && (
        <div className="shrink-0">
          <AiInternAccordion quotes={quotes} onFocusQuote={focusQuote} />
        </div>
      )}

      {/* ── Main content area (flex-1 + min-h-0 = scrolls properly) ── */}
      <div className="flex-1 min-h-0">
        {mode === 'quotes' ? (
          showCreateForm ? (
            <CreateQuoteForm
              onCreated={handleQuoteCreated}
              onCancel={() => {
                setShowCreateForm(false);
                if (quotes.length > 0) setSelectedQuoteId(quotes[0].id);
              }}
            />
          ) : quotesLoading ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-(--color-text-secondary)/50">טוען הצעות...</p>
            </div>
          ) : selectedQuote ? (
            <QuoteDetail quote={selectedQuote} interactions={interactions} />
          ) : (
            /* ── Empty state with create action ── */
            <div className="flex h-full items-center justify-center">
              <div className="text-center space-y-4">
                <p className="text-sm text-(--color-text-secondary)/60">
                  {quotes.length === 0
                    ? 'אין הצעות פתוחות. צור הצעה חדשה כדי להתחיל.'
                    : 'בחר הצעה מהרשימה'}
                </p>
                {quotes.length === 0 && (
                  <button
                    onClick={handleCreateNew}
                    className="rounded-lg bg-(--color-accent) px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    צור הצעה ראשונה
                  </button>
                )}
              </div>
            </div>
          )
        ) : mode === 'report' ? (
          <WeeklyReport />
        ) : (
          <CaptureChat />
        )}
      </div>
    </div>
  );

  return <SplitView sidebar={sidebar} main={main} />;
}
