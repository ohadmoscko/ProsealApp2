import { useCallback, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useHotkey } from '@/lib/hooks';
import { useIsOffline, usePendingSync } from '@/lib/query';
import Topbar from '@/components/Topbar';
import CaptureBar from '@/components/CaptureBar';

interface SplitViewProps {
  sidebar: ReactNode;
  main: ReactNode;
}

// [Req #134] Default sidebar width (px) and constraints
const DEFAULT_SIDEBAR_WIDTH = 288; // 18rem = w-72
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;

export default function SplitView({ sidebar, main }: SplitViewProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // [Req #134] Resizable sidebar width
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const offline = useIsOffline();
  const pendingCount = usePendingSync();
  const captureRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcuts
  useHotkey('ctrl+k', () => captureRef.current?.focus());
  useHotkey('ctrl+b', () => setSidebarCollapsed((v) => !v));

  // [Req #134] Drag-to-resize handler
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const startX = e.clientX;
    const startWidth = sidebarWidth;

    function onMouseMove(ev: MouseEvent) {
      // RTL: sidebar is on the right, so moving left = wider sidebar
      const delta = startX - ev.clientX;
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth + delta));
      setSidebarWidth(newWidth);
    }

    function onMouseUp() {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  return (
    <div ref={containerRef} className="flex h-dvh flex-col bg-(--color-surface)">
      <Topbar onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)} />

      {offline && (
        <div className="shrink-0 bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-white">
          אין חיבור לאינטרנט — שינויים יישמרו מקומית ויסונכרנו בחזרה לרשת
          {pendingCount > 0 && (
            <span className="mr-2 bg-white/20 rounded-full px-2 py-0.5">
              {pendingCount} ממתינים לסנכרון
            </span>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Right panel (sidebar) — RTL so it's on the right */}
        <aside
          className={cn(
            'border-l border-(--color-border) bg-(--color-surface-dim) transition-all overflow-hidden relative',
            sidebarCollapsed ? 'w-0 border-0' : '',
            // [Req #134] Disable transition during drag for smooth resize
            isDragging ? 'duration-0' : 'duration-200',
          )}
          style={sidebarCollapsed ? undefined : { width: sidebarWidth, minWidth: sidebarWidth }}
        >
          <div className="h-full overflow-y-auto">{sidebar}</div>
        </aside>

        {/* [Req #134] Resize handle — visible drag bar between panels */}
        {!sidebarCollapsed && (
          <div
            onMouseDown={handleMouseDown}
            className={cn(
              'shrink-0 w-1 cursor-col-resize hover:bg-(--color-accent)/30 transition-colors relative z-10',
              isDragging && 'bg-(--color-accent)/40',
            )}
            title="גרור לשינוי רוחב"
          >
            {/* Visual grip dots */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-30">
              <span className="w-1 h-1 rounded-full bg-(--color-text-secondary)" />
              <span className="w-1 h-1 rounded-full bg-(--color-text-secondary)" />
              <span className="w-1 h-1 rounded-full bg-(--color-text-secondary)" />
            </div>
          </div>
        )}

        {/* Left panel (main content) — takes remaining space */}
        <main className="flex-1 min-h-0">
          {main}
        </main>
      </div>

      <CaptureBar inputRef={captureRef} />

      {/* [Req #134] Overlay during drag to prevent iframe interference */}
      {isDragging && (
        <div className="fixed inset-0 z-50 cursor-col-resize" />
      )}
    </div>
  );
}
