"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Database } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { HelpTip } from "@/components/shared/help-tip";
import { StartRunDialog } from "@/components/datasets/start-run-dialog";
import { UploadDropzone } from "@/components/datasets/upload-dropzone";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

function DatasetCard({ dataset }: { dataset: Dataset }) {
  const labeledPct =
    dataset.imageCount === 0
      ? 0
      : Math.round((dataset.labeledCount / dataset.imageCount) * 100);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle className="font-mono text-sm">
              <Link
                href={`/datasets/${dataset.id}`}
                className="hover:underline"
              >
                {dataset.name}
              </Link>
            </CardTitle>
            <CardDescription>
              {dataset.imageCount.toLocaleString()} images ·{" "}
              {(dataset.sizeMb / 1024).toFixed(1)} GB ·{" "}
              {new Date(dataset.createdAt).toLocaleDateString()}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
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
            <Badge variant={dataset.status === "ready" ? "default" : "outline"}>
              {statusLabel[dataset.status]}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Progress value={labeledPct} className="h-1.5" />
          <span className="w-24 text-right text-xs text-muted-foreground">
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
      </CardContent>
    </Card>
  );
}

export default function DatasetsPage() {
  const { data: datasets } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => api<Dataset[]>(endpoints.datasets.list()),
  });

  return (
    <main className="page-enter mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
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
          <div className="grid gap-4 lg:grid-cols-2">
            {!datasets
              ? Array.from({ length: 2 }, (_, i) => (
                  <Skeleton key={i} className="h-44 w-full" />
                ))
              : datasets.map((dataset) => (
                  <DatasetCard key={dataset.id} dataset={dataset} />
                ))}
          </div>
        )}
      </section>
    </main>
  );
}
