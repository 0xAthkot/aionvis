"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Flag, Sparkles } from "lucide-react";
import { useState } from "react";
import { LaunchSummary } from "@/components/foundry/launch-summary";
import { SimpleFoundry } from "@/components/foundry/simple-foundry";
import { PageHeader } from "@/components/layout/page-header";
import { HelpTip } from "@/components/shared/help-tip";
import { NewProjectDialog } from "@/components/shared/new-project-dialog";
import { TagInput } from "@/components/shared/tag-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { api, apiPost } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { useUiModeStore } from "@/lib/stores/ui-mode";
import { useReportUnsaved } from "@/lib/stores/unsaved";
import {
  ARCH_FAMILIES,
  RECOMMENDED_ARCH,
  supportsTask,
  TASKS,
} from "@/lib/architectures";
import type {
  CreateSyntheticRunRequest,
  ExpandPromptRequest,
  ExpandPromptResponse,
  FoundryFeedback,
  Project,
  TrainingConfig,
  TrainingTask,
  VisionBackend,
} from "@/lib/api/types";

function PercentSlider({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-sm text-muted-foreground">
          {Math.round(value * 100)}%
        </span>
      </div>
      <Slider
        id={id}
        value={[value * 100]}
        onValueChange={([v]) => onChange(v / 100)}
        min={0}
        max={100}
        step={5}
      />
    </div>
  );
}

export default function FoundryPage() {
  const mode = useUiModeStore((s) => s.mode);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>(endpoints.projects.list()),
  });

  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const [targetClasses, setTargetClasses] = useState<string[]>([]);
  const [useCase, setUseCase] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("blurry, watermark, text");
  // The generator is the user's explicit choice, honored verbatim — a node
  // that can't run FLUX rejects the run at launch (400), no silent fallback.
  const [generator, setGenerator] = useState<"sdxl" | "flux">("flux");
  // Same doctrine for the labeler: the selection is used or the run is
  // rejected with the node's setup hint — never silently substituted.
  const [visionBackend, setVisionBackend] = useState<VisionBackend>("sam3");

  const [lightingVariation, setLightingVariation] = useState(0.6);
  const [cameraAngleVariation, setCameraAngleVariation] = useState(0.4);
  const [backgroundDiversity, setBackgroundDiversity] = useState(0.5);
  const [occlusionRate, setOcclusionRate] = useState(0.2);
  const [imageCount, setImageCount] = useState(500);
  const [guidanceScale, setGuidanceScale] = useState(7.5);

  const [training, setTraining] = useState<TrainingConfig>({
    architecture: RECOMMENDED_ARCH,
    task: "detect",
    epochs: 60,
    imageSize: 640,
    batchSize: 32,
    device: "mi300x-0",
  });

  function selectTask(task: TrainingTask) {
    setTraining((t) => ({
      ...t,
      task,
      // YOLOv10/RT-DETR have no segment/obb/pose heads — swap to the default.
      architecture: supportsTask(t.architecture, task)
        ? t.architecture
        : RECOMMENDED_ARCH,
    }));
  }

  function selectProject(id: string) {
    setProjectId(id);
    const project = projects?.find((p) => p.id === id);
    if (project) {
      if (targetClasses.length === 0) setTargetClasses(project.targetClasses);
      if (!name)
        setName(
          `${project.name.toLowerCase().replace(/\s+/g, "-")} · synthetic`,
        );
    }
  }

  const randomization = {
    lightingVariation,
    cameraAngleVariation,
    backgroundDiversity,
    occlusionRate,
    scenarioCount: imageCount,
    imageCount,
    guidanceScale,
  };

  const request: CreateSyntheticRunRequest = {
    projectId,
    name,
    targetClasses,
    source: {
      path: "synthetic",
      useCase,
      negativePrompt: negativePrompt || undefined,
      generator,
      randomization,
    },
    training,
    visionBackend,
  };

  const isValid =
    !!projectId &&
    name.trim().length > 2 &&
    targetClasses.length > 0 &&
    useCase.trim().length > 15;

  // Slider tweaks are one flick to redo; typed text is the progress worth
  // guarding when a mode switch would unmount the wizard.
  useReportUnsaved(
    "pro-foundry",
    useCase.trim().length > 0 ||
      name.trim().length > 0 ||
      targetClasses.length > 0,
  );

  const expansion = useMutation({
    mutationFn: (body: ExpandPromptRequest) =>
      apiPost<ExpandPromptResponse>(endpoints.foundry.expandPrompt(), body),
  });

  const { data: feedback } = useQuery({
    queryKey: ["feedback", projectId],
    queryFn: () => api<FoundryFeedback[]>(endpoints.projects.feedback(projectId)),
    enabled: !!projectId,
  });
  const pendingFeedback = feedback?.filter((f) => !f.consumedByRunId) ?? [];

  if (mode === "simple") {
    return (
      <main className="page-enter mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
        <header className="space-y-1 text-center">
          <h1 className="flex items-center justify-center gap-2 text-2xl font-semibold tracking-tight">
            Synthetic Foundry
            <HelpTip>
              The Foundry is where models are built: say what your model is
              for, and the AI agents design the scenes, create the photos,
              label them and train the model — no annotation, no prompt
              engineering.
            </HelpTip>
          </h1>
          <p className="text-sm text-muted-foreground">
            One sentence in, deployable model out.
          </p>
        </header>
        <SimpleFoundry />
      </main>
    );
  }

  return (
    <main className="page-enter mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Synthetic Foundry"
        description="Path A — describe the objects once; the agent swarm generates, labels, verifies and trains without further input."
      />

      <div className="grid items-start gap-8 lg:grid-cols-[1fr_320px]">
        <div className="divide-y divide-border/70">
          <section className="space-y-5 py-8 first:pt-0">
            <div className="space-y-1">
              <h2 className="text-base font-semibold tracking-tight">
                1 · Project &amp; objective
              </h2>
              <p className="text-sm text-muted-foreground">
                What should the final model detect?
              </p>
            </div>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Project</Label>
                  <div className="flex gap-2">
                    <Select value={projectId} onValueChange={selectProject}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select a project" />
                      </SelectTrigger>
                      <SelectContent>
                        {projects?.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <NewProjectDialog onCreated={(p) => selectProject(p.id)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="run-name">Run name</Label>
                  <Input
                    id="run-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="pcb-defects · synthetic v3"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="classes">Target classes (YOLO)</Label>
                <TagInput
                  id="classes"
                  value={targetClasses}
                  onChange={setTargetClasses}
                />
              </div>
            </div>
          </section>

          <section className="space-y-5 py-8">
            <div className="space-y-1">
              <h2 className="text-base font-semibold tracking-tight">
                2 · Use case
              </h2>
              <p className="text-sm text-muted-foreground">
                Say what the model is for — the Prompt Agent infers the
                deployment viewpoint and environment, then designs{" "}
                {imageCount.toLocaleString()} domain-randomized scenes itself.
              </p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="use-case">What is this model for?</Label>
                <Textarea
                  id="use-case"
                  rows={3}
                  value={useCase}
                  onChange={(e) => setUseCase(e.target.value)}
                  placeholder="Our assembly-line AOI camera needs to catch solder bridges and missing components on PCBs"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="negative-prompt">Negative prompt</Label>
                  <Input
                    id="negative-prompt"
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Image generator</Label>
                  <Select
                    value={generator}
                    onValueChange={(v) => setGenerator(v as "sdxl" | "flux")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="flux">
                        FLUX.2 klein — big-VRAM nodes
                      </SelectItem>
                      <SelectItem value="sdxl">
                        SDXL — any GPU
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Honored verbatim — nodes that can&apos;t run the chosen
                    engine reject the run instead of substituting.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Labeler (vision agent)</Label>
                  <Select
                    value={visionBackend}
                    onValueChange={(v) => setVisionBackend(v as VisionBackend)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sam3">
                        SAM 3 — Meta concept segmentation, highest quality
                      </SelectItem>
                      <SelectItem value="yoloe">
                        YOLOE — open-vocab, runs anywhere
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Also honored verbatim — a node without the selected
                    labeler&apos;s runtime rejects the run with setup steps.
                  </p>
                </div>
              </div>

              {pendingFeedback.length > 0 && (
                <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
                  <div className="flex items-center gap-2">
                    <Flag className="size-4 text-amber-500" />
                    <p className="text-sm font-medium">
                      Active learning · {pendingFeedback.length} flagged hard{" "}
                      {pendingFeedback.length === 1 ? "case" : "cases"} pending
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Failures flagged in the inference playground. The Prompt
                    Agent will dedicate scenarios to each of them in this run.
                  </p>
                  <div className="space-y-1.5">
                    {pendingFeedback.map((f) => (
                      <p
                        key={f.id}
                        className="border-l-2 border-amber-500/50 pl-2 text-xs text-muted-foreground"
                      >
                        {f.note}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-primary" />
                    <p className="text-sm font-medium">Prompt Agent preview</p>
                    <Badge variant="outline">Gemma 4 · vLLM</Badge>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={useCase.trim().length < 16 || expansion.isPending}
                    onClick={() =>
                      expansion.mutate({
                        useCase,
                        targetClasses,
                        randomization,
                        previewCount: 8,
                        projectId: projectId || undefined,
                      })
                    }
                  >
                    {expansion.isPending ? "Designing…" : "Preview scenes"}
                  </Button>
                </div>
                {expansion.isPending ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Prompt Agent is reasoning about domain randomization…
                    </p>
                    {Array.from({ length: 4 }, (_, i) => (
                      <Skeleton key={i} className="h-4 w-full" />
                    ))}
                  </div>
                ) : expansion.data ? (
                  <div className="space-y-1.5">
                    {expansion.data.scenarios.map((s, i) => (
                      <p
                        key={i}
                        className="border-l-2 border-primary/40 pl-2 font-mono text-xs text-muted-foreground"
                      >
                        {s}
                      </p>
                    ))}
                    <p className="pt-1 text-xs text-muted-foreground">
                      Preview of {expansion.data.scenarios.length} /{" "}
                      {expansion.data.totalScenarios.toLocaleString()} scenarios
                      the full run will generate.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Say what the model is for above, then preview the scenes
                    the Prompt Agent designs for that deployment.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-5 py-8">
            <div className="space-y-1">
              <h2 className="text-base font-semibold tracking-tight">
                3 · Domain randomization
              </h2>
              <p className="text-sm text-muted-foreground">
                Higher variation → more robust models, harder synthesis.
              </p>
            </div>
            <div className="space-y-5">
              <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                <PercentSlider
                  id="lighting"
                  label="Lighting variation"
                  value={lightingVariation}
                  onChange={setLightingVariation}
                />
                <PercentSlider
                  id="angles"
                  label="Camera angle variation"
                  value={cameraAngleVariation}
                  onChange={setCameraAngleVariation}
                />
                <PercentSlider
                  id="backgrounds"
                  label="Background diversity"
                  value={backgroundDiversity}
                  onChange={setBackgroundDiversity}
                />
                <PercentSlider
                  id="occlusion"
                  label="Occlusion rate"
                  value={occlusionRate}
                  onChange={setOcclusionRate}
                />
              </div>
              <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label htmlFor="image-count">Images to generate</Label>
                    <span className="text-sm text-muted-foreground">
                      {imageCount.toLocaleString()}
                    </span>
                  </div>
                  <Slider
                    id="image-count"
                    value={[imageCount]}
                    onValueChange={([v]) => setImageCount(v)}
                    min={100}
                    max={1000}
                    step={50}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label htmlFor="guidance">Guidance scale</Label>
                    <span className="text-sm text-muted-foreground">
                      {guidanceScale.toFixed(1)}
                    </span>
                  </div>
                  <Slider
                    id="guidance"
                    value={[guidanceScale]}
                    onValueChange={([v]) => setGuidanceScale(v)}
                    min={4}
                    max={12}
                    step={0.5}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-5 py-8 last:pb-0">
            <div className="space-y-1">
              <h2 className="text-base font-semibold tracking-tight">
                4 · Training
              </h2>
              <p className="text-sm text-muted-foreground">
                The MLOps Agent triggers this after the Critic signs off the
                dataset.
              </p>
            </div>
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Task</Label>
                <Select
                  value={training.task ?? "detect"}
                  onValueChange={(v) => selectTask(v as TrainingTask)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASKS.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                        <span className="text-muted-foreground"> · {t.hint}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Architecture</Label>
                <Select
                  value={training.architecture}
                  onValueChange={(v) =>
                    setTraining({
                      ...training,
                      architecture: v as TrainingConfig["architecture"],
                    })
                  }
                >
                  <SelectTrigger>
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
                            disabled={!supportsTask(arch, training.task ?? "detect")}
                          >
                            {arch.toUpperCase()}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label htmlFor="epochs">Epochs</Label>
                  <span className="text-sm text-muted-foreground">
                    {training.epochs}
                  </span>
                </div>
                <Slider
                  id="epochs"
                  value={[training.epochs]}
                  onValueChange={([v]) => setTraining({ ...training, epochs: v })}
                  min={10}
                  max={150}
                  step={5}
                />
              </div>
              <div className="space-y-2">
                <Label>Image size</Label>
                <Select
                  value={String(training.imageSize)}
                  onValueChange={(v) =>
                    setTraining({ ...training, imageSize: Number(v) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[480, 640, 960].map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {s} px
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Batch size</Label>
                <Select
                  value={String(training.batchSize)}
                  onValueChange={(v) =>
                    setTraining({ ...training, batchSize: Number(v) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[16, 32, 64].map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>
        </div>

        <div className="lg:sticky lg:top-20">
          <LaunchSummary
            request={request}
            isValid={isValid}
            validationHint="Pick a project, add target classes and say what the model is for (≥ 16 chars)."
          />
        </div>
      </div>
    </main>
  );
}
