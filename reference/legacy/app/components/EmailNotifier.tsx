"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const POLL_INTERVAL = 20_000; // 20 seconds

export default function EmailNotifier() {
  const lastChecked = useRef<string>(new Date().toISOString());
  const router = useRouter();

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`/api/notifications/new-emails?since=${encodeURIComponent(lastChecked.current)}`);
        if (!res.ok) return;
        const { docs } = await res.json() as { docs: { id: string; filename: string }[] };
        lastChecked.current = new Date().toISOString();

        for (const doc of docs) {
          toast(`New document from email`, {
            description: doc.filename,
            duration: 8000,
            icon: (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="3" width="14" height="10" rx="2" stroke="#6366f1" strokeWidth="1.3" fill="none" />
                <path d="M1 6l7 4.5L15 6" stroke="#6366f1" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            ),
            action: {
              label: "Review",
              onClick: () => router.push(`/records/${doc.id}`),
            },
          });
        }
      } catch {
        // silent — don't break the app if polling fails
      }
    };

    const interval = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [router]);

  return null;
}
