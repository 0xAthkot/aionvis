"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Flag, Rocket, Sparkles } from "lucide-react";
import { useState } from "react";
import { NewProjectDialog } from "@/components/shared/new-project-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, apiPost } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  CostEstimate,
  CreateSyntheticRunRequest,
  ExpandPromptResponse,
  FoundryFeedback,
  Project,
} from "@/lib/api/types";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLaunchRun } from "@/hooks/use-launch-run";
import {
  ARCH_FAMILIES,
  RECOMMENDED_ARCH,
  supportsTask,
  TASKS,
} from "@/lib/architectures";
import type { Architecture, TrainingTask } from "@/lib/api/types";
import { useReportUnsaved } from "@/lib/stores/unsaved";
import { cn } from "@/lib/utils";

/** Everything the Pro wizard exposes as knobs, chosen for the user. */
const SIZES = [
  { id: "small", label: "Small", images: 12, epochs: 30 },
  { id: "medium", label: "Medium", images: 24, epochs: 45 },
  { id: "large", label: "Large", images: 48, epochs: 60 },
] as const;
type SizeId = (typeof SIZES)[number]["id"];

export function SimpleFoundry() {
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>(endpoints.projects.list()),
  });

  const [projectId, setProjectId] = useState("");
  const [basePrompt, setBasePrompt] = useState("");
  const [size, setSize] = useState<SizeId>("medium");
  const [architecture, setArchitecture] = useState<Architecture>(RECOMMENDED_ARCH);
  const [task, setTask] = useState<TrainingTask>("detect");
  const [showMore, setShowMore] = useState(false);

  function selectTask(next: TrainingTask) {
    setTask(next);
    if (!supportsTask(architecture, next)) setArchitecture(RECOMMENDED_ARCH);
  }

  const project = projects?.find((p) => p.id === projectId);
  const sizeCfg = SIZES.find((s) => s.id === size) ?? SIZES[1];
  const isValid = !!project && basePrompt.trim().length > 15;
  useReportUnsaved("simple-foundry", basePrompt.trim().length > 0);

  const request: CreateSyntheticRunRequest = {
    projectId,
    name: project
      ? `${project.name.toLowerCase().replace(/\s+/g, "-")} · ${sizeCfg.id}`
      : "",
    targetClasses: project?.targetClasses ?? [],
    source: {
      path: "synthetic",
      basePrompt,
      negativePrompt: "blurry, watermark, text",
      // FLUX primary; nodes without the VRAM fall back to SDXL server-side.
      generator: "flux",
      randomization: {
        lightingVariation: 0.6,
        cameraAngleVariation: 0.4,
        backgroundDiversity: 0.5,
        occlusionRate: 0.2,
        scenarioCount: sizeCfg.images,
        imageCount: sizeCfg.images,
        guidanceScale: 7.5,
      },
    },
    training: {
      architecture,
      task,
      epochs: sizeCfg.epochs,
      imageSize: 640,
      batchSize: 32,
      device: "mi300x-0",
    },
  };

  const { data: feedback } = useQuery({
    queryKey: ["feedback", projectId],
    queryFn: () => api<FoundryFeedback[]>(endpoints.projects.feedback(projectId)),
    enabled: !!projectId,
  });
  const pendingFeedback = feedback?.filter((f) => !f.consumedByRunId) ?? [];

  const expansion = useMutation({
    mutationFn: () =>
      apiPost<ExpandPromptResponse>(endpoints.foundry.expandPrompt(), {
        basePrompt,
        targetClasses: request.targetClasses,
        randomization: request.source.randomization,
        previewCount: 4,
        projectId: projectId || undefined,
      }),
  });

  const estimateKey = useDebouncedValue(JSON.stringify(request), 500);
  const estimate = useQuery({
    queryKey: ["run-estimate", estimateKey],
    queryFn: () =>
      apiPost<CostEstimate>(endpoints.runs.estimate(), JSON.parse(estimateKey)),
    enabled: isValid,
    placeholderData: (prev) => prev,
  });

  const launch = useLaunchRun();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>What should your model detect?</CardTitle>
          <CardDescription>
            Describe it in one sentence — the agent swarm generates the
            training data, labels it, checks its own work and trains the
            model. You do nothing else.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Project</Label>
            <div className="flex gap-2">
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="w-full flex-1">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      <span className="text-muted-foreground">
                        · {p.targetClasses.join(", ")}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <NewProjectDialog onCreated={(p) => setProjectId(p.id)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="simple-prompt">The scene</Label>
            <Textarea
              id="simple-prompt"
              rows={3}
              value={basePrompt}
              onChange={(e) => setBasePrompt(e.target.value)}
              placeholder="A busy warehouse aisle with a yellow forklift, stacked wooden pallets and workers in safety vests"
            />
          </div>

          <div className="space-y-2">
            <Label>Dataset size</Label>
            <div className="grid grid-cols-3 gap-2">
              {SIZES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSize(s.id)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    size === s.id
                      ? "border-primary bg-primary/10"
                      : "hover:border-muted-foreground/40",
                  )}
                >
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.images} images · {s.epochs} epochs
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Model output</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TASKS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTask(t.id)}
                  className={cn(
                    "rounded-lg border p-2.5 text-left transition-colors",
                    task === t.id
                      ? "border-primary bg-primary/10"
                      : "hover:border-muted-foreground/40",
                  )}
                >
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.hint}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown
                className={cn("size-3.5 transition-transform", showMore && "rotate-180")}
              />
              More options
              {!showMore && architecture !== RECOMMENDED_ARCH && (
                <Badge variant="outline" className="ml-1 font-mono text-[10px] uppercase">
                  {architecture}
                </Badge>
              )}
            </button>
            {showMore && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <Label>Model architecture</Label>
                <Select
                  value={architecture}
                  onValueChange={(v) => setArchitecture(v as Architecture)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ARCH_FAMILIES.map((family) => (
                      <SelectGroup key={family.label}>
                        <SelectLabel>
                          {family.label} · {family.hint}
                        </SelectLabel>
                        {family.archs.map((arch) => (
                          <SelectItem
                            key={arch}
                            value={arch}
                            disabled={!supportsTask(arch, task)}
                          >
                            {arch.toUpperCase()}
                            {arch === RECOMMENDED_ARCH && (
                              <span className="text-muted-foreground"> · recommended</span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The same architectures Pro offers — the recommended one suits
                  most jobs. Everything else (image size, batch, randomization)
                  is tuned automatically.
                </p>
              </div>
            )}
          </div>

          {pendingFeedback.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Flag className="size-3.5 text-amber-500" />
                This run will also target{" "}
                {pendingFeedback.length === 1
                  ? "1 failure"
                  : `${pendingFeedback.length} failures`}{" "}
                you flagged
              </p>
              {pendingFeedback.map((f) => (
                <p
                  key={f.id}
                  className="border-l-2 border-amber-500/50 pl-2 text-xs text-muted-foreground"
                >
                  {f.note}
                </p>
              ))}
            </div>
          )}

          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-3.5 text-primary" />
                See what the swarm will paint
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={basePrompt.trim().length < 16 || expansion.isPending}
                onClick={() => expansion.mutate()}
              >
                {expansion.isPending ? "Thinking…" : "Preview"}
              </Button>
            </div>
            {expansion.isPending ? (
              <div className="space-y-2 pt-1">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            ) : expansion.data ? (
              <div className="space-y-1.5 pt-1">
                {expansion.data.scenarios.map((s, i) => (
                  <p
                    key={i}
                    className="border-l-2 border-primary/40 pl-2 text-xs text-muted-foreground"
                  >
                    {s}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Optional — a sample of the scene variations the AI writes from
                your sentence.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="text-sm">
              {!isValid ? (
                <p className="text-xs text-muted-foreground">
                  Pick a project and describe the scene (a full sentence).
                </p>
              ) : estimate.data ? (
                <p>
                  <span className="font-medium">
                    ~{estimate.data.gpuMinutes} GPU min · $
                    {estimate.data.estimatedUsd.toFixed(2)}
                  </span>{" "}
                  <span className="text-xs text-muted-foreground">
                    quoted before anything runs
                  </span>
                </p>
              ) : (
                <Skeleton className="h-4 w-40" />
              )}
            </div>
            <Button
              size="lg"
              disabled={!isValid || launch.isPending}
              onClick={() => launch.mutate(request)}
            >
              <Rocket className="size-4" />
              {launch.isPending ? "Queueing…" : "Build my model"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Need the full control plane — architectures, randomization, epochs?{" "}
        <Badge variant="outline" className="font-normal">
          Switch to Pro in the top bar
        </Badge>
      </p>
    </div>
  );
}
