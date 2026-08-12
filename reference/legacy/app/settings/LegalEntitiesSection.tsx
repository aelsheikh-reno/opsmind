"use client";

type Entity = { id: string; name: string; country: string; currency: string | null };

export default function LegalEntitiesSection({ entities }: { entities: Entity[] }) {
  if (entities.length === 0) {
    return (
      <p className="text-xs text-gray-400">
        No entities yet — add a company name to a tax or VAT obligation in the Tax / VAT tabs above.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-400">
        Auto-derived from your tax and VAT obligations. Set the company name on each obligation to manage these.
      </p>
      <div className="space-y-2">
        {entities.map((e) => (
          <div
            key={e.id}
            className="flex items-center gap-2.5 px-3 py-2.5 bg-surface-inset rounded-lg border border-surface-border"
          >
            <div className="w-7 h-7 rounded-md bg-white border border-surface-border flex items-center justify-center shrink-0">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="2" width="12" height="10" rx="1.5" stroke="#6b7280" strokeWidth="1.3" fill="none" />
                <path d="M1 5h12" stroke="#6b7280" strokeWidth="1.1" />
                <circle cx="4" cy="8.5" r="0.8" fill="#6b7280" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{e.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{e.country}</span>
                {e.currency && (
                  <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{e.currency}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
