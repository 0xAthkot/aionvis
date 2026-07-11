"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * One FAQ entry with an animated expand/collapse. A native <details> can't
 * animate its close, so this is a button + a grid whose row track eases
 * between 0fr and 1fr - the standard height-auto animation trick.
 */
export function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-white/10 bg-card/40 px-5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-4 py-4 text-left text-sm font-medium"
      >
        {q}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-300",
            open && "rotate-180",
          )}
        />
      </button>
      <div
        aria-hidden={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <p
            className={cn(
              "pb-5 text-sm leading-relaxed text-muted-foreground transition-opacity duration-300",
              open ? "opacity-100" : "opacity-0",
            )}
          >
            {a}
          </p>
        </div>
      </div>
    </div>
  );
}
