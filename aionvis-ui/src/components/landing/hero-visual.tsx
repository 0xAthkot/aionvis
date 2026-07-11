"use client";

import {
  Boxes,
  Check,
  Eye,
  ImageIcon,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Skeleton17 } from "@/components/datasets/bbox-image";
import { cn } from "@/lib/utils";
import { HERO_OVERLAYS } from "./hero-overlays";

/**
 * Looping visual replay of a run for the landing hero: use case typed →
 * synthetic images appear → verified boxes draw on → training → model ready.
 * Each loop plays the next scenario. Every tile is a REAL FLUX.2-klein
 * output from a real MI300X pipeline run (public/landing/*.jpg) with its
 * REAL SAM 3 + Critic-verified boxes - normalized cx/cy/w/h straight from
 * the dataset records (ds_0004 / ds_0005 / ds_0006, 2026-07-10).
 */
// Display rule: every stored box with confidence >= 0.50 is drawn (the
// dataset records keep lower-confidence ones too, but they don't ship on
// the marketing tiles). chip: draw the label pill (highest-confidence box
// of each class per tile); the rest render as bare outlines so the pills
// never collide.
type Box = {
  label: string; color: string;
  cx: number; cy: number; w: number; h: number;
  chip?: boolean;
};
type Scenario = {
  prompt: string;
  done: string;
  tiles: { src: string; boxes: Box[] }[];
};

const SCENARIOS: Scenario[] = [
  {
    // ds_0004 · run_0007 - the 500-image flagship (FLUX.2-klein + SAM 3)
    prompt: "our warehouse safety cameras need to spot forklifts, pallets and workers",
    done: "model_0004 ready · mAP50 0.76 · exported .pt / ONNX",
    tiles: [
      {
        src: "/landing/warehouse-ds0004-1.jpg", // img_0351, all 3 verified boxes
        boxes: [
          { label: "forklift", color: "#d97706", cx: 0.4839, cy: 0.3701, w: 0.5025, h: 0.6513, chip: true },
          { label: "pallet", color: "#0284c7", cx: 0.7949, cy: 0.7172, w: 0.4102, h: 0.5656, chip: true },
          { label: "worker", color: "#65a30d", cx: 0.4945, cy: 0.4504, w: 0.168, h: 0.268, chip: true },
        ],
      },
      {
        src: "/landing/warehouse-ds0004-2.jpg", // img_0119, 5 of 6 stored boxes (one forklift at conf 0.39 < 0.50)
        boxes: [
          { label: "pallet", color: "#0284c7", cx: 0.3194, cy: 0.7146, w: 0.4659, h: 0.4426, chip: true },
          { label: "worker", color: "#65a30d", cx: 0.465, cy: 0.5533, w: 0.1363, h: 0.2598, chip: true },
          { label: "forklift", color: "#d97706", cx: 0.6621, cy: 0.3462, w: 0.5227, h: 0.5646, chip: true },
          { label: "pallet", color: "#0284c7", cx: 0.8752, cy: 0.0539, w: 0.2496, h: 0.1072 },
          { label: "pallet", color: "#0284c7", cx: 0.8654, cy: 0.0933, w: 0.2691, h: 0.1432 },
        ],
      },
      {
        src: "/landing/warehouse-ds0004-3.jpg", // img_0055, all 7 verified boxes
        boxes: [
          { label: "forklift", color: "#d97706", cx: 0.7086, cy: 0.4259, w: 0.4203, h: 0.5217, chip: true },
          { label: "worker", color: "#65a30d", cx: 0.174, cy: 0.4661, w: 0.1699, h: 0.2037, chip: true },
          { label: "pallet", color: "#0284c7", cx: 0.4091, cy: 0.2859, w: 0.3607, h: 0.3039, chip: true },
          { label: "pallet", color: "#0284c7", cx: 0.7785, cy: 0.0955, w: 0.257, h: 0.1869 },
          { label: "pallet", color: "#0284c7", cx: 0.1828, cy: 0.3797, w: 0.2719, h: 0.1719 },
          { label: "pallet", color: "#0284c7", cx: 0.6191, cy: 0.0625, w: 0.268, h: 0.125 },
          { label: "pallet", color: "#0284c7", cx: 0.9313, cy: 0.0323, w: 0.1375, h: 0.0646 },
        ],
      },
    ],
  },
  {
    // ds_0005 · run_0008 - farm-aerial landing refresh
    prompt: "my farm drone needs to spot tractors and hay bales across the fields",
    done: "model_0005 ready · FLUX.2 + SAM 3 · zero human labels",
    tiles: [
      {
        src: "/landing/farm-ds0005-1.jpg", // img_0002, all 13 verified boxes
        boxes: [
          { label: "hay_bale", color: "#0284c7", cx: 0.2327, cy: 0.6119, w: 0.1768, h: 0.1785, chip: true },
          { label: "hay_bale", color: "#0284c7", cx: 0.3985, cy: 0.4035, w: 0.0826, h: 0.0844 },
          { label: "hay_bale", color: "#0284c7", cx: 0.2021, cy: 0.4316, w: 0.1039, h: 0.1008 },
          { label: "hay_bale", color: "#0284c7", cx: 0.2687, cy: 0.4141, w: 0.101, h: 0.093 },
          { label: "tractor", color: "#d97706", cx: 0.4939, cy: 0.5566, w: 0.2855, h: 0.2773, chip: true },
          { label: "hay_bale", color: "#0284c7", cx: 0.1341, cy: 0.4512, w: 0.1108, h: 0.1094 },
          { label: "hay_bale", color: "#0284c7", cx: 0.119, cy: 0.3894, w: 0.1193, h: 0.0486 },
          { label: "hay_bale", color: "#0284c7", cx: 0.2282, cy: 0.36, w: 0.1197, h: 0.0449 },
          { label: "hay_bale", color: "#0284c7", cx: 0.3274, cy: 0.3951, w: 0.0865, h: 0.091 },
          { label: "hay_bale", color: "#0284c7", cx: 0.3794, cy: 0.3501, w: 0.0865, h: 0.04 },
          { label: "hay_bale", color: "#0284c7", cx: 0.0567, cy: 0.4715, w: 0.1135, h: 0.118 },
          { label: "hay_bale", color: "#0284c7", cx: 0.0312, cy: 0.4165, w: 0.0625, h: 0.0381 },
          { label: "hay_bale", color: "#0284c7", cx: 0.0034, cy: 0.4887, w: 0.0067, h: 0.0695 },
        ],
      },
      {
        src: "/landing/farm-ds0005-2.jpg", // img_0000, its 1 verified box
        boxes: [
          { label: "tractor", color: "#d97706", cx: 0.5418, cy: 0.501, w: 0.332, h: 0.3332, chip: true },
        ],
      },
      {
        src: "/landing/farm-ds0005-3.jpg", // img_0003, its 1 verified box
        boxes: [
          { label: "tractor", color: "#d97706", cx: 0.5195, cy: 0.5293, w: 0.3, h: 0.3352, chip: true },
        ],
      },
    ],
  },
  {
    // ds_0006 · run_0010 - street-camera landing refresh
    prompt: "our street cameras need to detect delivery vans and cyclists",
    done: "model_0006 ready · trained on 100% synthetic data",
    tiles: [
      {
        src: "/landing/street-ds0006-1.jpg", // img_0007, all 2 verified boxes
        boxes: [
          { label: "delivery_van", color: "#0284c7", cx: 0.5391, cy: 0.3186, w: 0.493, h: 0.4597, chip: true },
          { label: "cyclist", color: "#65a30d", cx: 0.2767, cy: 0.7477, w: 0.1389, h: 0.2047, chip: true },
        ],
      },
      {
        src: "/landing/street-ds0006-2.jpg", // img_0010, all 2 verified boxes
        boxes: [
          { label: "delivery_van", color: "#0284c7", cx: 0.4971, cy: 0.3643, w: 0.4777, h: 0.4237, chip: true },
          { label: "cyclist", color: "#65a30d", cx: 0.0725, cy: 0.7266, w: 0.1152, h: 0.2125, chip: true },
        ],
      },
      {
        src: "/landing/street-ds0006-4.jpg", // img_0011, all 4 verified boxes
        boxes: [
          { label: "delivery_van", color: "#0284c7", cx: 0.3146, cy: 0.5158, w: 0.2583, h: 0.2027, chip: true },
          { label: "cyclist", color: "#65a30d", cx: 0.651, cy: 0.4912, w: 0.0457, h: 0.0832, chip: true },
          { label: "delivery_van", color: "#0284c7", cx: 0.2845, cy: 0.4502, w: 0.1221, h: 0.084 },
          { label: "cyclist", color: "#65a30d", cx: 0.0133, cy: 0.6055, w: 0.0266, h: 0.0859 },
        ],
      },
    ],
  },
];

// One 250 ms tick drives the whole timeline; everything derives from `t`.
// The interval itself runs at 50 ms (5 sub-ticks per tick) so the prompt
// can type character by character instead of in 5-char chunks.
const SUB = 5;
const TYPE_END = 11;
const TILE_AT = [14, 17, 20];
const BOX_AT = [24, 26, 28];
const VERIFY_AT = 31; // Critic pass: the ✓ appears on every label
const TRAIN_START = 35;
const TRAIN_END = 49;
const DONE_AT = 50;
const LOOP_AT = 66;

const AGENTS = [
  { name: "Prompt", icon: MessageSquareText, from: 0 },
  { name: "Synthesis", icon: ImageIcon, from: TILE_AT[0] },
  { name: "Vision", icon: Eye, from: BOX_AT[0] },
  { name: "Critic", icon: ShieldCheck, from: VERIFY_AT },
  { name: "MLOps", icon: Boxes, from: TRAIN_START },
];

const CYCLE = (LOOP_AT + 1) * SUB;

export function HeroVisual() {
  // Global 50 ms frame counter; each CYCLE-long loop plays the next scenario.
  const [f, setF] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setF((v) => v + 1), 50);
    return () => clearInterval(id);
  }, []);

  const scenario = SCENARIOS[Math.floor(f / CYCLE) % SCENARIOS.length];
  const local = f % CYCLE;
  const t = Math.floor(local / SUB);
  const typed = scenario.prompt.slice(
    0,
    Math.ceil(
      (scenario.prompt.length * Math.min(local, TYPE_END * SUB)) /
        (TYPE_END * SUB),
    ),
  );
  const expanded = t > TYPE_END + 1;
  const training = t >= TRAIN_START && t < DONE_AT;
  const done = t >= DONE_AT;
  const progress = Math.min(1, Math.max(0, (t - TRAIN_START) / (TRAIN_END - TRAIN_START)));
  const activeAgent = AGENTS.reduce((acc, a, i) => (t >= a.from ? i : acc), 0);

  const status = done
    ? scenario.done
    : training
      ? `Training yolo26m · epoch ${Math.max(1, Math.round(progress * 60))}/60`
      : t >= VERIFY_AT
        ? "Verifying every label - geometry + Gemma 4 VLM"
        : t >= BOX_AT[0]
          ? "Segmenting objects - open vocabulary (SAM 3)"
          : t >= TILE_AT[0]
            ? "Rendering scenarios (FLUX.2)"
            : expanded
              ? "48 domain-randomized scenarios queued"
              : "Describe what the model should detect";

  return (
    <div className="relative">
      <div aria-hidden className="absolute -inset-8 rounded-[3rem] bg-primary/15 blur-3xl" />
      <div className="relative space-y-5">
        {/* prompt bar */}
        <div className="mx-auto flex max-w-xl items-center gap-3 rounded-full border bg-card px-5 py-3 shadow-xl">
          <Sparkles className="size-4 shrink-0 text-primary" />
          <p className="truncate text-sm">
            {typed}
            {!expanded && <span className="animate-pulse text-muted-foreground">▍</span>}
          </p>
          <span
            className={cn(
              "ml-auto shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] text-primary transition-opacity duration-500",
              expanded ? "opacity-100" : "opacity-0",
            )}
          >
            → 48 scenarios
          </span>
        </div>

        {/* agent strip - who is working right now */}
        <div className="flex items-center justify-center">
          {AGENTS.map((a, i) => {
            const isActive = !done && i === activeAgent;
            const isDone = done || i < activeAgent;
            return (
              <Fragment key={a.name}>
                {i > 0 && (
                  <span
                    className={cn(
                      "h-px w-3 transition-colors duration-500 sm:w-6",
                      isDone || isActive ? "bg-primary/50" : "bg-border",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] whitespace-nowrap transition-all duration-300",
                    isActive
                      ? "border-primary/50 bg-primary/10 font-medium text-foreground"
                      : isDone
                        ? "border-transparent text-muted-foreground"
                        : "border-transparent text-muted-foreground/40",
                  )}
                >
                  {isDone ? (
                    <Check className="size-3 shrink-0 text-emerald-400" />
                  ) : (
                    <a.icon
                      className={cn("size-3 shrink-0", isActive && "text-primary")}
                    />
                  )}
                  <span className="hidden sm:inline">{a.name} Agent</span>
                  <span className="sm:hidden">{a.name}</span>
                  {isActive && (
                    <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                  )}
                </span>
              </Fragment>
            );
          })}
        </div>

        {/* generated tiles: SAM 3 mask contours while the Vision + Critic
            agents work, then the trained model's output (boxes, and
            skeletons where the pose teacher found people) from MLOps on */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {scenario.tiles.map((tile, i) => {
            const shown = t >= TILE_AT[i];
            const boxed = t >= BOX_AT[i];
            const masksPhase = t < TRAIN_START;
            const overlays = HERO_OVERLAYS[tile.src] ?? [];
            return (
              <div
                key={tile.src}
                className={cn(
                  "relative aspect-square overflow-hidden rounded-2xl border shadow-2xl transition-all duration-700",
                  shown
                    ? "translate-y-0 border-white/15 opacity-100"
                    : "translate-y-2 border-dashed border-white/10 bg-white/[0.03] opacity-90",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- static marketing asset, no optimization needed */}
                <img
                  src={tile.src}
                  alt="Synthetic training image generated by the swarm"
                  className={cn(
                    "size-full object-cover transition-all duration-700",
                    shown ? "scale-100 opacity-100" : "scale-105 opacity-0",
                  )}
                />
                {!shown && (
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-white/5 to-transparent" />
                )}
                {/* Working state while the tile is empty: which agent is on
                    it right now. Fades out as the render lands. */}
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 transition-opacity duration-500",
                    shown ? "opacity-0" : "opacity-100",
                  )}
                >
                  {!expanded ? (
                    <Sparkles className="size-5 animate-pulse text-muted-foreground/60" />
                  ) : t < TILE_AT[0] ? (
                    <MessageSquareText className="size-5 animate-pulse text-primary/70" />
                  ) : (
                    <ImageIcon className="size-5 animate-pulse text-primary/70" />
                  )}
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {!expanded
                      ? "Awaiting user prompt…"
                      : t < TILE_AT[0]
                        ? "Generating prompts…"
                        : "Rendering image…"}
                  </span>
                </div>
                {boxed && (
                  <>
                    {/* Both overlay layers stay mounted and CROSS-FADE at
                        the MLOps handoff — an unmount would snap. */}
                    <svg
                      aria-hidden
                      className={cn(
                        "absolute inset-0 z-10 size-full transition-opacity duration-700",
                        masksPhase ? "opacity-100" : "opacity-0",
                      )}
                      viewBox="0 0 1 1"
                      preserveAspectRatio="none"
                    >
                      {tile.boxes.map((b, bi) => {
                        const ov = overlays[bi];
                        if (!ov?.polygon) return null;
                        const pts: string[] = [];
                        for (let p = 0; p + 1 < ov.polygon.length; p += 2)
                          pts.push(`${ov.polygon[p]},${ov.polygon[p + 1]}`);
                        return (
                          <polygon
                            key={bi}
                            points={pts.join(" ")}
                            fill={b.color}
                            fillOpacity={0.15}
                            stroke={b.color}
                            strokeWidth={2}
                            vectorEffect="non-scaling-stroke"
                            strokeLinejoin="round"
                          />
                        );
                      })}
                    </svg>
                    <svg
                      aria-hidden
                      className={cn(
                        "absolute inset-0 z-10 size-full transition-opacity duration-700",
                        masksPhase ? "opacity-0" : "opacity-100",
                      )}
                      viewBox="0 0 1 1"
                      preserveAspectRatio="none"
                    >
                      {tile.boxes.map((b, bi) =>
                        overlays[bi]?.keypoints ? (
                          <Skeleton17
                            key={bi}
                            flat={overlays[bi].keypoints}
                            color={b.color}
                          />
                        ) : null,
                      )}
                    </svg>
                  </>
                )}
                {tile.boxes.map((b) => (
                  <div
                    key={b.label + b.cx}
                    className={cn(
                      "absolute rounded-sm border-2 transition-all duration-700",
                      boxed ? "scale-100 opacity-100" : "scale-110 opacity-0",
                      // Chipped boxes stack above bare outlines so their
                      // label pills are never covered (each box is its own
                      // stacking context via the scale transform).
                      b.chip ? "z-20" : "z-0",
                    )}
                    style={{
                      // The rectangle is the trained model's output - its
                      // color fades in at the MLOps handoff while the SAM 3
                      // contours fade out (cross-fade, not a snap).
                      borderColor: masksPhase ? "transparent" : b.color,
                      left: `${(b.cx - b.w / 2) * 100}%`,
                      top: `${(b.cy - b.h / 2) * 100}%`,
                      width: `${b.w * 100}%`,
                      height: `${b.h * 100}%`,
                    }}
                  >
                    {b.chip && (
                      <span
                        className={cn(
                          "absolute -top-5 rounded-sm px-1 py-px text-[10px] font-medium whitespace-nowrap text-zinc-950",
                          // Anchor right for boxes near the tile's right edge so
                          // the label isn't clipped by overflow-hidden.
                          b.cx > 0.8 ? "right-0" : "left-0",
                        )}
                        style={{ backgroundColor: b.color }}
                      >
                        {/* the ✓ lands when the Critic pass runs */}
                        {b.label}
                        {t >= VERIFY_AT && " ✓"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* status / training / done */}
        <div className="flex justify-center pt-1 sm:pt-3">
          <div className="flex h-10 min-w-0 items-center gap-3 rounded-full border bg-card px-5 shadow-xl">
            {done ? (
              <>
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-400">
                  <Check className="size-3 text-zinc-950" />
                </span>
                <p className="truncate text-xs font-medium text-emerald-400">{status}</p>
                <span className="hidden shrink-0 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] text-emerald-400 sm:block">
                  0 human labels
                </span>
              </>
            ) : (
              <>
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    training ? "bg-primary" : "animate-pulse bg-muted-foreground",
                  )}
                />
                <p className="truncate text-xs text-muted-foreground">{status}</p>
                {training && (
                  <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-white/10 sm:w-32">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${progress * 100}%` }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
