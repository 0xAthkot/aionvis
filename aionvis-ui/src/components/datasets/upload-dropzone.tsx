"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileArchive, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { features } from "@/config/features";
import { apiPost } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { Dataset } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * BYOD entry point. In mock mode the "upload" reads file metadata
 * client-side, animates a plausible progress bar, then registers the dataset
 * through the mock API. Against the real backend it streams the .zip as
 * multipart (field "archive") with genuine upload progress, and the server
 * extracts it for the pipeline.
 */
export function UploadDropzone() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null);

  const register = useMutation({
    mutationFn: (body: { archiveName: string; sizeMb: number }) =>
      apiPost<Dataset>(endpoints.datasets.upload(), body),
    onSuccess: (dataset) => {
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success("Dataset registered", {
        description: `${dataset.name} · ~${dataset.imageCount.toLocaleString()} images detected.`,
      });
    },
    onError: (err) => toast.error("Upload failed", { description: err.message }),
  });

  function uploadReal(file: File) {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${features.apiBaseUrl}${endpoints.datasets.upload()}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setUploading({ name: file.name, pct: (e.loaded / e.total) * 100 });
      }
    };
    xhr.onload = () => {
      setUploading(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        const dataset = JSON.parse(xhr.responseText) as Dataset;
        queryClient.invalidateQueries({ queryKey: ["datasets"] });
        const extras = [
          dataset.videoFrameCount
            ? `${dataset.videoFrameCount.toLocaleString()} video frames extracted`
            : null,
          dataset.importedLabels
            ? `${dataset.importedLabels.boxCount.toLocaleString()} ${dataset.importedLabels.format.toUpperCase()} labels detected — runs will audit them`
            : null,
        ].filter(Boolean);
        toast.success("Dataset uploaded", {
          description:
            `${dataset.name} · ${dataset.imageCount.toLocaleString()} images` +
            (extras.length ? ` · ${extras.join(" · ")}` : "."),
        });
      } else {
        let message = xhr.statusText;
        try {
          message = (JSON.parse(xhr.responseText) as { message: string }).message;
        } catch {
          /* keep statusText */
        }
        toast.error("Upload failed", { description: message });
      }
    };
    xhr.onerror = () => {
      setUploading(null);
      toast.error("Upload failed", { description: "Network error." });
    };
    const form = new FormData();
    form.append("archive", file);
    setUploading({ name: file.name, pct: 0 });
    xhr.send(form);
  }

  function uploadSimulated(file: File) {
    const sizeMb = Math.max(1, Math.round(file.size / 1024 / 1024));
    setUploading({ name: file.name, pct: 0 });

    // Simulated transfer: ~2.5 s regardless of size.
    const timer = setInterval(() => {
      setUploading((prev) => {
        if (!prev) return prev;
        const pct = Math.min(100, prev.pct + 4 + Math.random() * 8);
        if (pct >= 100) {
          clearInterval(timer);
          register.mutate({ archiveName: file.name, sizeMb });
          return null;
        }
        return { ...prev, pct };
      });
    }, 120);
  }

  const ACCEPTED = [".zip", ".mp4", ".mov", ".avi", ".mkv", ".webm"];

  function handleFile(file: File | undefined) {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!ACCEPTED.some((s) => lower.endsWith(s))) {
      toast.error("Unsupported file", {
        description:
          "Upload a .zip of images (labels and videos welcome) or a bare video file.",
      });
      return;
    }
    if (features.useMocks) {
      uploadSimulated(file);
    } else {
      uploadReal(file);
    }
  }

  return (
    <Card
      className={cn(
        "border-dashed transition-colors",
        dragOver && "border-primary bg-primary/5",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFile(e.dataTransfer.files[0]);
      }}
    >
      <CardContent>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,.mp4,.mov,.avi,.mkv,.webm"
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <FileArchive className="size-7 text-primary" />
            <p className="text-sm font-medium">{uploading.name}</p>
            <Progress value={uploading.pct} className="h-1.5 w-64" />
            <p className="text-xs text-muted-foreground">
              Uploading… {Math.round(uploading.pct)}%
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-3 py-6"
          >
            <div className="flex size-11 items-center justify-center rounded-full bg-muted">
              <Upload className="size-5 text-muted-foreground" />
            </div>
            <div className="space-y-1 text-center">
              <p className="text-sm font-medium">
                Drop a .zip of images or a video, or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                Unlabeled images get labeled by the swarm · YOLO/COCO labels in
                the zip get audited · videos become frames. Proprietary data
                never leaves your deployment.
              </p>
            </div>
          </button>
        )}
      </CardContent>
    </Card>
  );
}
