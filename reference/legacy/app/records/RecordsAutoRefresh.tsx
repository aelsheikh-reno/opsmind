"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RecordsAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(interval);
  }, [router]);

  return null;
}
