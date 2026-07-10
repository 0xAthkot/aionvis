"use client";

import { useQuery } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { apiPost } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { CostEstimate, CreateRunRequest } from "@/lib/api/types";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLaunchRun } from "@/hooks/use-launch-run";

export function LaunchSummary({
  request,
  isValid,
  validationHint,
}: {
  request: CreateRunRequest;
  isValid: boolean;
  validationHint?: string;
}) {
  // Debounce so slider drags don't spam the estimate endpoint.
  const estimateKey = useDebouncedValue(JSON.stringify(request), 500);

  const estimate = useQuery({
    queryKey: ["run-estimate", estimateKey],
    queryFn: () =>
      apiPost<CostEstimate>(endpoints.runs.estimate(), JSON.parse(estimateKey)),
    enabled: isValid,
    placeholderData: (prev) => prev,
  });

  const launch = useLaunchRun();

  const images =
    request.source.path === "synthetic"
      ? request.source.randomization.imageCount
      : request.source.imageCount;

  return (
    <Card className="sticky top-6">
      <CardHeader>
        <CardTitle>Launch summary</CardTitle>
        <CardDescription>
          mi300x-0 · AMD Developer Cloud · 192 GB VRAM
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="space-y-2">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Images</dt>
            <dd className="font-medium">{images.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Target classes</dt>
            <dd className="font-medium">{request.targetClasses.length}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Architecture</dt>
            <dd className="font-mono text-xs font-medium uppercase">
              {request.training.architecture}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Epochs</dt>
            <dd className="font-medium">{request.training.epochs}</dd>
          </div>
        </dl>

        <Separator />

        {!isValid ? (
          <p className="text-xs text-muted-foreground">
            {validationHint ?? "Complete the form to see a cost estimate."}
          </p>
        ) : estimate.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : estimate.isError ? (
          <p className="text-xs text-destructive">{estimate.error.message}</p>
        ) : (
          <div className="space-y-2">
            {estimate.data.breakdown.map((row) => (
              <div key={row.stage} className="flex justify-between text-xs">
                <span className="text-muted-foreground capitalize">
                  {row.stage.replace(/_/g, " ")}
                </span>
                <span>{row.minutes} min</span>
              </div>
            ))}
            <Separator />
            <div className="flex justify-between font-medium">
              <span>~{estimate.data.gpuMinutes} GPU min</span>
              <span>${estimate.data.estimatedUsd.toFixed(2)}</span>
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          disabled={!isValid || launch.isPending}
          onClick={() => launch.mutate(request)}
        >
          <Rocket className="size-4" />
          {launch.isPending ? "Queueing…" : "Launch autonomous run"}
        </Button>
      </CardFooter>
    </Card>
  );
}
