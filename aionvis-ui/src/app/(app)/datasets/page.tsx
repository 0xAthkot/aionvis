"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Database, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { HelpTip } from "@/components/shared/help-tip";
import { StartRunDialog } from "@/components/datasets/start-run-dialog";
import { UploadDropzone } from "@/components/datasets/upload-dropzone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { fuzzyAny } from "@/lib/fuzzy";
import type {
  AnnotatedImage,
  Dataset,
  Paginated,
  PipelineRun,
  Project,
} from "@/lib/api/types";

const statusLabel: Record<Dataset["status"], string> = {
  uploading: "Uploading",
  unlabeled: "Unlabeled",
  labeling: "Labeling",
  curating: "Curating",
  ready: "Ready",
};

const statusChip: Record<Dataset["status"], string> = {
  uploading: "chip-neutral",
  unlabeled: "chip-warning",
  labeling: "chip-accent",
  curating: "chip-warning",
  ready: "chip-success",
};

/** Three thumbnails, randomly sampled (stable per dataset), so each row
 * shows what it contains at a glance. One small request per row
 * (pageSize=12), thumbnails only. */
function DatasetPeek({ dataset }: { dataset: Dataset }) {
  const { data } = useQuery({
    queryKey: ["dataset-peek", dataset.id],
    queryFn: () =>
      api<Paginated<AnnotatedImage>>(
        `${endpoints.datasets.images(dataset.id)}?page=1&pageSize=12`,
      ),
    enabled: dataset.imageCount > 0,
    staleTime: 5 * 60_000,
  });
  const picks = useMemo(() => {
    const items = data?.items ?? [];
    if (items.length <= 3) return items;
    // Seeded shuffle (dataset id) — random-looking but stable across renders.
    let seed = [...dataset.id].reduce((a, c) => a + c.charCodeAt(0), 0);
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    return [...items].sort(() => rand() - 0.5).slice(0, 3);
  }, [data, dataset.id]);

  if (picks.length === 0) return null;
  return (
    <div className="hidden shrink-0 gap-1.5 sm:flex">
      {picks.map((img) => (
        // eslint-disable-next-line @next/next/no-img-element -- runtime node/mock URLs, no optimizer
        <img
          key={img.id}
          src={img.thumbnailUrl || img.url}
          alt={img.fileName}
          loading="lazy"
          className="size-16 rounded-md border border-white/10 object-cover"
        />
      ))}
    </div>
  );
}

/** Open row (no card): the library reads as one divided list. */
function DatasetRow({ dataset }: { dataset: Dataset }) {
  const labeledPct =
    dataset.imageCount === 0
      ? 0
      : Math.round((dataset.labeledCount / dataset.imageCount) * 100);

  return (
    <div className="flex items-start gap-5 py-5">
      <div className="min-w-0 flex-1 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Link
          href={`/datasets/${dataset.id}`}
          className="font-mono text-sm font-semibold hover:underline"
        >
          {dataset.name}
        </Link>
        <Badge variant="secondary">
          {dataset.origin === "synthetic" ? "Synthetic" : "BYOD"}
        </Badge>
        {dataset.importedLabels && (
          <Badge variant="outline" className="font-mono text-xs uppercase">
            {dataset.importedLabels.format} labels
          </Badge>
        )}
        {dataset.videoFrameCount ? (
          <Badge variant="outline" className="text-xs">
            video · {dataset.videoFrameCount} frames
          </Badge>
        ) : null}
        <span className={`chip ${statusChip[dataset.status]}`}>
          {statusLabel[dataset.status]}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {dataset.imageCount.toLocaleString()} images ·{" "}
          {(dataset.sizeMb / 1024).toFixed(1)} GB ·{" "}
          {new Date(dataset.createdAt).toLocaleDateString()}
        </span>
      </div>
      <div className="flex max-w-lg items-center gap-2">
        <Progress value={labeledPct} className="progress-glow h-1.5" />
        <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
          {labeledPct}% labeled
        </span>
      </div>
      {dataset.classes.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {dataset.classes.map((cls) => (
            <Badge
              key={cls.id}
              variant="outline"
              className="gap-1.5 font-mono text-xs font-normal"
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: cls.color }}
              />
              {cls.name}
              <span className="text-muted-foreground">
                {cls.instanceCount.toLocaleString()}
              </span>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No labels yet — launch a run to let the agents annotate it.
        </p>
      )}
      {/* Plain uploads launch a labeling run; archives that shipped their
          own labels (status "curating") launch an AUDIT run — the dialog
          handles both, so both must offer it. */}
      {(dataset.status === "unlabeled" ||
        (dataset.status === "curating" && !!dataset.importedLabels)) && (
        <StartRunDialog dataset={dataset} />
      )}
      </div>
      <DatasetPeek dataset={dataset} />
    </div>
  );
}

const LIBRARY_PAGE_SIZE = 12;

export default function DatasetsPage() {
  // Paginated so a library of hundreds never lands in one request — each
  // row also fetches its 3-thumbnail peek, so the page size stays modest.
  const [page, setPage] = useState(1);
  const { data: datasetPage, isPlaceholderData } = useQuery({
    queryKey: ["datasets", page],
    queryFn: () =>
      api<Paginated<Dataset>>(
        `${endpoints.datasets.list()}?page=${page}&pageSize=${LIBRARY_PAGE_SIZE}`,
      ),
    placeholderData: (prev) => prev,
  });
  const datasets = datasetPage?.items;
  const totalPages = datasetPage
    ? Math.max(1, Math.ceil(datasetPage.total / LIBRARY_PAGE_SIZE))
    : 1;

  // Search spans the WHOLE library, not just the current page: while a
  // query is typed we fetch one big page and filter it client-side; the
  // project link comes from dataset.projectId, or through its run.
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const { data: searchPool } = useQuery({
    queryKey: ["datasets", "search-pool"],
    queryFn: () =>
      api<Paginated<Dataset>>(`${endpoints.datasets.list()}?page=1&pageSize=500`),
    enabled: searching,
  });
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>(endpoints.projects.list()),
    enabled: searching,
  });
  const { data: runPage } = useQuery({
    queryKey: ["runs", "search-pool"],
    queryFn: () =>
      api<Paginated<PipelineRun>>(`${endpoints.runs.list()}?page=1&pageSize=500`),
    enabled: searching,
  });
  const visible = useMemo(() => {
    if (!searching) return datasets;
    const projectName = new Map(projects?.map((p) => [p.id, p.name]) ?? []);
    const projectByRun = new Map(
      runPage?.items.map((r) => [r.id, r.projectId]) ?? [],
    );
    return (searchPool?.items ?? datasets ?? []).filter((d) =>
      fuzzyAny(
        query,
        d.name,
        projectName.get(d.projectId ?? projectByRun.get(d.runId ?? "") ?? ""),
        ...d.classes.map((c) => c.name),
      ),
    );
  }, [searching, datasets, searchPool, projects, runPage, query]);

  return (
    <main className="stagger-children mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Datasets
            <HelpTip>
              A dataset is a collection of labeled photos your model learns
              from. The Foundry creates them for you, or upload your own and
              the agents label them.
            </HelpTip>
          </span>
        }
        description="Path B — bring your own data. Upload proprietary images and the agents label them in place."
      />

      <UploadDropzone />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-label flex items-center gap-2">
            <Database className="size-4" />
            Library
          </h2>
          {datasetPage && datasetPage.total > 0 && (
            <p className="text-xs text-muted-foreground">
              {searching ? (
                <>{visible?.length ?? 0} of {searchPool?.total ?? datasetPage.total} datasets match</>
              ) : (
                <>
                  {datasetPage.total} datasets
                  {totalPages > 1 && ` · page ${page} of ${totalPages}`} ·{" "}
                  {datasets
                    ?.reduce((n, d) => n + d.imageCount, 0)
                    .toLocaleString()}{" "}
                  images and{" "}
                  {datasets?.filter((d) => d.status === "ready").length} ready
                  to train on{totalPages > 1 && " on this page"}
                </>
              )}
            </p>
          )}
        </div>
        {datasetPage && datasetPage.total > 0 && (
          <div className="relative max-w-sm">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by dataset, project or class…"
              className="pl-8"
              aria-label="Search datasets"
            />
          </div>
        )}
        {visible?.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed">
            <p className="text-sm text-muted-foreground">
              {searching
                ? `Nothing matches “${query}” — try part of a dataset, project or class name.`
                : "No datasets yet — upload a .zip above or run the Synthetic Foundry."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60 border-t border-border/60">
            {!visible
              ? Array.from({ length: 2 }, (_, i) => (
                  <Skeleton key={i} className="my-4 h-32 w-full" />
                ))
              : visible.map((dataset) => (
                  <DatasetRow key={dataset.id} dataset={dataset} />
                ))}
          </div>
        )}
        {totalPages > 1 && !searching && (
          <div className="flex items-center justify-center gap-3 pt-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isPlaceholderData}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ArrowLeft className="size-3.5" />
              Previous
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              page {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isPlaceholderData}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
