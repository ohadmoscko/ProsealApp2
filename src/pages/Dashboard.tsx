import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import SplitView from '@/layouts/SplitView';
import QuoteList from '@/panels/QuoteList';
import QuoteDetail from '@/panels/QuoteDetail';
import CaptureChat from '@/panels/CaptureChat';
import WeeklyReport from '@/panels/WeeklyReport';
import CopilotBriefing from '@/components/CopilotBriefing';
import { useQuotes, useInteractions } from '@/lib/data';

export default function Dashboard() {
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [mode, setMode] = useState<'quotes' | 'report'>('quotes');

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
    />
  );

  // ── Main content ────────────────────────────────────────────────

  const main = (
    <div className="h-full flex flex-col">
      {mode === 'quotes' && !quotesLoading && (
        <CopilotBriefing quotes={quotes} onFocusQuote={focusQuote} />
      )}
      {mode === 'quotes' ? (
        quotesLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-(--color-text-secondary)/50">טוען הצעות...</p>
          </div>
        ) : selectedQuote ? (
          <QuoteDetail quote={selectedQuote} interactions={interactions} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-(--color-text-secondary)/50">
              {quotes.length === 0 ? 'אין הצעות פתוחות' : 'בחר הצעה מהרשימה'}
            </p>
          </div>
        )
      ) : (
        <CaptureChat />
      )}
    </div>
  );

  return <SplitView sidebar={sidebar} main={main} />;
}
