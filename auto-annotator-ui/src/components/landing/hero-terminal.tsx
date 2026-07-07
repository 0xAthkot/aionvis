"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Looping replay of a real pipeline run for the landing hero. Line colors
 * match the live Mission Control terminal (see runs/log-terminal.tsx) so the
 * demo looks exactly like the marketing.
 */
const SCRIPT: { cls: string; text: string }[] = [
  { cls: "text-zinc-500", text: "$ POST /api/v1/runs → run_0014 · queued" },
  { cls: "font-semibold text-sky-400", text: "━━ PROMPT EXPANSION ━━" },
  { cls: "text-zinc-300", text: "Incorporating 1 flagged hard case from the playground" },
  { cls: "text-zinc-300", text: "LLM expanded 1 sentence → 48 scenarios (Fireworks AI)" },
  { cls: "font-semibold text-sky-400", text: "━━ SYNTHESIS ━━" },
  { cls: "text-violet-400", text: "SDXL resident · 6.8 GB VRAM" },
  { cls: "text-zinc-300", text: 'img_0031 rendered — "dimly lit aisle, forklift behind pallets"' },
  { cls: "font-semibold text-sky-400", text: "━━ VISION ━━" },
  { cls: "text-zinc-300", text: "SAM segmenting open-vocabulary: forklift, pallet, worker" },
  { cls: "font-semibold text-sky-400", text: "━━ CRITIC ━━" },
  { cls: "text-emerald-400", text: "ACCEPT forklift · IoU 0.91 — box re-derived from contour" },
  { cls: "text-orange-300", text: "REJECT worker · IoU 0.44 — regenerating label" },
  { cls: "text-emerald-400", text: "SEMANTIC PASS — VLM confirms the crop is a forklift" },
  { cls: "font-semibold text-sky-400", text: "━━ TRAINING ━━" },
  { cls: "text-violet-400", text: "hip.empty_cache() — handing the GPU to YOLOv10" },
  { cls: "text-zinc-300", text: "epoch 60/60 · mAP50 0.85 · writing the model card" },
  { cls: "text-emerald-400", text: "✓ model_0014 ready — zero human labels" },
];

const TICK_MS = 620;
const HOLD_TICKS = 7; // pause on the finished run before looping

export function HeroTerminal() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setTick((t) => (t >= SCRIPT.length + HOLD_TICKS ? 0 : t + 1)),
      TICK_MS,
    );
    return () => clearInterval(id);
  }, []);

  const visible = Math.min(tick, SCRIPT.length);

  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -inset-4 rounded-3xl bg-primary/20 blur-3xl"
      />
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-zinc-950/90 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-red-500/80" />
          <span className="size-2.5 rounded-full bg-amber-500/80" />
          <span className="size-2.5 rounded-full bg-emerald-500/80" />
          <span className="ml-2 font-mono text-xs text-zinc-500">
            mission-control — run_0014
          </span>
          <span className="ml-auto font-mono text-xs text-emerald-400/80">
            ● live
          </span>
        </div>
        <div className="flex h-72 flex-col justify-end gap-1 overflow-hidden px-4 py-4 font-mono text-xs sm:h-80 sm:text-[13px]">
          {SCRIPT.slice(0, visible).map((line, i) => (
            <p key={i} className={cn("whitespace-nowrap", line.cls)}>
              {line.text}
            </p>
          ))}
          <p className="text-zinc-500">
            <span className="animate-pulse">▍</span>
          </p>
        </div>
      </div>
    </div>
  );
}
