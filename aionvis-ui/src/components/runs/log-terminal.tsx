"use client";

import { useEffect, useRef, useState } from "react";
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

/** Big runs emit tens of thousands of lines — only this many live in the
 * DOM; a button at the top pages further history in on demand. */
const WINDOW_CHUNK = 500;

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
  // Programmatic scrolls fire onScroll too; without this guard a fast log
  // burst could read a mid-layout position and silently drop the pin.
  const programmatic = useRef(false);
  const [windowCount, setWindowCount] = useState(WINDOW_CHUNK);

  const hidden = Math.max(0, logs.length - windowCount);
  const visible = hidden > 0 ? logs.slice(-windowCount) : logs;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinnedToBottom.current) return;
    programmatic.current = true;
    el.scrollTop = el.scrollHeight;
    // Wrapped lines settle after layout — stick once more post-paint, so a
    // fast stream can't outrun the pin.
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      programmatic.current = false;
    });
  }, [logs]);

  const showEarlier = () => {
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    setWindowCount((c) => c + WINDOW_CHUNK);
    // Keep the viewport anchored on the lines being read while history
    // grows above them.
    requestAnimationFrame(() => {
      if (el) el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
    });
  };

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        if (programmatic.current) return;
        const el = e.currentTarget;
        pinnedToBottom.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
      className={cn(
        "overflow-y-auto rounded-lg border bg-zinc-950 p-3 font-mono text-xs leading-5",
        className,
      )}
    >
      {logs.length === 0 ? (
        <p className="text-zinc-500">{emptyMessage}</p>
      ) : (
        <>
          {hidden > 0 && (
            <button
              type="button"
              onClick={showEarlier}
              className="mb-1 w-full rounded border border-zinc-800 py-1 text-center text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
            >
              Show {Math.min(WINDOW_CHUNK, hidden)} earlier lines (
              {hidden.toLocaleString()} hidden)
            </button>
          )}
          {visible.map((log) => (
            <div key={log.id} className="flex gap-2 whitespace-pre-wrap">
              <span className="shrink-0 text-zinc-600">
                {new Date(log.at).toLocaleTimeString(undefined, { hour12: false })}
              </span>
              {log.agent && (
                <span className="shrink-0 text-zinc-500">[{log.agent}]</span>
              )}
              <span className={lineClass(log)}>{log.message}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
