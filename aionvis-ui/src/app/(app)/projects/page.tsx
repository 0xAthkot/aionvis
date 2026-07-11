"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Database, FolderKanban, Play, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { DeleteProjectDialog } from "@/components/shared/delete-project-dialog";
import { HelpTip } from "@/components/shared/help-tip";
import { NewProjectDialog } from "@/components/shared/new-project-dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { TASKS } from "@/lib/architectures";
import { fuzzyAny } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";
import type {
  Dataset,
  FoundryFeedback,
  ModelArtifact,
  Paginated,
  PipelineRun,
  Project,
  TrainingTask,
} from "@/lib/api/types";

/** Everything one project has produced, joined client-side. */
interface ProjectFacts {
  project: Project;
  runs: PipelineRun[];
  activeRuns: number;
  datasets: Dataset[];
  models: ModelArtifact[];
  tasks: TrainingTask[];
  architectures: string[];
  /** Best headline metric among ready models (top-1 for classify). */
  best: { label: string; value: number } | null;
  pendingFeedback: number;
  lastActivity: string;
}

const TASK_LABEL = new Map(TASKS.map((t) => [t.id, t.label]));

export default function ProjectsPage() {
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>(endpoints.projects.list()),
  });
  const { data: runPage } = useQuery({
    queryKey: ["runs", "search-pool"],
    queryFn: () =>
      api<Paginated<PipelineRun>>(`${endpoints.runs.list()}?page=1&pageSize=500`),
  });
  const { data: models } = useQuery({
    queryKey: ["models"],
    queryFn: () => api<ModelArtifact[]>(endpoints.models.list()),
  });
  const { data: datasetPage } = useQuery({
    queryKey: ["datasets", "search-pool"],
    queryFn: () =>
      api<Paginated<Dataset>>(`${endpoints.datasets.list()}?page=1&pageSize=500`),
  });
  const { data: feedbackByProject } = useQuery({
    queryKey: ["feedback", "all-projects", projects?.map((p) => p.id).join(",")],
    enabled: !!projects?.length,
    queryFn: async () => {
      const entries = await Promise.all(
        projects!.map(
          async (p) =>
            [
              p.id,
              await api<FoundryFeedback[]>(endpoints.projects.feedback(p.id)),
            ] as const,
        ),
      );
      return new Map(entries);
    },
  });

  const facts: ProjectFacts[] | null = useMemo(() => {
    if (!projects || !runPage || !models || !datasetPage) return null;
    const modelById = new Map(models.map((m) => [m.id, m]));
    return projects
      .map((project) => {
        const runs = runPage.items.filter((r) => r.projectId === project.id);
        const runIds = new Set(runs.map((r) => r.id));
        const dsIds = new Set(runs.map((r) => r.datasetId).filter(Boolean));
        const datasets = datasetPage.items.filter(
          (d) => d.projectId === project.id || dsIds.has(d.id) ||
            (d.runId && runIds.has(d.runId)),
        );
        const projModels = runs
          .map((r) => (r.modelId ? modelById.get(r.modelId) : undefined))
          .filter((m): m is ModelArtifact => !!m);
        const ready = projModels.filter((m) => m.status === "ready");
        let best: ProjectFacts["best"] = null;
        for (const m of ready) {
          const isCls = m.task === "classify";
          const value = isCls ? (m.metrics.top1 ?? 0) : m.metrics.map50;
          if (!best || value > best.value)
            best = { label: isCls ? "top-1" : "mAP50", value };
        }
        const lastActivity = [
          project.createdAt,
          ...runs.flatMap((r) => [r.createdAt, r.finishedAt ?? ""]),
        ]
          .filter(Boolean)
          .sort()
          .at(-1)!;
        return {
          project,
          runs,
          activeRuns: runs.filter((r) =>
            ["queued", "running", "paused"].includes(r.status),
          ).length,
          datasets,
          models: projModels,
          tasks: [...new Set(projModels.map((m) => m.task ?? "detect"))],
          architectures: [...new Set(projModels.map((m) => m.architecture))],
          best,
          pendingFeedback: (feedbackByProject?.get(project.id) ?? []).filter(
            (f) => !f.consumedByRunId,
          ).length,
          lastActivity,
        };
      })
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  }, [projects, runPage, models, datasetPage, feedbackByProject]);

  const [query, setQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState<"any" | TrainingTask>("any");
  const [onlyTrained, setOnlyTrained] = useState(false);
  const [onlyActive, setOnlyActive] = useState(false);
  const [onlyFeedback, setOnlyFeedback] = useState(false);

  const visible = useMemo(
    () =>
      (facts ?? []).filter((f) => {
        if (
          !fuzzyAny(
            query,
            f.project.name,
            f.project.description,
            ...f.project.targetClasses,
            ...f.architectures,
            ...f.tasks.map((t) => TASK_LABEL.get(t) ?? t),
          )
        )
          return false;
        if (onlyTrained && !f.models.some((m) => m.status === "ready"))
          return false;
        if (onlyActive && f.activeRuns === 0) return false;
        if (onlyFeedback && f.pendingFeedback === 0) return false;
        if (taskFilter !== "any" && !f.tasks.includes(taskFilter)) return false;
        return true;
      }),
    [facts, query, taskFilter, onlyTrained, onlyActive, onlyFeedback],
  );

  const toggle = (
    on: boolean,
    set: (v: boolean) => void,
    label: string,
  ) => (
    <button
      type="button"
      onClick={() => set(!on)}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-all duration-200",
        on
          ? "border-primary bg-primary/10 text-foreground shadow-sm shadow-primary/20"
          : "text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <main className="stagger-children mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Projects
            <HelpTip>
              One row per goal you&apos;re building models for. Each shows
              everything the project produced — runs, datasets, trained
              models — with search and filters across all of it.
            </HelpTip>
          </span>
        }
        description="Every project and what it has produced — search by name, class, architecture or output type."
        actions={<NewProjectDialog />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1 basis-64">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by project, class, architecture or output type…"
            className="pl-8"
            aria-label="Search projects"
          />
        </div>
        {toggle(onlyTrained, setOnlyTrained, "Has trained model")}
        {toggle(onlyActive, setOnlyActive, "Has active run")}
        {toggle(onlyFeedback, setOnlyFeedback, "Has pending feedback")}
        <Select
          value={taskFilter}
          onValueChange={(v) => setTaskFilter(v as "any" | TrainingTask)}
        >
          <SelectTrigger size="sm" aria-label="Filter by model output">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any output type</SelectItem>
            {TASKS.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
                <span className="text-muted-foreground"> · {t.hint}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!facts ? (
        <div className="space-y-6">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : facts.length === 0 ? (
        <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed">
          <FolderKanban className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No projects yet — create one here or in the Foundry.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed">
          <p className="text-sm text-muted-foreground">
            Nothing matches — loosen the filters or try part of a project,
            class or architecture name.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/60 border-t border-border/60">
          {visible.map((f) => (
            <div key={f.project.id} className="space-y-3 py-5">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-base font-semibold tracking-tight">
                  {f.project.name}
                </p>
                {f.activeRuns > 0 && (
                  <span className="chip chip-accent">
                    {f.activeRuns} active run{f.activeRuns > 1 ? "s" : ""}
                  </span>
                )}
                {f.pendingFeedback > 0 && (
                  <span className="chip chip-warning">
                    {f.pendingFeedback} flagged case
                    {f.pendingFeedback > 1 ? "s" : ""}
                  </span>
                )}
                {f.best && (
                  <Badge variant="outline" className="tabular-nums">
                    best {f.best.label} {f.best.value.toFixed(3)}
                  </Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  last activity{" "}
                  {new Date(f.lastActivity).toLocaleDateString()}
                </span>
                <DeleteProjectDialog project={f.project} />
              </div>
              {f.project.description && (
                <p className="max-w-3xl text-sm text-muted-foreground">
                  {f.project.description}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <Link
                  href="/runs"
                  className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Play className="size-3.5" />
                  {f.runs.length} run{f.runs.length === 1 ? "" : "s"}
                </Link>
                <Link
                  href="/datasets"
                  className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Database className="size-3.5" />
                  {f.datasets.length} dataset
                  {f.datasets.length === 1 ? "" : "s"}
                </Link>
                <Link
                  href="/models"
                  className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Boxes className="size-3.5" />
                  {f.models.length} model{f.models.length === 1 ? "" : "s"}
                </Link>
                {f.tasks.map((t) => (
                  <Badge key={t} variant="secondary">
                    {TASK_LABEL.get(t) ?? t}
                  </Badge>
                ))}
                {f.architectures.map((a) => (
                  <Badge key={a} variant="outline" className="font-mono text-xs uppercase">
                    {a}
                  </Badge>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {f.project.targetClasses.map((c) => (
                  <Badge key={c} variant="secondary" className="font-mono text-xs">
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
