"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ImageUp, Loader2, RotateCcw, ScanSearch, Zap } from "lucide-react";
import { toast } from "sonner";
import { BBoxImage } from "@/components/datasets/bbox-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiUpload } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  AnnotatedImage,
  DatasetClass,
  ModelArtifact,
  PredictionResult,
} from "@/lib/api/types";
import { CLASS_COLORS } from "@/lib/class-colors";
import { cn } from "@/lib/utils";

/**
 * Drop an image, run it through the trained weights, see the detections —
 * the last mile of the pipeline story: prompt in, working model out.
 */
export function InferencePlayground({ model }: { model: ModelArtifact }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(
    null,
  );

  // Revoke the object URL when it's replaced or the component unmounts.
  useEffect(() => {
    const url = preview?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview]);

  const classes: DatasetClass[] = model.classes.map((name, i) => ({
    id: i,
    name,
    color: CLASS_COLORS[i % CLASS_COLORS.length],
    instanceCount: 0,
  }));

  const predict = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("image", file);
      return apiUpload<PredictionResult>(
        endpoints.models.predict(model.id),
        form,
      );
    },
    onError: (err) =>
      toast.error("Inference failed", { description: err.message }),
  });

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("Not an image", {
          description: "Drop a JPG, PNG, BMP or WebP file.",
        });
        return;
      }
      setPreview({ url: URL.createObjectURL(file), name: file.name });
      predict.mutate(file);
    },
    [predict],
  );

  const reset = () => {
    setPreview(null);
    predict.reset();
    if (inputRef.current) inputRef.current.value = "";
  };

  const result = predict.data;
  const annotated: AnnotatedImage | null =
    preview && result
      ? {
          id: "prediction",
          datasetId: model.datasetId,
          fileName: preview.name,
          width: result.width,
          height: result.height,
          url: preview.url,
          thumbnailUrl: preview.url,
          boxes: result.boxes,
          split: "val",
          curationState: "accepted",
        }
      : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Inference playground</CardTitle>
            <CardDescription>
              Run any image through these weights — live, no deployment step
            </CardDescription>
          </div>
          {preview && (
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="size-3.5" />
              Try another
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        {!preview && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFile(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "flex min-h-44 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-muted-foreground transition-colors",
              dragOver
                ? "border-primary bg-primary/5 text-primary"
                : "hover:border-muted-foreground/50 hover:text-foreground",
            )}
          >
            <ImageUp className="size-6" />
            <span className="text-sm font-medium">
              Drop an image or click to browse
            </span>
            <span className="px-6 text-center text-xs">
              Detects: {model.classes.join(", ")}
            </span>
          </button>
        )}

        {preview && (
          <div className="space-y-3">
            {annotated ? (
              <BBoxImage image={annotated} classes={classes} showLabels />
            ) : (
              <div className="relative overflow-hidden rounded-md">
                {/* Local object URL preview; next/image adds nothing here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview.url}
                  alt={preview.name}
                  className="block h-auto w-full"
                />
                {predict.isPending && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                    <Badge variant="secondary" className="gap-1.5">
                      <Loader2 className="size-3 animate-spin" />
                      Running inference…
                    </Badge>
                  </div>
                )}
              </div>
            )}

            {result && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant={result.boxes.length ? "default" : "secondary"}>
                  <ScanSearch className="size-3" />
                  {result.boxes.length
                    ? `${result.boxes.length} detection${result.boxes.length === 1 ? "" : "s"}`
                    : "No detections above 0.25 confidence"}
                </Badge>
                <Badge variant="outline" className="tabular-nums">
                  <Zap className="size-3" />
                  {result.latencyMs.toFixed(0)} ms
                </Badge>
                <Badge variant="outline" className="font-mono">
                  {result.device}
                </Badge>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
