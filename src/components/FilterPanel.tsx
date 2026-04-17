import { useState } from 'react';
import { cn, tempLabel } from '@/lib/utils';
import { STATUS_LABELS, STRATEGIC_RANK_LABELS, STATUS_COLORS } from '@/lib/constants';
import type { QuoteStatus, Client } from '@/lib/database.types';

// [Req #40, #76] - Filter state: 10 dimensions per spec
export interface FilterState {
  statuses: QuoteStatus[];
  tempMin: number | null;
  tempMax: number | null;
  daysSinceMin: number | null;
  daysSinceMax: number | null;
  vipOnly: boolean;
  strategicRanks: number[];
  clientIds: string[];
  hasFollowUp: boolean | null; // null=any, true=has, false=no
  overdueOnly: boolean;
}

export const EMPTY_FILTERS: FilterState = {
  statuses: [],
  tempMin: null,
  tempMax: null,
  daysSinceMin: null,
  daysSinceMax: null,
  vipOnly: false,
  strategicRanks: [],
  clientIds: [],
  hasFollowUp: null,
  overdueOnly: false,
};

/** Check if any filter is active */
export function isFilterActive(f: FilterState): boolean {
  return (
    f.statuses.length > 0 ||
    f.tempMin != null ||
    f.tempMax != null ||
    f.daysSinceMin != null ||
    f.daysSinceMax != null ||
    f.vipOnly ||
    f.strategicRanks.length > 0 ||
    f.clientIds.length > 0 ||
    f.hasFollowUp != null ||
    f.overdueOnly
  );
}

// [Req #77] - Saved filter presets
export interface SavedFilter {
  id: string;
  name: string;
  filter: FilterState;
}

interface FilterPanelProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  clients: Client[];
  savedFilters: SavedFilter[];
  onSaveFilter?: (name: string, filter: FilterState) => void;
  onDeleteFilter?: (id: string) => void;
  onClose: () => void;
}

// [Req #40] - Filterable statuses (active only — won/lost/dormant excluded from default view)
const FILTER_STATUSES: QuoteStatus[] = ['new', 'open', 'waiting', 'follow_up', 'verbal_approval', 'in_production', 'shipped'];

export default function FilterPanel({
  filters,
  onChange,
  clients,
  savedFilters,
  onSaveFilter,
  onDeleteFilter,
  onClose,
}: FilterPanelProps) {
  const [saveMode, setSaveMode] = useState(false);
  const [saveName, setSaveName] = useState('');

  // Toggle a status in the filter
  function toggleStatus(status: QuoteStatus) {
    const next = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status];
    onChange({ ...filters, statuses: next });
  }

  // Toggle a strategic rank
  function toggleRank(rank: number) {
    const next = filters.strategicRanks.includes(rank)
      ? filters.strategicRanks.filter((r) => r !== rank)
      : [...filters.strategicRanks, rank];
    onChange({ ...filters, strategicRanks: next });
  }

  // Toggle a client
  function toggleClient(clientId: string) {
    const next = filters.clientIds.includes(clientId)
      ? filters.clientIds.filter((c) => c !== clientId)
      : [...filters.clientIds, clientId];
    onChange({ ...filters, clientIds: next });
  }

  function handleSave() {
    const name = saveName.trim();
    if (!name || !onSaveFilter) return;
    onSaveFilter(name, filters);
    setSaveName('');
    setSaveMode(false);
  }

  const hasActive = isFilterActive(filters);

  return (
    <div className="border-b border-(--color-border) bg-(--color-surface-dim) animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-(--color-border)/50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-(--color-text)">סינון מתקדם</span>
          {/* [Req #40] - Active filter count badge */}
          {hasActive && (
            <span className="rounded-full bg-(--color-accent)/20 text-(--color-accent) text-[10px] font-bold px-1.5 py-0.5">
              פעיל
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasActive && (
            <button
              onClick={() => onChange(EMPTY_FILTERS)}
              className="text-[10px] font-semibold text-(--color-text-secondary)/60 hover:text-(--color-text-secondary) transition-colors"
            >
              נקה הכל
            </button>
          )}
          <button
            onClick={onClose}
            className="text-xs text-(--color-text-secondary)/50 hover:text-(--color-text-secondary) transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3 max-h-[50vh] overflow-y-auto">
        {/* ── Saved filters (Req #77) ── */}
        {savedFilters.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-(--color-text-secondary) mb-1.5">תצוגות שמורות</p>
            <div className="flex flex-wrap gap-1.5">
              {savedFilters.map((sf) => (
                <div key={sf.id} className="flex items-center gap-0.5 group">
                  <button
                    onClick={() => onChange(sf.filter)}
                    className="rounded-full border border-(--color-border) px-2.5 py-1 text-[10px] font-semibold text-(--color-text-secondary) hover:border-(--color-accent)/50 hover:text-(--color-accent) transition-colors"
                  >
                    {sf.name}
                  </button>
                  {onDeleteFilter && (
                    <button
                      onClick={() => onDeleteFilter(sf.id)}
                      className="opacity-0 group-hover:opacity-100 text-[10px] text-(--color-text-secondary)/30 hover:text-red-400 transition-all"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Status filter (Req #40 dimension 1) ── */}
        <div>
          <p className="text-[10px] font-bold text-(--color-text-secondary) mb-1.5">סטטוס</p>
          <div className="flex flex-wrap gap-1">
            {FILTER_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors',
                  filters.statuses.includes(s)
                    ? STATUS_COLORS[s]
                    : 'border-(--color-border) text-(--color-text-secondary)/50 hover:text-(--color-text-secondary)',
                )}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* ── Temperature range (Req #40 dimension 2) ── */}
        <div>
          <p className="text-[10px] font-bold text-(--color-text-secondary) mb-1.5">טמפרטורה</p>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((t) => {
              const isInRange =
                (filters.tempMin == null || t >= filters.tempMin) &&
                (filters.tempMax == null || t <= filters.tempMax) &&
                (filters.tempMin != null || filters.tempMax != null);
              return (
                <button
                  key={t}
                  onClick={() => {
                    // Click behavior: first click sets min, second sets max, third clears
                    if (filters.tempMin == null && filters.tempMax == null) {
                      onChange({ ...filters, tempMin: t, tempMax: 5 });
                    } else if (filters.tempMin === t && filters.tempMax === 5) {
                      onChange({ ...filters, tempMin: t, tempMax: t });
                    } else {
                      onChange({ ...filters, tempMin: null, tempMax: null });
                    }
                  }}
                  className={cn(
                    'rounded-lg border px-2 py-1 text-[10px] font-bold transition-colors',
                    isInRange
                      ? 'border-(--color-accent)/50 bg-(--color-accent)/10 text-(--color-accent)'
                      : 'border-(--color-border) text-(--color-text-secondary)/40 hover:text-(--color-text-secondary)',
                  )}
                  title={tempLabel(t)}
                >
                  {tempLabel(t)}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Strategic rank (Req #40 dimension 3) ── */}
        <div>
          <p className="text-[10px] font-bold text-(--color-text-secondary) mb-1.5">דירוג אסטרטגי</p>
          <div className="flex gap-1">
            {[1, 2, 3].map((r) => (
              <button
                key={r}
                onClick={() => toggleRank(r)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors',
                  filters.strategicRanks.includes(r)
                    ? r === 1
                      ? 'bg-red-950/40 text-red-300 border-red-700 light:bg-red-100 light:text-red-700'
                      : r === 2
                        ? 'bg-orange-950/40 text-orange-300 border-orange-700 light:bg-orange-100 light:text-orange-700'
                        : 'bg-zinc-800/40 text-zinc-400 border-zinc-600 light:bg-zinc-100 light:text-zinc-600'
                    : 'border-(--color-border) text-(--color-text-secondary)/40 hover:text-(--color-text-secondary)',
                )}
              >
                {STRATEGIC_RANK_LABELS[r]}
              </button>
            ))}
          </div>
        </div>

        {/* ── VIP only (Req #40 dimension 4) ── */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.vipOnly}
              onChange={() => onChange({ ...filters, vipOnly: !filters.vipOnly })}
              className="accent-(--color-accent)"
            />
            <span className="text-[10px] font-bold text-(--color-text-secondary)">VIP בלבד</span>
          </label>

          {/* ── Overdue only (Req #40 dimension 5) ── */}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.overdueOnly}
              onChange={() => onChange({ ...filters, overdueOnly: !filters.overdueOnly })}
              className="accent-(--color-accent)"
            />
            <span className="text-[10px] font-bold text-(--color-text-secondary)">באיחור בלבד</span>
          </label>
        </div>

        {/* ── Follow-up filter (Req #40 dimension 6) ── */}
        <div>
          <p className="text-[10px] font-bold text-(--color-text-secondary) mb-1.5">מעקב</p>
          <div className="flex gap-1">
            {[
              { value: null, label: 'הכל' },
              { value: true, label: 'יש מעקב' },
              { value: false, label: 'ללא מעקב' },
            ].map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => onChange({ ...filters, hasFollowUp: opt.value as boolean | null })}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors',
                  filters.hasFollowUp === opt.value
                    ? 'border-(--color-accent)/50 bg-(--color-accent)/10 text-(--color-accent)'
                    : 'border-(--color-border) text-(--color-text-secondary)/40 hover:text-(--color-text-secondary)',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Client filter (Req #40 dimension 7) ── */}
        {clients.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-(--color-text-secondary) mb-1.5">
              לקוח
              {filters.clientIds.length > 0 && (
                <span className="mr-1 text-(--color-accent)">({filters.clientIds.length})</span>
              )}
            </p>
            <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
              {clients.slice(0, 20).map((c) => (
                <button
                  key={c.id}
                  onClick={() => toggleClient(c.id)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors',
                    filters.clientIds.includes(c.id)
                      ? 'border-(--color-accent)/50 bg-(--color-accent)/10 text-(--color-accent)'
                      : 'border-(--color-border) text-(--color-text-secondary)/50 hover:text-(--color-text-secondary)',
                  )}
                >
                  {c.code}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Days since contact range (Req #40 dimension 8) ── */}
        <div>
          <p className="text-[10px] font-bold text-(--color-text-secondary) mb-1.5">ימים ללא קשר</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={365}
              value={filters.daysSinceMin ?? ''}
              onChange={(e) =>
                onChange({ ...filters, daysSinceMin: e.target.value ? parseInt(e.target.value) : null })
              }
              placeholder="מ-"
              className="w-14 rounded border border-(--color-border) bg-(--color-surface) px-2 py-1 text-[10px] text-(--color-text) outline-none focus:border-(--color-accent)/40"
              dir="ltr"
            />
            <span className="text-[10px] text-(--color-text-secondary)/40">—</span>
            <input
              type="number"
              min={0}
              max={365}
              value={filters.daysSinceMax ?? ''}
              onChange={(e) =>
                onChange({ ...filters, daysSinceMax: e.target.value ? parseInt(e.target.value) : null })
              }
              placeholder="עד"
              className="w-14 rounded border border-(--color-border) bg-(--color-surface) px-2 py-1 text-[10px] text-(--color-text) outline-none focus:border-(--color-accent)/40"
              dir="ltr"
            />
          </div>
        </div>

        {/* ── Save current filter (Req #77) ── */}
        {onSaveFilter && hasActive && (
          <div className="pt-1 border-t border-(--color-border)/30">
            {saveMode ? (
              <div className="flex items-center gap-2">
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  autoFocus
                  placeholder="שם התצוגה..."
                  className="flex-1 rounded border border-(--color-border) bg-(--color-surface) px-2 py-1 text-[10px] text-(--color-text) outline-none focus:border-(--color-accent)/40"
                  dir="rtl"
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                />
                <button
                  onClick={handleSave}
                  disabled={!saveName.trim()}
                  className="text-[10px] font-bold text-(--color-accent) disabled:opacity-30 hover:underline"
                >
                  שמור
                </button>
                <button
                  onClick={() => { setSaveMode(false); setSaveName(''); }}
                  className="text-[10px] text-(--color-text-secondary)/50 hover:text-(--color-text-secondary)"
                >
                  ביטול
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSaveMode(true)}
                className="text-[10px] font-semibold text-(--color-accent)/70 hover:text-(--color-accent) transition-colors"
              >
                + שמור כתצוגה
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
