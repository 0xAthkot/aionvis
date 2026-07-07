"use client";

import {
  Boxes,
  ChevronRight,
  Eye,
  ImageIcon,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const AGENTS = [
  {
    icon: MessageSquareText,
    name: "Prompt Agent",
    tech: "LLM · Fireworks AI",
    blurb: "One sentence becomes hundreds of domain-randomized scene descriptions.",
    status: "Expanding scenarios…",
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
    tech: "OpenCV geometry + VLM",
    blurb: "Re-derives every box, rejects bad labels, VLM-verifies the semantics.",
    status: "Verifying labels…",
  },
  {
    icon: Boxes,
    name: "MLOps Agent",
    tech: "YOLOv10 · PyTorch on ROCm",
    blurb: "Trains, streams live metrics, writes its own model card, exports weights.",
    status: "Training epoch 42/60…",
  },
];

export function AgentPipeline() {
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
      {AGENTS.map((agent, i) => {
        const Icon = agent.icon;
        const isActive = i === active;
        return (
          // Fragment key spans the card + its connector arrow.
          <div key={agent.name} className="contents">
            <div
              className={cn(
                "rounded-xl border bg-card p-4 transition-all duration-500",
                isActive
                  ? "border-primary/60 shadow-[0_0_24px_-6px] shadow-primary/40"
                  : "border-border",
              )}
            >
              <div
                className={cn(
                  "mb-3 flex size-9 items-center justify-center rounded-lg transition-colors duration-500",
                  isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="size-4.5" />
              </div>
              <p className="text-sm font-semibold">{agent.name}</p>
              <p className="mb-2 font-mono text-[11px] text-primary/90">{agent.tech}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{agent.blurb}</p>
              <p
                className={cn(
                  "mt-3 flex items-center gap-1.5 font-mono text-[11px] transition-opacity duration-500",
                  isActive ? "opacity-100" : "opacity-0",
                )}
              >
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
                <span className="text-emerald-400">{agent.status}</span>
              </p>
            </div>
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
        );
      })}
    </div>
  );
}
