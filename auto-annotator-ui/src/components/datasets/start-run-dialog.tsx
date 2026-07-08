"use client";

import { useQuery } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
import { useState } from "react";
import { TagInput } from "@/components/shared/tag-input";
import { Button } from "@/components/ui/button";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  CreateByodRunRequest,
  Dataset,
  Project,
  TrainingConfig,
} from "@/lib/api/types";
import { useLaunchRun } from "@/hooks/use-launch-run";

/** Path B: configure the labeling+training run for an uploaded dataset.
 * Datasets that shipped their own labels run in AUDIT mode: the class list
 * comes from the labels and the Critic verifies them instead of relabeling. */
export function StartRunDialog({ dataset }: { dataset: Dataset }) {
  const audit = dataset.importedLabels;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(
    `${dataset.name} · ${audit ? "label audit" : "byod labeling"}`,
  );
  const [targetClasses, setTargetClasses] = useState<string[]>(
    audit?.classNames ?? [],
  );
  const [architecture, setArchitecture] =
    useState<TrainingConfig["architecture"]>("yolov10m");
  const [epochs, setEpochs] = useState(50);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>(endpoints.projects.list()),
  });
  const [projectId, setProjectId] = useState("");

  const launch = useLaunchRun();

  const request: CreateByodRunRequest = {
    projectId,
    name,
    targetClasses,
    source: {
      path: "byod",
      datasetId: dataset.id,
      archiveName: `${dataset.name}.zip`,
      imageCount: dataset.imageCount,
    },
    training: {
      architecture,
      epochs,
      imageSize: 640,
      batchSize: 32,
      device: "mi300x-0",
    },
  };

  const isValid =
    !!projectId && name.trim().length > 2 && targetClasses.length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Rocket className="size-3.5" />
          Start labeling run
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {audit ? "Audit & train on" : "Label & train on"} {dataset.name}
          </DialogTitle>
          <DialogDescription>
            {audit
              ? `Your archive shipped ${audit.boxCount.toLocaleString()} ${audit.format.toUpperCase()} labels — the Critic audits them (geometry + VLM spot-check), then YOLO trains on the survivors.`
              : `SAM 3 segments all ${dataset.imageCount.toLocaleString()} images zero-shot, the Critic verifies geometry, then YOLO trains — no manual annotation.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
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
            <Label htmlFor="byod-name">Run name</Label>
            <Input
              id="byod-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="byod-classes">
              {audit
                ? "Classes (defined by the imported labels)"
                : "Target classes (SAM 3 zero-shot prompts)"}
            </Label>
            <TagInput
              id="byod-classes"
              value={targetClasses}
              onChange={audit ? () => {} : setTargetClasses}
              disabled={!!audit}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Architecture</Label>
              <Select
                value={architecture}
                onValueChange={(v) =>
                  setArchitecture(v as TrainingConfig["architecture"])
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
              <Label htmlFor="byod-epochs">Epochs</Label>
              <Input
                id="byod-epochs"
                type="number"
                min={10}
                max={150}
                value={epochs}
                onChange={(e) => setEpochs(Number(e.target.value) || 50)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            className="w-full"
            disabled={!isValid || launch.isPending}
            onClick={() => launch.mutate(request)}
          >
            <Rocket className="size-4" />
            {launch.isPending ? "Queueing…" : "Launch autonomous run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
