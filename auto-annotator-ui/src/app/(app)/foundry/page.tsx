"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Flag, Sparkles } from "lucide-react";
import { useState } from "react";
import { LaunchSummary } from "@/components/foundry/launch-summary";
import { SimpleFoundry } from "@/components/foundry/simple-foundry";
import { TagInput } from "@/components/shared/tag-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { api, apiPost } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { useUiModeStore } from "@/lib/stores/ui-mode";
import type {
  CreateSyntheticRunRequest,
  ExpandPromptRequest,
  ExpandPromptResponse,
  FoundryFeedback,
  Project,
  TrainingConfig,
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
  const [basePrompt, setBasePrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("blurry, watermark, text");
  const [generator, setGenerator] = useState<"sdxl" | "flux">("sdxl");

  const [lightingVariation, setLightingVariation] = useState(0.6);
  const [cameraAngleVariation, setCameraAngleVariation] = useState(0.4);
  const [backgroundDiversity, setBackgroundDiversity] = useState(0.5);
  const [occlusionRate, setOcclusionRate] = useState(0.2);
  const [imageCount, setImageCount] = useState(500);
  const [guidanceScale, setGuidanceScale] = useState(7.5);

  const [training, setTraining] = useState<TrainingConfig>({
    architecture: "yolov10m",
    epochs: 60,
    imageSize: 640,
    batchSize: 32,
    device: "mi300x-0",
  });

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
      basePrompt,
      negativePrompt: negativePrompt || undefined,
      generator,
      randomization,
    },
    training,
  };

  const isValid =
    !!projectId &&
    name.trim().length > 2 &&
    targetClasses.length > 0 &&
    basePrompt.trim().length > 15;

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
      <main className="flex flex-1 flex-col gap-6 p-6">
        <header className="space-y-1 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            Build a detection model
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
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          Synthetic Foundry
        </h1>
        <p className="text-sm text-muted-foreground">
          Path A — describe the objects once; the agent swarm generates,
          labels, verifies and trains without further input.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1 · Project &amp; objective</CardTitle>
              <CardDescription>
                What should the final model detect?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Project</Label>
                  <Select value={projectId} onValueChange={selectProject}>
                    <SelectTrigger>
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2 · Base prompt</CardTitle>
              <CardDescription>
                The Prompt Agent expands this into {imageCount.toLocaleString()}{" "}
                domain-randomized scenarios before synthesis.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="base-prompt">Scene description</Label>
                <Textarea
                  id="base-prompt"
                  rows={3}
                  value={basePrompt}
                  onChange={(e) => setBasePrompt(e.target.value)}
                  placeholder="Top-down macro photo of a green printed circuit board on an assembly line with visible solder defects"
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
                      <SelectItem value="sdxl">SDXL (diffusers)</SelectItem>
                      <SelectItem value="flux">Flux (diffusers)</SelectItem>
                    </SelectContent>
                  </Select>
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
                    <Badge variant="outline">Gemma 4 · Fireworks AI</Badge>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={basePrompt.trim().length < 16 || expansion.isPending}
                    onClick={() =>
                      expansion.mutate({
                        basePrompt,
                        targetClasses,
                        randomization,
                        previewCount: 8,
                        projectId: projectId || undefined,
                      })
                    }
                  >
                    {expansion.isPending ? "Expanding…" : "Preview expansion"}
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
                    Write a scene description, then preview how the Prompt
                    Agent diversifies it.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3 · Domain randomization</CardTitle>
              <CardDescription>
                Higher variation → more robust models, harder synthesis.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>4 · Training</CardTitle>
              <CardDescription>
                The MLOps Agent triggers this after the Critic signs off the
                dataset.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
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
                    {(["yolov10n", "yolov10s", "yolov10m", "yolov10l", "yolov10x"] as const).map(
                      (arch) => (
                        <SelectItem key={arch} value={arch}>
                          {arch.toUpperCase()}
                        </SelectItem>
                      ),
                    )}
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
            </CardContent>
          </Card>
        </div>

        <LaunchSummary
          request={request}
          isValid={isValid}
          validationHint="Pick a project, add target classes and write a scene description (≥ 16 chars)."
        />
      </div>
    </main>
  );
}
