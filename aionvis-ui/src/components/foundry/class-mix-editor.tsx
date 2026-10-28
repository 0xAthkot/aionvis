"use client";

import { HelpTip } from "@/components/shared/help-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Scene composition for a multi-class run (DomainRandomizationConfig
 * .classMix + .maxClassesPerScene). The mix sets how often each class is
 * the MAIN subject of a scene; every image is still labeled for all
 * classes. Undefined mix = equal shares.
 */
export function ClassMixEditor({
  classes,
  mix,
  onMix,
  maxPerScene,
  onMaxPerScene,
}: {
  classes: string[];
  mix: Record<string, number> | undefined;
  onMix: (mix: Record<string, number> | undefined) => void;
  maxPerScene: number;
  onMaxPerScene: (n: number) => void;
}) {
  if (classes.length < 2) return null;
  const equal = Math.round(100 / classes.length);
  const weight = (c: string) => (mix ? mix[c] ?? 0 : equal);
  const total = classes.reduce((sum, c) => sum + weight(c), 0) || 1;
  const classic = !mix && classes.length <= maxPerScene;

  function setWeight(cls: string, value: number) {
    const base = mix ?? Object.fromEntries(classes.map((c) => [c, equal]));
    onMix({ ...base, [cls]: Math.max(0, Math.min(100, value)) });
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="gap-1.5">
          Class mix
          <HelpTip>
            How often each class is the main subject of a scene. Every image
            is still labeled for every class, so objects that appear
            alongside the main subject get labels too.
          </HelpTip>
        </Label>
        {mix && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onMix(undefined)}
          >
            Reset to equal
          </Button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {classes.map((cls) => (
          <div key={cls} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={cls}>
              {cls.replace(/_/g, " ")}
            </span>
            <Input
              type="number"
              min={0}
              max={100}
              aria-label={`${cls} share`}
              className="h-8 w-20"
              value={weight(cls)}
              onChange={(e) => setWeight(cls, Math.round(Number(e.target.value) || 0))}
            />
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
              {Math.round((weight(cls) / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label className="gap-1.5 text-xs font-normal text-muted-foreground">
          Objects per scene: up to
          <HelpTip>
            The main subject plus other target classes where they naturally
            belong. With this many classes or fewer and an equal mix, every
            scene shows all of them.
          </HelpTip>
        </Label>
        <Select
          value={String(maxPerScene)}
          onValueChange={(v) => onMaxPerScene(Number(v))}
        >
          <SelectTrigger className="h-8 w-16">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {classic
            ? "Every scene shows all classes."
            : "Each scene features one class, plus others where natural."}
        </span>
      </div>
    </div>
  );
}
