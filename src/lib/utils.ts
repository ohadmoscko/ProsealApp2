/** Merge class names (simple implementation, no clsx dependency) */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Format date to Hebrew-friendly display: "3 באפריל 2026" */
export function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso; // Return raw string if unparseable
  return d.toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Relative time in Hebrew: "לפני 3 ימים" */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return iso; // Return raw string if unparseable

  const diffMs = Date.now() - then;

  // Future date — show as absolute
  if (diffMs < 0) return fmtDate(iso.slice(0, 10));

  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return 'עכשיו';
  if (diffMins === 1) return 'לפני דקה';
  if (diffMins < 60) return `לפני ${diffMins} דק׳`;
  if (diffHours === 1) return 'לפני שעה';
  if (diffHours < 24) return `לפני ${diffHours} שעות`;
  if (diffDays === 1) return 'אתמול';
  if (diffDays < 7) return `לפני ${diffDays} ימים`;
  const weeks = Math.floor(diffDays / 7);
  if (diffDays < 30) return weeks === 1 ? 'לפני שבוע' : `לפני ${weeks} שבועות`;
  return fmtDate(iso.slice(0, 10));
}

/** Temperature (1-5) to Tailwind color class */
export function tempColor(temp: number): string {
  if (temp >= 4) return 'text-red-600';
  if (temp >= 3) return 'text-orange-500';
  if (temp >= 2) return 'text-yellow-500';
  return 'text-zinc-400';
}

/** Temperature (1-5) to Hebrew label */
export function tempLabel(temp: number): string {
  const labels: Record<number, string> = {
    1: 'קר',
    2: 'פושר',
    3: 'חם',
    4: 'רותח',
    5: 'בוער',
  };
  return labels[temp] ?? '';
}
