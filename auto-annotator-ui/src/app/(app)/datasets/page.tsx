"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Database } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { HelpTip } from "@/components/shared/help-tip";
import { StartRunDialog } from "@/components/datasets/start-run-dialog";
import { UploadDropzone } from "@/components/datasets/upload-dropzone";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { Dataset } from "@/lib/api/types";

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

/** Open row (no card): the library reads as one divided list. */
function DatasetRow({ dataset }: { dataset: Dataset }) {
  const labeledPct =
    dataset.imageCount === 0
      ? 0
      : Math.round((dataset.labeledCount / dataset.imageCount) * 100);

  return (
    <div className="space-y-3 py-5">
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
  );
}

export default function DatasetsPage() {
  const { data: datasets } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => api<Dataset[]>(endpoints.datasets.list()),
  });

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
          {datasets && datasets.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {datasets.length} datasets ·{" "}
              {datasets
                .reduce((n, d) => n + d.imageCount, 0)
                .toLocaleString()}{" "}
              images ·{" "}
              {datasets.filter((d) => d.status === "ready").length} ready to
              train on
            </p>
          )}
        </div>
        {datasets?.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed">
            <p className="text-sm text-muted-foreground">
              No datasets yet — upload a .zip above or run the Synthetic
              Foundry.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60 border-t border-border/60">
            {!datasets
              ? Array.from({ length: 2 }, (_, i) => (
                  <Skeleton key={i} className="my-4 h-32 w-full" />
                ))
              : datasets.map((dataset) => (
                  <DatasetRow key={dataset.id} dataset={dataset} />
                ))}
          </div>
        )}
      </section>
    </main>
  );
}
