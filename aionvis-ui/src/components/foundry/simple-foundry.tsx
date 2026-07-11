"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Flag, Images, Rocket, Sparkles } from "lucide-react";
import { useState } from "react";
import { DeleteProjectDialog } from "@/components/shared/delete-project-dialog";
import { HelpTip } from "@/components/shared/help-tip";
import { NewProjectDialog } from "@/components/shared/new-project-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api, apiPost } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  CostEstimate,
  CreateSyntheticRunRequest,
  ExpandPromptResponse,
  FoundryFeedback,
  PreviewImagesResponse,
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
import type { Architecture, TrainingTask, VisionBackend } from "@/lib/api/types";
import { useReportUnsaved } from "@/lib/stores/unsaved";
import { cn } from "@/lib/utils";

/** Everything the Pro wizard exposes as knobs, chosen for the user. */
const SIZES = [
  { id: "test", label: "Test", images: 50, epochs: 30 },
  { id: "small", label: "Small", images: 250, epochs: 45 },
  { id: "medium", label: "Medium", images: 1000, epochs: 60 },
  { id: "large", label: "Large", images: 5000, epochs: 100 },
] as const;
type SizeId = (typeof SIZES)[number]["id"];

/** The generator is the user's explicit choice — the backend honors it
 * verbatim (a node that can't run FLUX rejects the run, no fallback). */
const GENERATORS = [
  {
    id: "flux" as const,
    label: "FLUX",
    hint: "Sharpest scenes — needs a datacenter GPU (MI300X)",
  },
  {
    id: "sdxl" as const,
    label: "SDXL",
    hint: "Runs on any GPU",
  },
] as const;

/** Same doctrine for the labeler — used verbatim or the run is declined. */
const LABELERS = [
  {
    id: "sam3" as const,
    label: "SAM 3",
    hint: "Meta's concept labeler — most accurate outlines",
  },
  {
    id: "yoloe" as const,
    label: "YOLOE",
    hint: "Runs on any GPU",
  },
];

export function SimpleFoundry() {
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>(endpoints.projects.list()),
  });

  const [projectId, setProjectId] = useState("");
  const [useCase, setUseCase] = useState("");
  const [size, setSize] = useState<SizeId>("medium");
  const [generator, setGenerator] = useState<"sdxl" | "flux">("flux");
  const [labeler, setLabeler] = useState<VisionBackend>("sam3");
  const [architecture, setArchitecture] = useState<Architecture>(RECOMMENDED_ARCH);
  const [task, setTask] = useState<TrainingTask>("detect");
  const [showMore, setShowMore] = useState(false);

  function selectTask(next: TrainingTask) {
    setTask(next);
    if (!supportsTask(architecture, next)) setArchitecture(RECOMMENDED_ARCH);
  }

  const project = projects?.find((p) => p.id === projectId);
  const sizeCfg = SIZES.find((s) => s.id === size) ?? SIZES[1];
  const isValid = !!project && useCase.trim().length > 15;
  // Why the launch button is disabled — surfaced as its hover tooltip.
  const blockers = [
    !project && "pick a project",
    useCase.trim().length <= 15 &&
      (useCase.trim().length === 0
        ? "describe what the model is for"
        : `say a bit more about the use case (${useCase.trim().length}/16 characters)`),
  ].filter(Boolean);
  const disabledReason = blockers.length
    ? `To build: ${blockers.join(" and ")}.`
    : null;
  useReportUnsaved("simple-foundry", useCase.trim().length > 0);

  const request: CreateSyntheticRunRequest = {
    projectId,
    name: project
      ? `${project.name.toLowerCase().replace(/\s+/g, "-")} · ${sizeCfg.id}`
      : "",
    targetClasses: project?.targetClasses ?? [],
    source: {
      path: "synthetic",
      useCase,
      negativePrompt: "blurry, watermark, text",
      generator,
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
    visionBackend: labeler,
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
        useCase,
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

  const paint = useMutation({
    mutationFn: () =>
      apiPost<PreviewImagesResponse>(endpoints.foundry.previewImages(), {
        useCase,
        targetClasses: request.targetClasses,
        randomization: request.source.randomization,
        generator,
        count: 3,
      }),
  });

  const launch = useLaunchRun();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            What is your model for?
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Say the job in one sentence — &ldquo;my drone needs to detect
            rotten potatoes&rdquo;. The Prompt Agent works out the scenes,
            then the swarm generates the training data, labels it, checks
            its own work and trains the model. You do nothing else.
          </p>
        </div>
        <div className="space-y-5">
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
              <DeleteProjectDialog
                project={project ?? null}
                onDeleted={() => setProjectId("")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="simple-prompt">The job</Label>
            <Textarea
              id="simple-prompt"
              rows={3}
              value={useCase}
              onChange={(e) => setUseCase(e.target.value)}
              placeholder="My warehouse cameras need to spot forklifts, stacked pallets and workers without safety vests"
            />
            <p className="text-xs text-muted-foreground">
              Describe the deployment, not the picture — the Prompt Agent
              infers the camera viewpoint and environment for you.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="gap-1.5">
              Dataset size
              <HelpTip>
                How many training photos the swarm creates, and how long the
                model studies them (epochs). Bigger = more accurate, slower to
                build.
              </HelpTip>
            </Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SIZES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSize(s.id)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-all duration-200",
                    size === s.id
                      ? "border-primary bg-primary/10 shadow-sm shadow-primary/20"
                      : "hover:border-muted-foreground/40 hover:bg-accent/40",
                  )}
                >
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.images >= 1000 ? `${s.images / 1000}k` : s.images}{" "}
                    images · {s.epochs} epochs
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="gap-1.5">
              Image engine
              <HelpTip>
                The AI that paints your training photos. FLUX produces the
                sharpest scenes but needs a datacenter GPU; SDXL runs on any
                GPU.
              </HelpTip>
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {GENERATORS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGenerator(g.id)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-all duration-200",
                    generator === g.id
                      ? "border-primary bg-primary/10 shadow-sm shadow-primary/20"
                      : "hover:border-muted-foreground/40 hover:bg-accent/40",
                  )}
                >
                  <p className="text-sm font-medium">{g.label}</p>
                  <p className="text-xs text-muted-foreground">{g.hint}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="gap-1.5">
              Labeler
              <HelpTip>
                The AI that draws the boxes and outlines on your training
                photos before your model learns from them. SAM 3 (Meta) is
                the most accurate; YOLOE runs on any GPU.
              </HelpTip>
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {LABELERS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLabeler(l.id)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-all duration-200",
                    labeler === l.id
                      ? "border-primary bg-primary/10 shadow-sm shadow-primary/20"
                      : "hover:border-muted-foreground/40 hover:bg-accent/40",
                  )}
                >
                  <p className="text-sm font-medium">{l.label}</p>
                  <p className="text-xs text-muted-foreground">{l.hint}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="gap-1.5">
              Model output
              <HelpTip>
                What the finished model draws on a photo: plain boxes, exact
                outlines, rotated boxes, body keypoints — or just a label for
                the whole image.
              </HelpTip>
            </Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TASKS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTask(t.id)}
                  className={cn(
                    "rounded-lg border p-2.5 text-left transition-all duration-200",
                    task === t.id
                      ? "border-primary bg-primary/10 shadow-sm shadow-primary/20"
                      : "hover:border-muted-foreground/40 hover:bg-accent/40",
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
                Read what the swarm will paint
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={useCase.trim().length < 16 || expansion.isPending}
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

          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Images className="size-3.5 text-primary" />
                See what the swarm will paint
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={useCase.trim().length < 16 || paint.isPending}
                onClick={() => paint.mutate()}
              >
                {paint.isPending ? "Painting…" : "Paint 3 samples"}
              </Button>
            </div>
            {paint.isPending ? (
              <div className="grid grid-cols-3 gap-2 pt-1">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="aspect-square w-full rounded-md" />
                ))}
              </div>
            ) : paint.isError ? (
              <p className="text-xs text-destructive">{paint.error.message}</p>
            ) : paint.data ? (
              <>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {paint.data.images.map((img) => (
                    <Tooltip key={img.url}>
                      <TooltipTrigger asChild>
                        {/* Data URIs (mock) / remote-node files — next/image
                            adds nothing here. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt={img.scenario ?? img.fileName}
                          className="aspect-square w-full rounded-md border object-cover"
                        />
                      </TooltipTrigger>
                      {img.scenario && (
                        <TooltipContent className="max-w-72">
                          {img.scenario}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Painted by {paint.data.model} — the full build creates{" "}
                  {sizeCfg.images.toLocaleString("en-US")} like these, then
                  labels and verifies them.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Optional — three sample photos painted from your sentence, so
                you can judge the look before you build. Takes a moment on the
                node&apos;s GPU.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="text-sm">
              {!isValid ? (
                <p className="text-xs text-muted-foreground">
                  Pick a project and say what the model is for (a full
                  sentence).
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
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Disabled buttons swallow hover — the span catches it. */}
                <span className="inline-flex">
                  <Button
                    size="lg"
                    className="shadow-md shadow-primary/25"
                    disabled={!isValid || launch.isPending}
                    onClick={() => launch.mutate(request)}
                  >
                    <Rocket className="size-4" />
                    {launch.isPending ? "Queueing…" : "Build my model"}
                  </Button>
                </span>
              </TooltipTrigger>
              {disabledReason && !launch.isPending && (
                <TooltipContent>{disabledReason}</TooltipContent>
              )}
            </Tooltip>
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Need the full control plane — architectures, randomization, epochs?{" "}
        <Badge variant="outline" className="font-normal">
          Switch to Pro in the top bar
        </Badge>
      </p>
    </div>
  );
}
