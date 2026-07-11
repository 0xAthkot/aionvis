"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiDelete } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { Project } from "@/lib/api/types";

/**
 * Type-to-confirm project deletion. The backend cascades: the project's
 * runs, the datasets and models those runs produced, and its feedback all
 * go with it — hence the GitHub-style "type the name" guard.
 */
export function DeleteProjectDialog({
  project,
  onDeleted,
}: {
  project: Project | null;
  onDeleted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const queryClient = useQueryClient();

  const del = useMutation({
    mutationFn: () => apiDelete(endpoints.projects.get(project!.id)),
    onSuccess: () => {
      setOpen(false);
      setTyped("");
      // Runs, datasets and models may all have gone with it.
      queryClient.invalidateQueries();
      toast.success(`Project "${project?.name}" deleted`, {
        description: "Its runs, datasets, models and feedback were removed.",
      });
      onDeleted?.();
    },
    onError: (err) =>
      toast.error("Could not delete project", { description: err.message }),
  });

  const confirmed = typed === (project?.name ?? "");

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Disabled buttons swallow hover — the span catches it. */}
          <span className="inline-flex">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Delete project"
              disabled={!project}
              onClick={() => setOpen(true)}
            >
              <Trash2 className="size-3.5 text-destructive" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {project
            ? `Delete "${project.name}" and everything it produced`
            : "Select a project to delete it"}
        </TooltipContent>
      </Tooltip>

      <Dialog
        open={open && !!project}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setTyped("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{project?.name}”?</DialogTitle>
            <DialogDescription>
              This permanently removes the project and everything it
              produced: its runs, their datasets and trained models, and any
              flagged feedback. Anything shared with another project&apos;s
              runs is kept. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-project-name">
              Type <span className="font-semibold">{project?.name}</span> to
              confirm
            </Label>
            <Input
              id="confirm-project-name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={project?.name}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={del.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!confirmed || del.isPending}
              onClick={() => del.mutate()}
            >
              <Trash2 className="size-3.5" />
              {del.isPending ? "Deleting…" : "Delete project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
