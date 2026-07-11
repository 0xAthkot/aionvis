"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { RunPreviewImage } from "@/lib/api/types";

/** A serious run mints thousands of images — rendering them all at once
 * DoS-es the browser, so the gallery windows to one page of tiles. */
const PAGE_SIZE = 24;

/**
 * Live gallery of the Synthesis Agent's output. Polls the preview endpoint
 * while the run is active, so images pop in one by one as SDXL/FLUX mints
 * them — the "watch the foundry work" moment of the demo. Newest first:
 * page 1 always shows the freshest paint.
 */
export function FoundryPreview({
  runId,
  active,
  imagesTotal,
}: {
  runId: string;
  active: boolean;
  imagesTotal: number;
}) {
  const [page, setPage] = useState(1);
  const { data: images } = useQuery({
    queryKey: ["run-preview", runId],
    queryFn: () => api<RunPreviewImage[]>(endpoints.runs.preview(runId)),
    refetchInterval: active ? 2000 : false,
  });

  if (!images?.length) return null;

  const newestFirst = [...images].reverse();
  const totalPages = Math.max(1, Math.ceil(newestFirst.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const tiles = newestFirst.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const streaming = active && images.length < imagesTotal;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-1">
          <h2 className="section-label">Foundry output</h2>
          <p className="text-sm text-muted-foreground">
            Synthetic images minted by the Synthesis Agent — newest first
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5 font-mono text-xs">
          {streaming && (
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
          )}
          {images.length} / {imagesTotal}
        </Badge>
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
        {tiles.map((img, i) => (
          <div
            key={img.fileName}
            className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
            title={img.scenario}
          >
            {/* Data URIs in mock mode, backend /files URLs in real mode. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.fileName}
              loading="lazy"
              className="size-full object-cover transition-transform group-hover:scale-105"
            />
            {i === 0 && safePage === 1 && streaming && (
              <span className="absolute inset-0 animate-pulse rounded-md ring-2 ring-primary ring-inset" />
            )}
          </div>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
          >
            <ArrowLeft className="size-3.5" />
            Newer
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            page {safePage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={safePage >= totalPages}
            onClick={() => setPage(safePage + 1)}
          >
            Older
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      )}
    </section>
  );
}
