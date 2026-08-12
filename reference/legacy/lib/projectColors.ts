export const PROJECT_COLORS = [
  { bar: "#6366f1", text: "#3730a3" },
  { bar: "#8b5cf6", text: "#5b21b6" },
  { bar: "#14b8a6", text: "#0f766e" },
  { bar: "#f59e0b", text: "#92400e" },
  { bar: "#ec4899", text: "#9d174d" },
  { bar: "#10b981", text: "#065f46" },
  { bar: "#0ea5e9", text: "#075985" },
  { bar: "#f97316", text: "#9a3412" },
  { bar: "#a855f7", text: "#6b21a8" },
  { bar: "#ef4444", text: "#991b1b" },
  { bar: "#64748b", text: "#1e293b" },
  { bar: "#0d9488", text: "#134e4a" },
];

export function projectTextColor(barColor: string): string {
  return PROJECT_COLORS.find(c => c.bar === barColor)?.text ?? "#1e293b";
}
