"use client";

import { useQuery } from "@tanstack/react-query";
import { Boxes, Rocket } from "lucide-react";
import { useMemo, useState } from "react";
import { HelpTip } from "@/components/shared/help-tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
import { useLaunchRun } from "@/hooks/use-launch-run";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  Architecture,
  CreateDatasetRunRequest,
  Dataset,
  Paginated,
  Project,
  TrainingTask,
} from "@/lib/api/types";
import {
  ARCH_FAMILIES,
  RECOMMENDED_ARCH,
  SCRATCH_HINT_EXISTING,
  STARTS,
  supportsScratch,
  supportsTask,
  TASKS,
} from "@/lib/architectures";

/** Class-name identity for merges (mirrors the backend's dataset_merge.norm). */
const normClass = (name: string) =>
  name.replace(/_/g, " ").toLowerCase().split(/\s+/).filter(Boolean).join(" ");

/**
 * Path C: train a new model on datasets that already exist, without
 * generating or labeling anything again. One dataset trains in place; two or
 * more merge by class name into a new dataset (training optional, so this is
 * also how datasets are merged).
 */
export function TrainModelDialog({
  initialDatasetIds = [],
  trigger = "Train a model",
}: {
  initialDatasetIds?: string[];
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>(initialDatasetIds);
  const [trainModel, setTrainModel] = useState(true);
  const [architecture, setArchitecture] = useState<Architecture>(RECOMMENDED_ARCH);
  const [task, setTask] = useState<TrainingTask>("detect");
  const [pretrained, setPretrained] = useState(true);
  const [epochs, setEpochs] = useState(60);
  const [imageSize, setImageSize] = useState(640);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>(endpoints.projects.list()),
    enabled: open,
  });
  const { data: datasetPage } = useQuery({
    queryKey: ["datasets", "trainable"],
    queryFn: () =>
      api<Paginated<Dataset>>(`${endpoints.datasets.list()}?page=1&pageSize=500`),
    enabled: open,
  });
  const trainable = useMemo(
    () =>
      (datasetPage?.items ?? []).filter(
        (d) => d.status === "ready" && d.labeledCount > 0,
      ),
    [datasetPage],
  );
  const chosen = trainable.filter((d) => selected.includes(d.id));
  const classes = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const d of chosen)
      for (const c of [...d.classes].sort((a, b) => a.id - b.id))
        if (!seen.has(normClass(c.name))) {
          seen.add(normClass(c.name));
          out.push(c.name);
        }
    return out;
  }, [chosen]);
  const images = chosen.reduce((n, d) => n + d.labeledCount, 0);

  const launch = useLaunchRun();
  const merging = chosen.length > 1;
  const runName =
    name.trim() ||
    (chosen.length === 1
      ? `${chosen[0].name} · ${architecture}${pretrained ? "" : " scratch"}`
      : merging
        ? `merge of ${chosen.length} datasets${trainModel ? ` · ${architecture}` : ""}`
        : "");

  const request: CreateDatasetRunRequest = {
    projectId,
    name: runName,
    source: { path: "dataset", datasetIds: chosen.map((d) => d.id) },
    training: {
      architecture,
      task,
      epochs,
      imageSize,
      batchSize: 32,
      device: "mi300x-0",
      pretrained,
    },
    trainModel,
  };

  const blocker = !projectId
    ? "Pick a project."
    : chosen.length === 0
      ? "Pick at least one labeled dataset."
      : !trainModel && chosen.length < 2
        ? "With training off, pick two or more datasets to merge."
        : null;

  function toggle(id: string, on: boolean) {
    setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)));
  }

  function selectArchitecture(next: Architecture) {
    setArchitecture(next);
    if (!supportsScratch(next)) setPretrained(true);
  }

  function selectTask(next: TrainingTask) {
    setTask(next);
    if (!supportsTask(architecture, next)) selectArchitecture(RECOMMENDED_ARCH);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Boxes className="size-3.5" />
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Train a model on existing datasets</DialogTitle>
          <DialogDescription>
            Nothing is generated or labeled again: the MLOps Agent trains on
            the labels you already have. Pick one dataset, or several to merge
            them by class name into a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="w-full">
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
              <Label htmlFor="train-run-name">Run name</Label>
              <Input
                id="train-run-name"
                value={name}
                placeholder={runName || "named after the dataset"}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Datasets</Label>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
              {trainable.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">
                  No labeled datasets yet. Build one in the Foundry first.
                </p>
              ) : (
                trainable.map((d) => (
                  <label
                    key={d.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-accent/40"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={selected.includes(d.id)}
                      onCheckedChange={(v) => toggle(d.id, v === true)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs">{d.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {d.labeledCount.toLocaleString()} labeled ·{" "}
                        {d.classes.map((c) => c.name).join(", ")}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
            {chosen.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {images.toLocaleString()} labeled images · {classes.length}{" "}
                {classes.length === 1 ? "class" : "classes"}
                {merging && " (merged by name)"}: {classes.join(", ")}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="train-dialog-train"
              checked={trainModel}
              onCheckedChange={setTrainModel}
            />
            <Label htmlFor="train-dialog-train" className="gap-1.5">
              Train a model
              <HelpTip>
                Off: only merge the selected datasets into one new dataset
                (needs two or more). Useful to export everything as a single
                download.
              </HelpTip>
            </Label>
          </div>

          <fieldset
            disabled={!trainModel}
            className="grid gap-4 disabled:opacity-50 sm:grid-cols-2"
          >
            <div className="space-y-2">
              <Label>Model output</Label>
              <Select value={task} onValueChange={(v) => selectTask(v as TrainingTask)}>
                <SelectTrigger className="w-full">
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
                value={architecture}
                onValueChange={(v) => selectArchitecture(v as Architecture)}
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
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="gap-1.5">
                Starting weights
                <HelpTip>From scratch needs more epochs.</HelpTip>
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {STARTS.map((s) => {
                  const disabled = !s.pretrained && !supportsScratch(architecture);
                  return (
                    <Button
                      key={s.label}
                      type="button"
                      variant={pretrained === s.pretrained ? "default" : "outline"}
                      size="sm"
                      disabled={disabled}
                      onClick={() => setPretrained(s.pretrained)}
                      title={
                        disabled
                          ? "RF-DETR is pretrained-only"
                          : s.pretrained
                            ? s.hint
                            : SCRATCH_HINT_EXISTING
                      }
                    >
                      {s.label}
                    </Button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="train-dialog-epochs">Epochs</Label>
              <Input
                id="train-dialog-epochs"
                type="number"
                min={1}
                max={1000}
                value={epochs || ""}
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value));
                  setEpochs(Number.isFinite(v) ? Math.min(1000, Math.max(0, v)) : 0);
                }}
                onBlur={() => {
                  if (epochs < 1) setEpochs(60);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Image size</Label>
              <Select
                value={String(imageSize)}
                onValueChange={(v) => setImageSize(Number(v))}
              >
                <SelectTrigger className="w-full">
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
          </fieldset>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {blocker && (
            <p className="text-xs text-muted-foreground">{blocker}</p>
          )}
          <Button
            className="w-full"
            disabled={!!blocker || launch.isPending}
            onClick={() => launch.mutate(request)}
          >
            <Rocket className="size-4" />
            {launch.isPending
              ? "Queueing…"
              : trainModel
                ? "Start training"
                : "Merge datasets"}
          </Button>
          {merging && (
            <Badge variant="outline" className="mx-auto font-normal">
              Creates a new merged dataset
            </Badge>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
