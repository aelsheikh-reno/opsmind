/** Formats a day count as "Xm Yd" when >= 30 days, otherwise "Xd". */
export function fmtDays(n: number): string {
  if (n < 30) return `${n}d`;
  const months = Math.floor(n / 30);
  const rem = n % 30;
  return rem > 0 ? `${months}m ${rem}d` : `${months}m`;
}

/** Formats a Date as "May 14, 2026 · 3:23 PM" in the UAE timezone. */
export function formatDateTime(date: Date): string {
  const datePart = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Dubai",
  });
  const timePart = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Dubai",
  });
  return `${datePart} · ${timePart}`;
}
