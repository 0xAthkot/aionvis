"use client";

import {
  Boxes,
  ChevronRight,
  Eye,
  ImageIcon,
  MessageSquareText,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface AgentSpec {
  icon: LucideIcon;
  name: string;
  tech: string;
  /** Hover tooltip on the tech line — e.g. the full architecture list. */
  techTip?: string[];
  blurb: string;
  status: string;
}

const AGENTS: AgentSpec[] = [
  {
    icon: MessageSquareText,
    name: "Prompt Agent",
    tech: "Gemma · vLLM",
    blurb: "“My drone needs to detect rotten potatoes” becomes hundreds of deployment-matched, domain-randomized scenes.",
    status: "Designing scenes…",
  },
  {
    icon: ImageIcon,
    name: "Synthesis Agent",
    tech: "SDXL / FLUX · diffusers",
    blurb: "Renders each scenario into photorealistic training imagery.",
    status: "Rendering images…",
  },
  {
    icon: Eye,
    name: "Vision Agent",
    tech: "SAM 3 · open vocabulary",
    blurb: "Segments and labels every object — any noun works, no fixed classes.",
    status: "Segmenting objects…",
  },
  {
    icon: ShieldCheck,
    name: "Critic Agent",
    tech: "Gemma VLM · geometric self-check",
    blurb: "Re-derives every box, rejects bad labels, VLM-verifies the semantics.",
    status: "Verifying labels…",
  },
  {
    icon: Boxes,
    name: "MLOps Agent",
    tech: "22 architectures · PyTorch on ROCm",
    techTip: [
      "YOLOv10 / YOLO11 / YOLO26 — n·s·m·l·x each",
      "RT-DETR — L / X",
      "RF-DETR — nano · small · medium · base · large",
      "Exports: .pt · ONNX · TorchScript · OpenVINO",
    ],
    blurb: "Trains, streams live metrics, writes its own model card, exports weights.",
    status: "Training epoch 42/60…",
  },
];

function AgentCard({
  agent,
  active,
  statusDelayMs = 0,
  className,
}: {
  agent: AgentSpec;
  active: boolean;
  statusDelayMs?: number;
  className?: string;
}) {
  const Icon = agent.icon;
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 transition-all duration-500",
        active
          ? "border-primary/60 shadow-[0_0_24px_-6px] shadow-primary/40"
          : "border-border",
        className,
      )}
    >
      <div
        className={cn(
          "mb-3 flex size-9 items-center justify-center rounded-lg transition-colors duration-500",
          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4.5" />
      </div>
      <p className="text-sm font-semibold">{agent.name}</p>
      {agent.techTip ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="mb-2 w-fit cursor-help font-mono text-[11px] text-primary/90 underline decoration-dotted underline-offset-2">
              {agent.tech}
            </p>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">
            {agent.techTip.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </TooltipContent>
        </Tooltip>
      ) : (
        <p className="mb-2 font-mono text-[11px] text-primary/90">{agent.tech}</p>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">{agent.blurb}</p>
      <p
        className={cn(
          "mt-3 flex items-center gap-1.5 font-mono text-[11px] transition-opacity duration-500",
          active ? "opacity-100" : "opacity-0",
        )}
      >
        <span
          className="size-1.5 animate-pulse rounded-full bg-emerald-400 motion-reduce:animate-none"
          style={{ animationDelay: `${statusDelayMs}ms` }}
        />
        <span className="text-emerald-400">{agent.status}</span>
      </p>
    </div>
  );
}

/** Animated dashed flow edge (CSS only; still under motion-reduce). */
function FlowEdge({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "h-0.5 w-8 shrink-0 animate-flow rounded-full",
        "bg-[repeating-linear-gradient(90deg,var(--primary)_0_5px,transparent_5px_12px)]",
        "motion-reduce:animate-none",
        className,
      )}
    />
  );
}

/** Mode A — today's linear chain: one agent active at a time. */
function SequentialPipeline() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setActive((a) => (a + 1) % AGENTS.length),
      2200,
    );
    return () => clearInterval(id);
  }, []);

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-stretch">
      {AGENTS.map((agent, i) => (
        // Fragment key spans the card + its connector arrow.
        <div key={agent.name} className="contents">
          <AgentCard agent={agent} active={i === active} />
          {i < AGENTS.length - 1 && (
            <div className="hidden items-center justify-center lg:flex">
              <ChevronRight
                className={cn(
                  "size-4 transition-colors duration-500",
                  i === active ? "text-primary" : "text-muted-foreground/40",
                )}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Mode B — the MI300X pitch: after the Prompt Agent hands off, Synthesis,
 * Vision and Critic work as concurrent peers (bounded streams between
 * them), joining into the trainer only once every label is verified.
 */
function ParallelPipeline() {
  const [prompt, synthesis, vision, critic, mlops] = AGENTS;
  const peers = [synthesis, vision, critic];

  return (
    <div className="space-y-6">
      <div className="grid items-center gap-3 lg:grid-cols-[1fr_auto_1.15fr_auto_1fr]">
        <AgentCard agent={prompt} active={false} className="self-center" />

        <div className="hidden items-center lg:flex">
          <FlowEdge />
        </div>

        <div className="flex flex-col gap-3">
          {peers.map((agent, i) => (
            <AgentCard
              key={agent.name}
              agent={agent}
              active
              statusDelayMs={i * 400}
            />
          ))}
        </div>

        {/* Join: the three streams drain into one trainer. */}
        <div className="hidden items-center lg:flex">
          <FlowEdge />
        </div>

        <div className="self-center">
          <AgentCard agent={mlops} active={false} />
          <p className="mt-2 text-center text-xs text-muted-foreground">
            trains once every label is verified
          </p>
        </div>
      </div>
      <p className="text-center font-mono text-xs text-primary/90">
        192 GB HBM3 holds the entire swarm resident — Gemma 4, FLUX.2,
        SAM 3 — at once.
      </p>
    </div>
  );
}

const MODES = [
  { id: "sequential" as const, label: "Any GPU — agents take turns" },
  { id: "parallel" as const, label: "One MI300X — the swarm works in parallel" },
];

export function AgentPipeline() {
  const [mode, setMode] = useState<"sequential" | "parallel">("parallel");
  const seqRef = useRef<HTMLDivElement>(null);
  const parRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  // The wrapper animates to the ACTIVE mode's height (the inactive mode is
  // absolutely positioned, so it contributes none) — no dead space below
  // the shorter mode, and the resize glides instead of snapping.
  useEffect(() => {
    const el = mode === "sequential" ? seqRef.current : parRef.current;
    if (!el) return;
    const update = () => setHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  return (
    <div className="space-y-8">
      <div
        role="tablist"
        aria-label="Pipeline execution mode"
        className="mx-auto flex w-fit rounded-lg border bg-card p-1"
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm",
              mode === m.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      {/* Both modes stay mounted and cross-fade while the wrapper's height
          glides to the active mode's — the inactive mode sits absolute, so
          the shorter mode leaves no dead space below. */}
      <div
        className="relative overflow-hidden transition-[height] duration-300 motion-reduce:transition-none"
        style={{ height }}
      >
        <div
          ref={seqRef}
          aria-hidden={mode !== "sequential"}
          className={cn(
            "transition-opacity duration-300 motion-reduce:transition-none",
            mode === "sequential"
              ? "opacity-100"
              : "pointer-events-none absolute inset-x-0 top-0 opacity-0",
          )}
        >
          <SequentialPipeline />
        </div>
        <div
          ref={parRef}
          aria-hidden={mode !== "parallel"}
          className={cn(
            "transition-opacity duration-300 motion-reduce:transition-none",
            mode === "parallel"
              ? "opacity-100"
              : "pointer-events-none absolute inset-x-0 top-0 opacity-0",
          )}
        >
          <ParallelPipeline />
        </div>
      </div>
    </div>
  );
}
