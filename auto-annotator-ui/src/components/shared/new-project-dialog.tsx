"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TagInput } from "@/components/shared/tag-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { CreateProjectRequest, Project } from "@/lib/api/types";
import { useReportUnsaved } from "@/lib/stores/unsaved";

/**
 * "New project" button + dialog. Projects are just a name and the object
 * classes the models should detect — everything else is per-run.
 */
export function NewProjectDialog({
  onCreated,
  triggerVariant = "outline",
}: {
  /** Called with the fresh project so callers can auto-select it. */
  onCreated?: (project: Project) => void;
  triggerVariant?: "outline" | "default";
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [classes, setClasses] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: (body: CreateProjectRequest) =>
      apiPost<Project>(endpoints.projects.list(), body),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`Project "${project.name}" created`);
      setOpen(false);
      setName("");
      setClasses([]);
      onCreated?.(project);
    },
    onError: (err) =>
      toast.error("Could not create project", { description: err.message }),
  });

  const isValid = name.trim().length > 1 && classes.length > 0;
  // Typed fields survive a close/reopen but not a mode switch (unmount).
  useReportUnsaved(
    "new-project-dialog",
    name.trim().length > 0 || classes.length > 0,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={triggerVariant} size="sm">
          <FolderPlus className="size-3.5" />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Name it and list what its models should detect — that&apos;s all a
            project needs.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="np-name">Name</Label>
            <Input
              id="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Loading Dock Safety"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="np-classes">Objects to detect</Label>
            <TagInput id="np-classes" value={classes} onChange={setClasses} />
            <p className="text-xs text-muted-foreground">
              Type an object and press Enter — e.g. “forklift”, “pallet”,
              “worker”. Any noun works; there is no fixed list.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!isValid || create.isPending}
            onClick={() =>
              create.mutate({ name, targetClasses: classes, description: "" })
            }
          >
            {create.isPending ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
