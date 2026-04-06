import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

interface TopbarProps {
  onToggleSidebar: () => void;
}

export default function Topbar({ onToggleSidebar }: TopbarProps) {
  const { profile, signOut } = useAuth();
  const { resolved, setTheme } = useTheme();

  return (
    <header role="banner" className="flex h-12 shrink-0 items-center justify-between border-b border-(--color-border) bg-(--color-surface) px-4">
      {/* Right side (RTL) */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="rounded-md p-1.5 text-(--color-text-secondary) hover:bg-(--color-surface-dim) transition-colors"
          aria-label="הצג/הסתר צד"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>
        <span className="text-sm font-bold text-(--color-text)">Proseal Brain</span>
      </div>

      {/* Left side (RTL) */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
          className="rounded-md p-1.5 text-(--color-text-secondary) hover:bg-(--color-surface-dim) transition-colors"
          aria-label={resolved === 'dark' ? 'מצב בהיר' : 'מצב כהה'}
        >
          {resolved === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        {profile && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-(--color-text-secondary)">{profile.display_name || profile.email}</span>
            <button
              onClick={signOut}
              className="rounded-md px-2 py-1 text-xs text-(--color-text-secondary) hover:bg-(--color-surface-dim) transition-colors"
            >
              יציאה
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
