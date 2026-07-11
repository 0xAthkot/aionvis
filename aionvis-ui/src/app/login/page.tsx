"use client";

import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Cloud,
  PlugZap,
  Sparkles,
} from "lucide-react";
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

  // Deliberately NO auto-redirect for existing sessions: entering the demo
  // once must never lock you out of signing in with a real node. A live
  // session just gets a shortcut below.

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
          className="flex flex-col items-center gap-2"
          title="Back to the landing page"
        >
          <Image
            src="/aionvis-wordmark.png"
            alt="aionVIS"
            width={1087}
            height={240}
            priority
            className="h-7 w-auto"
          />
          <p className="text-xs text-muted-foreground">
            MLOps Command Center
          </p>
        </Link>

        {/* Only a NODE session gets a continue shortcut — for a demo
            session it would duplicate the demo button right below it. */}
        {user && user.email !== "demo@aionvis.dev" && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => router.replace("/dashboard")}
          >
            Continue on your node ({user.email.split("@")[1]})
            <ArrowRight className="size-4" />
          </Button>
        )}

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
              One script deploys the backend and prints the endpoint and API
              key to paste here.
            </CardDescription>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              <a
                href="https://github.com/0xAthkot/aionvis/blob/main/docs/HOSTING_GUIDE.md"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary underline-offset-4 hover:underline"
              >
                <BookOpen className="size-3.5" />
                Deployment guide
                <ArrowUpRight className="size-3" />
              </a>
              <a
                href="https://github.com/0xAthkot/aionvis/blob/main/backend/deploy_mi300x.sh"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 font-mono text-xs text-foreground underline underline-offset-4"
              >
                deploy_mi300x.sh
                <ArrowUpRight className="size-3" />
              </a>
            </div>
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
