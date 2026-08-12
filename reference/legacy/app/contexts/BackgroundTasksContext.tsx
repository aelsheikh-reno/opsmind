"use client";

import { createContext, useContext, useRef, useState, useCallback, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export type EntrySuggestion = { milestoneId: string | null; reason: string };
export type SuggestResult = { summary: string; entries: Record<string, EntrySuggestion> };

export type SuggestTask = {
  taskId: string;
  projectId: string;
  projectName: string;
  importId: string;
  importMonth: string;
  status: "running" | "done" | "error";
  result?: SuggestResult;
  error?: string;
};

interface BackgroundTasksContextValue {
  tasks: SuggestTask[];
  startMilestoneSuggest: (params: {
    projectId: string;
    projectName: string;
    importId: string;
    importMonth: string;
  }) => void;
  getTaskByImport: (importId: string) => SuggestTask | undefined;
  dismissTask: (importId: string) => void;
}

const BackgroundTasksContext = createContext<BackgroundTasksContextValue | null>(null);

export function BackgroundTasksProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<SuggestTask[]>([]);
  const taskIdCounter = useRef(0);
  const router = useRouter();

  const startMilestoneSuggest = useCallback(
    ({
      projectId,
      projectName,
      importId,
      importMonth,
    }: {
      projectId: string;
      projectName: string;
      importId: string;
      importMonth: string;
    }) => {
      const navigate = router.push.bind(router);
      const taskId = `suggest-${++taskIdCounter.current}`;

      setTasks(prev => [
        ...prev.filter(t => t.importId !== importId),
        { taskId, projectId, projectName, importId, importMonth, status: "running" },
      ]);

      toast.loading(`Suggesting milestones for ${projectName} · ${importMonth}`, {
        id: taskId,
        duration: Infinity,
      });

      fetch(`/api/projects/${projectId}/timesheets/${importId}/suggest-milestones`, {
        method: "POST",
      })
        .then(async res => {
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error ?? "AI suggestion failed");

          const raw = data as {
            suggestions: Array<{ entryId: string; milestoneId: string | null; reason: string }>;
            summary: string;
          };

          const entries: Record<string, EntrySuggestion> = {};
          for (const s of raw.suggestions) {
            entries[s.entryId] = { milestoneId: s.milestoneId, reason: s.reason };
          }
          const result: SuggestResult = { summary: raw.summary, entries };

          setTasks(prev =>
            prev.map(t => (t.taskId === taskId ? { ...t, status: "done", result } : t)),
          );

          toast.success(`Milestones ready for ${projectName} · ${importMonth}`, {
            id: taskId,
            duration: Infinity,
            action: {
              label: "View →",
              onClick: () => navigate(`/projects/${projectId}`),
            },
          });
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : "AI suggestion failed";
          setTasks(prev =>
            prev.map(t => (t.taskId === taskId ? { ...t, status: "error", error: msg } : t)),
          );
          toast.error(`Suggestion failed: ${msg}`, { id: taskId, duration: 8000 });
        });
    },
    [router],
  );

  const getTaskByImport = useCallback(
    (importId: string) => tasks.find(t => t.importId === importId),
    [tasks],
  );

  const dismissTask = useCallback((importId: string) => {
    setTasks(prev => prev.filter(t => t.importId !== importId));
  }, []);

  return (
    <BackgroundTasksContext.Provider value={{ tasks, startMilestoneSuggest, getTaskByImport, dismissTask }}>
      {children}
    </BackgroundTasksContext.Provider>
  );
}

export function useBackgroundTasks() {
  const ctx = useContext(BackgroundTasksContext);
  if (!ctx) throw new Error("useBackgroundTasks must be used inside BackgroundTasksProvider");
  return ctx;
}
