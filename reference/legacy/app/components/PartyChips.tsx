"use client";

interface Props {
  parties: string[];
  max?: number; // max chips to show before "+N more"
}

export default function PartyChips({ parties, max = 2 }: Props) {
  if (parties.length === 0) return <span className="text-gray-300">—</span>;

  const visible = parties.slice(0, max);
  const overflow = parties.slice(max);

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((p) => (
        <span
          key={p}
          className="relative group/chip inline-flex items-center max-w-[160px]"
        >
          <span className="inline-block truncate text-[11px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 px-2 py-0.5 rounded-full transition-colors cursor-default">
            {p}
          </span>
          {/* Tooltip — only shown when text would be truncated; always safe to render */}
          <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 z-50 hidden group-hover/chip:flex whitespace-nowrap bg-gray-900 text-white text-[11px] font-medium px-2.5 py-1.5 rounded-lg shadow-lg max-w-xs">
            {p}
            <span className="absolute top-full left-4 -translate-x-0 border-4 border-transparent border-t-gray-900" />
          </span>
        </span>
      ))}

      {overflow.length > 0 && (
        <span className="relative group/more inline-flex items-center">
          <span className="inline-block text-[11px] font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-full transition-colors cursor-default">
            +{overflow.length}
          </span>
          {/* Overflow tooltip listing remaining parties */}
          <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 z-50 hidden group-hover/more:flex flex-col gap-1 bg-gray-900 text-white text-[11px] font-medium px-2.5 py-2 rounded-lg shadow-lg whitespace-nowrap">
            {overflow.map((p) => (
              <span key={p}>{p}</span>
            ))}
            <span className="absolute top-full left-4 border-4 border-transparent border-t-gray-900" />
          </span>
        </span>
      )}
    </div>
  );
}
