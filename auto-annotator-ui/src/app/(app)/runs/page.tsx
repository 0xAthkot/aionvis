"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { runStatusVariant } from "@/components/dashboard/recent-runs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { Paginated, PipelineRun } from "@/lib/api/types";

export default function RunsPage() {
  const { data } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api<Paginated<PipelineRun>>(endpoints.runs.list()),
  });

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Runs</h1>
        <p className="text-sm text-muted-foreground">
          Every pipeline execution across the organization.
        </p>
      </header>

      {!data ? (
        <Skeleton className="h-64 w-full" />
      ) : data.items.length === 0 ? (
        <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed">
          <p className="text-sm text-muted-foreground">
            No runs yet — launch one from the Synthetic Foundry or a dataset.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="w-44">Progress</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link
                      href={`/runs/${run.id}`}
                      className="font-medium hover:underline"
                    >
                      {run.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {run.path === "synthetic" ? "Synthetic" : "BYOD"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground capitalize">
                    {run.stage.replace(/_/g, " ")}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={run.progress.pct} className="h-1.5" />
                      <span className="w-9 text-right text-xs text-muted-foreground">
                        {run.progress.pct}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={runStatusVariant[run.status]}>
                      {run.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}
