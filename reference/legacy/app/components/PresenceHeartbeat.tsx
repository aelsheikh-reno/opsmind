"use client";

import { useEffect } from "react";

const INTERVAL_MS = 3 * 60 * 1000; // ping every 3 minutes

export default function PresenceHeartbeat() {
  useEffect(() => {
    function ping() {
      fetch("/api/presence/ping", { method: "POST" }).catch(() => {});
    }
    ping();
    const id = setInterval(ping, INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return null;
}
