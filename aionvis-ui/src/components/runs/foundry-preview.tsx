"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { RunPreviewImage } from "@/lib/api/types";

/**
 * Live gallery of the Synthesis Agent's output. Polls the preview endpoint
 * while the run is active, so images pop in one by one as SDXL/FLUX mints
 * them — the "watch the foundry work" moment of the demo.
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
  const { data: images } = useQuery({
    queryKey: ["run-preview", runId],
    queryFn: () => api<RunPreviewImage[]>(endpoints.runs.preview(runId)),
    refetchInterval: active ? 2000 : false,
  });

  if (!images?.length) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-1">
          <h2 className="section-label">Foundry output</h2>
          <p className="text-sm text-muted-foreground">
            Synthetic images minted by the Synthesis Agent
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5 font-mono text-xs">
          {active && images.length < imagesTotal && (
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
          )}
          {images.length} / {imagesTotal}
        </Badge>
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {images.map((img, i) => (
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
              {i === images.length - 1 && active && images.length < imagesTotal && (
                <span className="absolute inset-0 animate-pulse rounded-md ring-2 ring-primary ring-inset" />
              )}
            </div>
          ))}
      </div>
    </section>
  );
}
