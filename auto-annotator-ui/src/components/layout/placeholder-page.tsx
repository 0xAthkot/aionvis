import { Construction } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Stub for routes whose build phase hasn't arrived yet. */
export function PlaceholderPage({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <Badge variant="outline">{phase}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>
      <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed">
        <Construction className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          This screen ships in {phase}. The API contract behind it is already
          defined and mocked.
        </p>
      </div>
    </main>
  );
}
