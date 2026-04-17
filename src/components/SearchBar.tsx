import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useHotkey } from '@/lib/hooks';

// [Req #39, #86] - Global search bar with metadata search across all fields
interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  resultCount?: number;
  totalCount?: number;
  placeholder?: string;
}

export default function SearchBar({
  value,
  onChange,
  resultCount,
  totalCount,
  placeholder = 'חיפוש הצעות, לקוחות, הערות...',
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // [Req #39] - Keyboard shortcut: Ctrl+/ to focus search
  useHotkey('ctrl+/', () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  });

  // Sync external value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // [Req #86] - Debounced search (300ms) to avoid excessive filtering
  const handleChange = useCallback(
    (newValue: string) => {
      setLocalValue(newValue);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onChange(newValue);
      }, 300);
    },
    [onChange],
  );

  const handleClear = () => {
    setLocalValue('');
    onChange('');
    inputRef.current?.focus();
  };

  const isSearching = value.trim().length > 0;

  return (
    <div className="relative flex items-center">
      {/* Search icon */}
      <span className="absolute right-3 text-xs text-(--color-text-secondary)/40 pointer-events-none">
        ⌕
      </span>

      {/* [Req #39] - Search input */}
      <input
        ref={inputRef}
        type="text"
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        dir="rtl"
        className={cn(
          'w-full rounded-lg border bg-(--color-surface) pr-8 pl-8 py-2 text-xs text-(--color-text)',
          'outline-none transition-colors placeholder:text-(--color-text-secondary)/40',
          isSearching
            ? 'border-(--color-accent)/50 ring-1 ring-(--color-accent)/20'
            : 'border-(--color-border) focus:border-(--color-accent)/40',
        )}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            handleClear();
            inputRef.current?.blur();
          }
        }}
      />

      {/* Clear button + result count */}
      <div className="absolute left-2 flex items-center gap-1.5">
        {isSearching && resultCount != null && totalCount != null && (
          <span className="text-[10px] font-semibold text-(--color-accent)">
            {resultCount}/{totalCount}
          </span>
        )}
        {isSearching && (
          <button
            onClick={handleClear}
            className="text-xs text-(--color-text-secondary)/50 hover:text-(--color-text-secondary) transition-colors"
            title="נקה חיפוש (Esc)"
          >
            ✕
          </button>
        )}
        {!isSearching && (
          <span className="text-[10px] text-(--color-text-secondary)/30" title="Ctrl+/">
            ⌃/
          </span>
        )}
      </div>
    </div>
  );
}
