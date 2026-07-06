"use client";

import { useEffect, useRef } from "react";
import type { LogEvent, LogLevel } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const levelClass: Record<LogLevel, string> = {
  debug: "text-zinc-500",
  info: "text-zinc-300",
  warn: "text-amber-400",
  error: "text-red-400",
  critic: "text-orange-300",
  stage: "font-semibold text-sky-400",
  gpu: "text-violet-400",
};

function lineClass(log: LogEvent): string {
  if (log.level === "critic") {
    return log.message.startsWith("ACCEPT")
      ? "text-emerald-400"
      : "text-orange-300";
  }
  return levelClass[log.level];
}

/**
 * Terminal-styled log pane. Auto-scrolls to the tail unless the user has
 * scrolled up to read history (resumes when they return to the bottom).
 */
export function LogTerminal({
  logs,
  className,
  emptyMessage = "No log output yet.",
}: {
  logs: LogEvent[];
  className?: string;
  emptyMessage?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinnedToBottom.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className={cn(
        "overflow-y-auto rounded-lg border bg-zinc-950 p-3 font-mono text-xs leading-5",
        className,
      )}
    >
      {logs.length === 0 ? (
        <p className="text-zinc-500">{emptyMessage}</p>
      ) : (
        logs.map((log) => (
          <div key={log.id} className="flex gap-2 whitespace-pre-wrap">
            <span className="shrink-0 text-zinc-600">
              {new Date(log.at).toLocaleTimeString(undefined, { hour12: false })}
            </span>
            {log.agent && (
              <span className="shrink-0 text-zinc-500">[{log.agent}]</span>
            )}
            <span className={lineClass(log)}>{log.message}</span>
          </div>
        ))
      )}
    </div>
  );
}
