import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import SplitView from '@/layouts/SplitView';
import QuoteList from '@/panels/QuoteList';
import QuoteDetail from '@/panels/QuoteDetail';
import CaptureChat from '@/panels/CaptureChat';
import CopilotBriefing from '@/components/CopilotBriefing';
import AiInternAccordion from '@/components/AiInternAccordion';
import { useQuotes, useInteractions, useReleasePendingNotes } from '@/lib/data';

export default function Dashboard() {
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [mode, setMode] = useState<'quotes' | 'report'>('quotes');
  const [focusMode, setFocusMode] = useState(false);

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

  // Auto-select first quote when data arrives
  if (!selectedQuoteId && quotes.length > 0) {
    setSelectedQuoteId(quotes[0].id);
  }

  const selectedQuote = quotes.find((q) => q.id === selectedQuoteId) ?? null;

  function focusQuote(id: string) {
    setSelectedQuoteId(id);
    setMode('quotes');
  }

  const sidebar = (
    <QuoteList
      quotes={quotes}
      selectedId={selectedQuoteId}
      onSelect={setSelectedQuoteId}
      onModeChange={setMode}
      mode={mode}
      isLoading={quotesLoading}
      focusMode={focusMode}
    />
  );

  const main = (
    <div className="h-full flex flex-col">
      {mode === 'quotes' && !quotesLoading && (
        <>
          {/* Focus mode toggle */}
          <div className="flex items-center justify-between border-b border-(--color-border) bg-(--color-surface) px-6 py-2">
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
        </>
      )}
      {/* AI Intern accordion — CEO one-liner view */}
      {mode === 'quotes' && !quotesLoading && !focusMode && (
        <AiInternAccordion quotes={quotes} onFocusQuote={focusQuote} />
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
