"use client";

import { useState, useEffect } from "react";
import { CURRENCIES } from "@/lib/currencies";

// Module-level cache so multiple components on the same page share one fetch
let _cached: string[] | null = null;

export function useActiveCurrencies(): string[] {
  const [currencies, setCurrencies] = useState<string[]>(_cached ?? (CURRENCIES as unknown as string[]));

  useEffect(() => {
    if (_cached) return;
    fetch("/api/settings/currencies")
      .then(r => r.json())
      .then((data: { currencies: string[] }) => {
        _cached = data.currencies;
        setCurrencies(data.currencies);
      })
      .catch(() => {});
  }, []);

  return currencies;
}
