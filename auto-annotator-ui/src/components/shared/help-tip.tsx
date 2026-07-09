"use client";

import { CircleHelp } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUiModeStore } from "@/lib/stores/ui-mode";
import { cn } from "@/lib/utils";

/**
 * Simple-mode hover help: a small "?" that explains a technical name or
 * concept in plain language. Renders nothing in Pro mode — experts don't
 * need the glossary, and the chrome stays clean.
 */
export function HelpTip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const simple = useUiModeStore((s) => s.mode) === "simple";
  if (!simple) return null;

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="What is this?"
          className={cn(
            "inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground",
            className,
          )}
        >
          <CircleHelp className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-pretty">{children}</TooltipContent>
    </Tooltip>
  );
}
