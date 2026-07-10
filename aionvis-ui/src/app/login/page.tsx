"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Cloud, Crosshair, PlugZap, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { attachNode, detachNode } from "@/lib/api/attach";
import { useAuthStore } from "@/lib/stores/auth";

/**
 * The front door. Authentication is bring-your-own-node: the droplet's
 * AA_API_KEY is the credential, verified live against the node before
 * anything is persisted. The demo path runs the full console on the
 * in-browser simulation — no node, no key, no cost.
 */
export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  function enterDemo() {
    // A previously attached node would shadow the demo — detach first.
    detachNode();
    queryClient.clear();
    login("demo@aionvis.dev");
    router.replace("/dashboard");
  }

  async function connectAndEnter(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const node = await attachNode(endpoint, token);
      queryClient.clear();
      const host = endpoint.trim().replace(/^https?:\/\//, "").split("/")[0];
      login(`operator@${host || "your-node"}`);
      toast.success(`Attached to ${node?.gpu ?? "your node"}`, {
        description:
          "Every screen and live stream now runs on your GPU node.",
      });
      router.replace("/dashboard");
    } catch (err) {
      toast.error("Could not attach your node", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <Link
          href="/"
          className="flex items-center justify-center gap-2.5"
          title="Back to the landing page"
        >
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary">
            <Crosshair className="size-5 text-primary-foreground" />
          </div>
          <div className="leading-tight">
            <p className="font-semibold tracking-tight">aionVIS</p>
            <p className="text-xs text-muted-foreground">
              MLOps Command Center
            </p>
          </div>
        </Link>

        <Button size="lg" className="w-full" onClick={enterDemo}>
          <Sparkles className="size-4" />
          Demo without AMD Developer Cloud
        </Button>
        <p className="-mt-3 text-center text-xs text-muted-foreground">
          Full console on an in-browser simulation — every screen, live runs
          included. No account, no GPU.
        </p>

        <div className="flex w-full items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">or</span>
          <Separator className="flex-1" />
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Cloud className="size-4 text-muted-foreground" />
              <CardTitle>Sign in with your GPU node</CardTitle>
            </div>
            <CardDescription>
              Run the real product on your own AMD Developer Cloud droplet.
              Deploy the backend with{" "}
              <code className="font-mono text-xs">deploy_mi300x.sh</code> — it
              prints the endpoint and API key to paste here.
            </CardDescription>
          </CardHeader>
          <form onSubmit={connectAndEnter}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="node-endpoint">Node endpoint</Label>
                <Input
                  id="node-endpoint"
                  placeholder="https://your-node:8000"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="node-token">
                  API key{" "}
                  <span className="text-muted-foreground">(AA_API_KEY)</span>
                </Label>
                <Input
                  id="node-token"
                  type="password"
                  placeholder="aa_node_…"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                <PlugZap className="size-4" />
                {busy ? "Verifying your node…" : "Connect & launch console"}
              </Button>
            </CardContent>
          </form>
        </Card>

        <Link
          href="/"
          className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to the landing page
        </Link>
      </div>
    </main>
  );
}
