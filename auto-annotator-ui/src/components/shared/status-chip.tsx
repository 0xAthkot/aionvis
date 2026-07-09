import type { RunStatus } from "@/lib/api/types";
import { SIMPLE_STATUS } from "@/lib/simple-language";
import { cn } from "@/lib/utils";

const RUN_CHIP: Record<
  RunStatus,
  { chip: string; dot: string; pulse?: boolean }
> = {
  running: { chip: "chip-accent", dot: "bg-primary", pulse: true },
  queued: { chip: "chip-neutral", dot: "bg-muted-foreground" },
  paused: { chip: "chip-warning", dot: "bg-amber-400" },
  succeeded: { chip: "chip-success", dot: "bg-emerald-400" },
  failed: { chip: "chip-danger", dot: "bg-red-400" },
  cancelled: { chip: "chip-neutral", dot: "bg-muted-foreground" },
};

/** Tinted status pill with a live dot — one look for run state everywhere. */
export function RunStatusChip({
  status,
  simple = false,
  className,
}: {
  status: RunStatus;
  simple?: boolean;
  className?: string;
}) {
  const s = RUN_CHIP[status];
  return (
    <span className={cn("chip", s.chip, className)}>
      <span
        className={cn(
          "size-1.5 rounded-full",
          s.dot,
          s.pulse && "animate-pulse motion-reduce:animate-none",
        )}
      />
      {simple ? SIMPLE_STATUS[status] : status}
    </span>
  );
}
