import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import SplitView from '@/layouts/SplitView';
import QuoteList from '@/panels/QuoteList';
import QuoteDetail from '@/panels/QuoteDetail';
import CaptureChat from '@/panels/CaptureChat';
import WeeklyReport from '@/panels/WeeklyReport';
import CopilotBriefing from '@/components/CopilotBriefing';
import AiInternAccordion from '@/components/AiInternAccordion';
import CreateQuoteForm from '@/components/CreateQuoteForm';
import SearchBar from '@/components/SearchBar';
import FilterPanel, { EMPTY_FILTERS, isFilterActive } from '@/components/FilterPanel';
import type { FilterState, SavedFilter } from '@/components/FilterPanel';
import MetricsDashboard from '@/components/MetricsDashboard'; // [Req #17, #33]
import EscalationAlerts from '@/components/EscalationAlerts'; // [Req #87, #13]
import { applySearchAndFilters } from '@/lib/search-filter';
import { useQuotes, useClients, useInteractions, useReleasePendingNotes, useAutoArchive, useVacationMode } from '@/lib/data';
import { useHotkey } from '@/lib/hooks';

export default function Dashboard() {
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [mode, setMode] = useState<'quotes' | 'captures' | 'report'>('quotes');
  const [focusMode, setFocusMode] = useState(false);
  // [Req #75] - Modal create form state (replaces inline)
  const [showCreateForm, setShowCreateForm] = useState(false);
  // [Req #17, #33] - Metrics dashboard toggle
  const [showMetrics, setShowMetrics] = useState(false);
  // [Req #87] - Escalation alerts dismissed state
  const [alertsDismissed, setAlertsDismissed] = useState(false);

  // [Req #39] - Global search state
  const [searchQuery, setSearchQuery] = useState('');

  // [Req #40, #76] - Filter state
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // [Req #77] - Saved filters (localStorage persistence)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => {
    try {
      const stored = localStorage.getItem('proseal_saved_filters');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const { data: quotes = [], isLoading: quotesLoading } = useQuotes();
  const { data: clients = [] } = useClients();
  const { data: interactions = [] } = useInteractions(selectedQuoteId);
  // [Req #138] Vacation mode — suppress alerts when active
  const vacationMode = useVacationMode();
  const isOnVacation = vacationMode.data?.vacation_mode ?? false;

  // Queued Release: check for pending weekend notes on app load
  const releasePending = useReleasePendingNotes();
  // [Req #141] Auto-archive won/lost quotes older than 60 days
  const autoArchive = useAutoArchive();
  const releaseChecked = useRef(false);
  useEffect(() => {
    if (!releaseChecked.current) {
      releaseChecked.current = true;
      releasePending.mutate();
      autoArchive.mutate(); // [Req #141] runs silently on app load
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // [Req #39, #40] - Filtered and searched quotes
  const filteredQuotes = useMemo(
    () => applySearchAndFilters(quotes, searchQuery, filters),
    [quotes, searchQuery, filters],
  );

  const searchActive = searchQuery.trim().length > 0;
  const filterActive = isFilterActive(filters);

  // Auto-select first quote when data arrives and nothing is selected
  useEffect(() => {
    if (!selectedQuoteId && filteredQuotes.length > 0 && !showCreateForm) {
      setSelectedQuoteId(filteredQuotes[0].id);
    }
  }, [filteredQuotes, selectedQuoteId, showCreateForm]);

  const selectedQuote = quotes.find((q) => q.id === selectedQuoteId) ?? null;

  // [Req #144] SPA back button — close modals/panels instead of navigating away
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (showCreateForm) { e.preventDefault(); setShowCreateForm(false); window.history.pushState(null, ''); return; }
      if (showMetrics) { e.preventDefault(); setShowMetrics(false); window.history.pushState(null, ''); return; }
      if (showFilterPanel) { e.preventDefault(); setShowFilterPanel(false); window.history.pushState(null, ''); return; }
      if (mode !== 'quotes') { e.preventDefault(); setMode('quotes'); window.history.pushState(null, ''); return; }
      // If nothing to close, push state back to prevent leaving SPA
      window.history.pushState(null, '');
    };
    window.history.pushState(null, '');
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [showCreateForm, showMetrics, showFilterPanel, mode]);

  // [Req #215] Keyboard workflow shortcuts
  // [Req #207] Desktop system optimized for keyboard
  useHotkey('ctrl+n', () => setShowCreateForm(true));                         // New quote
  useHotkey('ctrl+m', () => setShowMetrics((v) => !v));                       // Toggle metrics
  useHotkey('ctrl+f', () => setFocusMode((v) => !v));                         // Focus mode
  useHotkey('ctrl+r', () => setMode('report'));                               // Weekly report
  useHotkey('escape', () => {
    if (showCreateForm) setShowCreateForm(false);
    else if (showMetrics) setShowMetrics(false);
    else if (showFilterPanel) setShowFilterPanel(false);
  });
  // Navigate quotes with arrow keys
  useHotkey('ctrl+j', () => {
    const idx = filteredQuotes.findIndex((q) => q.id === selectedQuoteId);
    if (idx < filteredQuotes.length - 1) setSelectedQuoteId(filteredQuotes[idx + 1].id);
  });
  useHotkey('ctrl+k', () => {
    const idx = filteredQuotes.findIndex((q) => q.id === selectedQuoteId);
    if (idx > 0) setSelectedQuoteId(filteredQuotes[idx - 1].id);
  });

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

  // [Req #77] - Save filter preset
  const handleSaveFilter = useCallback(
    (name: string, filter: FilterState) => {
      const newFilter: SavedFilter = {
        id: crypto.randomUUID(),
        name,
        filter,
      };
      const updated = [...savedFilters, newFilter];
      setSavedFilters(updated);
      try {
        localStorage.setItem('proseal_saved_filters', JSON.stringify(updated));
      } catch { /* silent */ }
    },
    [savedFilters],
  );

  // [Req #77] - Delete saved filter
  const handleDeleteFilter = useCallback(
    (id: string) => {
      const updated = savedFilters.filter((f) => f.id !== id);
      setSavedFilters(updated);
      try {
        localStorage.setItem('proseal_saved_filters', JSON.stringify(updated));
      } catch { /* silent */ }
    },
    [savedFilters],
  );

  // ── Sidebar ─────────────────────────────────────────────────────

  const sidebar = (
    <div className="flex h-full flex-col">
      {/* [Req #39] - Search bar at top of sidebar */}
      {mode === 'quotes' && (
        <div className="shrink-0 px-3 pt-3 pb-2">
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            resultCount={filteredQuotes.filter((q) => !['won', 'lost', 'dormant'].includes(q.status)).length}
            totalCount={quotes.filter((q) => !['won', 'lost', 'dormant'].includes(q.status)).length}
          />
        </div>
      )}

      {/* [Req #40, #76] - Collapsible filter panel */}
      {mode === 'quotes' && showFilterPanel && (
        <div className="shrink-0">
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            clients={clients}
            savedFilters={savedFilters}
            onSaveFilter={handleSaveFilter}
            onDeleteFilter={handleDeleteFilter}
            onClose={() => setShowFilterPanel(false)}
          />
        </div>
      )}

      {/* Quote list */}
      <div className="flex-1 min-h-0">
        <QuoteList
          quotes={filteredQuotes}
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
          searchActive={searchActive}
          filterActive={filterActive || showFilterPanel}
          onToggleFilters={() => setShowFilterPanel(!showFilterPanel)}
        />
      </div>
    </div>
  );

  // ── Main content ────────────────────────────────────────────────

  const main = (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Copilot briefing bar ── */}
      {mode === 'quotes' && !quotesLoading && quotes.length > 0 && (
        <div className="shrink-0 flex items-center justify-between border-b border-(--color-border) bg-(--color-surface) px-6 py-2">
          <CopilotBriefing quotes={quotes} onFocusQuote={focusQuote} />
          <div className="flex items-center gap-2">
            {/* [Req #17] - Metrics toggle button */}
            <button
              onClick={() => setShowMetrics(!showMetrics)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors',
                showMetrics
                  ? 'border-(--color-accent) bg-(--color-accent) text-white'
                  : 'border-(--color-border) text-(--color-text-secondary) hover:border-(--color-accent)/50',
              )}
            >
              {showMetrics ? 'מדדים' : 'מדדים'}
            </button>
            {/* [Req #138] Vacation mode toggle */}
            <button
              onClick={() => vacationMode.toggle.mutate(!isOnVacation)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors',
                isOnVacation
                  ? 'border-teal-500 bg-teal-600 text-white'
                  : 'border-(--color-border) text-(--color-text-secondary) hover:border-teal-500/50',
              )}
            >
              {isOnVacation ? '🏖️ חופשה' : '🏖️'}
            </button>
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
        </div>
      )}

      {/* [Req #138] Vacation mode banner */}
      {isOnVacation && (
        <div className="shrink-0 flex items-center justify-between border-b border-teal-800/40 light:border-teal-200 bg-teal-950/20 light:bg-teal-50 px-6 py-2">
          <span className="text-xs font-bold text-teal-400 light:text-teal-700">🏖️ מצב חופשה פעיל — התראות מושהות</span>
          <button
            onClick={() => vacationMode.toggle.mutate(false)}
            className="text-[10px] font-semibold text-teal-400 light:text-teal-700 hover:underline"
          >
            בטל חופשה
          </button>
        </div>
      )}

      {/* [Req #87, #13] - Escalation alerts bar (non-dismissed) — suppressed in vacation */}
      {mode === 'quotes' && !quotesLoading && !alertsDismissed && !isOnVacation && quotes.length > 0 && (
        <EscalationAlerts
          quotes={quotes}
          onFocusQuote={focusQuote}
          onDismiss={() => setAlertsDismissed(true)}
        />
      )}

      {/* ── AI Intern accordion (collapsed summaries) ── */}
      {mode === 'quotes' && !quotesLoading && !focusMode && !showMetrics && quotes.length > 0 && (
        <div className="shrink-0">
          <AiInternAccordion quotes={quotes} onFocusQuote={focusQuote} />
        </div>
      )}

      {/* ── Main content area (flex-1 + min-h-0 = scrolls properly) ── */}
      <div className="flex-1 min-h-0">
        {mode === 'quotes' ? (
          // [Req #17, #33] - Metrics dashboard view
          showMetrics ? (
            <MetricsDashboard quotes={quotes} />
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
                    : searchActive || filterActive
                      ? 'לא נמצאו הצעות בחיפוש הנוכחי'
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

      {/* [Req #75] - Modal overlay for create quote form */}
      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => {
              setShowCreateForm(false);
              if (quotes.length > 0 && !selectedQuoteId) setSelectedQuoteId(quotes[0].id);
            }}
          />
          {/* Modal content with expand animation */}
          <div className="relative z-10 w-full max-w-md animate-[modalIn_200ms_ease-out]">
            <CreateQuoteForm
              onCreated={handleQuoteCreated}
              onCancel={() => {
                setShowCreateForm(false);
                if (quotes.length > 0 && !selectedQuoteId) setSelectedQuoteId(quotes[0].id);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );

  return <SplitView sidebar={sidebar} main={main} />;
}
