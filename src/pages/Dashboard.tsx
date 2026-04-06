import { useState } from 'react';
import SplitView from '@/layouts/SplitView';
import QuoteList from '@/panels/QuoteList';
import QuoteDetail from '@/panels/QuoteDetail';
import CaptureChat from '@/panels/CaptureChat';
import CopilotBriefing from '@/components/CopilotBriefing';
import { useQuotes, useInteractions } from '@/lib/data';

export default function Dashboard() {
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [mode, setMode] = useState<'quotes' | 'report'>('quotes');

  const { data: quotes = [], isLoading: quotesLoading } = useQuotes();
  const { data: interactions = [] } = useInteractions(selectedQuoteId);

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
    />
  );

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
