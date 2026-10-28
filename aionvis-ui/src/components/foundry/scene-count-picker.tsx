"use client";

import { HelpTip } from "@/components/shared/help-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * How many distinct scenes the Prompt Agent designs
 * (DomainRandomizationConfig.scenarioCount). value null = one per image
 * (the default); a number = a custom count, clamped to 1..images.
 */
export function SceneCountPicker({
  id,
  label,
  images,
  value,
  onChange,
}: {
  id: string;
  label: string;
  images: number;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const custom = value !== null;
  const options = [
    { custom: false, label: "One per image" },
    { custom: true, label: "Custom" },
  ];

  return (
    <div className="space-y-2">
      <Label htmlFor={custom ? id : undefined} className="gap-1.5">
        {label}
        <HelpTip>
          Images cycle through the scenes. Fewer scenes means repeated setups
          with different random details.
        </HelpTip>
      </Label>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() =>
              onChange(
                o.custom
                  ? (value ?? Math.max(1, Math.round(images / 10)))
                  : null,
              )
            }
            className={cn(
              "rounded-lg border px-3 py-2 text-left text-sm transition-all duration-200",
              custom === o.custom
                ? "border-primary bg-primary/10 font-medium shadow-sm shadow-primary/20"
                : "hover:border-muted-foreground/40 hover:bg-accent/40",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {custom ? (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            min={1}
            max={images}
            className="w-32"
            value={value || ""}
            onChange={(e) => {
              const v = Math.round(Number(e.target.value));
              onChange(Number.isFinite(v) && v > 0 ? Math.min(v, images) : 0);
            }}
            onBlur={() => {
              if (!value || value < 1) onChange(1);
            }}
          />
          <span className="text-xs text-muted-foreground">
            of {images.toLocaleString()} images · about{" "}
            {Math.round(images / Math.max(value || 1, 1)).toLocaleString()} per
            scene
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {images.toLocaleString()} scenes, every image its own.
        </p>
      )}
    </div>
  );
}
