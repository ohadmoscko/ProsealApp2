import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useHotkey } from '@/lib/hooks';
import { useIsOffline } from '@/lib/query';
import Topbar from '@/components/Topbar';
import CaptureBar from '@/components/CaptureBar';

interface SplitViewProps {
  sidebar: ReactNode;
  main: ReactNode;
}

export default function SplitView({ sidebar, main }: SplitViewProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const offline = useIsOffline();
  const captureRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts
  useHotkey('ctrl+k', () => captureRef.current?.focus());
  useHotkey('ctrl+b', () => setSidebarCollapsed((v) => !v));

  return (
    <div className="flex h-dvh flex-col bg-(--color-surface)">
      <Topbar onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)} />

      {offline && (
        <div className="shrink-0 bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-white">
          אין חיבור לאינטרנט — חלק מהפעולות לא יעבדו
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Right panel (sidebar) — RTL so it's on the right */}
        <aside
          className={cn(
            'border-l border-(--color-border) bg-(--color-surface-dim) transition-all duration-200 overflow-hidden',
            sidebarCollapsed ? 'w-0 border-0' : 'w-72 min-w-72',
          )}
        >
          <div className="h-full overflow-y-auto">{sidebar}</div>
        </aside>

        {/* Left panel (main content) — takes remaining space */}
        <main className="flex-1 overflow-y-auto">
          {main}
        </main>
      </div>

      <CaptureBar inputRef={captureRef} />
    </div>
  );
}
