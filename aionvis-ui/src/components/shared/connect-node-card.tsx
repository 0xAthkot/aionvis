"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Cloud, PlugZap, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import type { HardwareNode } from "@/lib/api/types";
import { useIntegrationsStore } from "@/lib/stores/integrations";

/**
 * The "paste your AMD key" card — live on the Hardware page and in
 * Settings → Integrations. Health-checks the node, persists the
 * credentials, and flips the whole console (REST + WebSockets) onto it.
 * Works from mock mode too: this is exactly how the MI300X attaches on
 * credential day, with zero env changes or rebuilds.
 */
export function ConnectNodeCard() {
  const store = useIntegrationsStore();
  const queryClient = useQueryClient();
  const [endpoint, setEndpoint] = useState(store.amdCloudEndpoint);
  const [token, setToken] = useState(store.amdCloudToken);
  const [busy, setBusy] = useState(false);

  const connected = store.amdCloudConnected;
  const awaitingCredentials = !connected && !endpoint.trim() && !token.trim();

  async function connect() {
    const base = endpoint.trim().replace(/\/+$/, "");
    if (!base) {
      toast.error("Enter the node's API endpoint first");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${base}/api/v1/hardware/nodes`, {
        headers: token.trim()
          ? { Authorization: `Bearer ${token.trim()}` }
          : {},
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 401)
        throw new Error(
          "The node rejected this API key — check AA_API_KEY in its backend/.env.",
        );
      if (!res.ok) throw new Error(`The node answered HTTP ${res.status}.`);
      const nodes = (await res.json()) as HardwareNode[];
      store.save({
        amdCloudEndpoint: base,
        amdCloudToken: token.trim(),
        amdCloudConnected: true,
      });
      // Every cached query was answered by the previous source — drop them
      // all so each screen refetches from the attached node.
      queryClient.clear();
      toast.success(`Attached to ${nodes[0]?.gpu ?? "the node"}`, {
        description: `${base} — every screen and live stream now reads this node.`,
      });
    } catch (err) {
      toast.error("Could not attach the node", {
        description:
          err instanceof Error && err.name !== "TimeoutError"
            ? err.message
            : "Unreachable — check the URL, that the backend is running, and that port 8000 is open.",
      });
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    store.save({ amdCloudConnected: false });
    queryClient.clear();
    toast.success("Node detached", {
      description: "The console is back on its local data source.",
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Cloud className="size-4 text-muted-foreground" />
              <CardTitle>Connect AMD Developer Cloud</CardTitle>
            </div>
            <CardDescription>
              Point the console at a GPU node running the aionVIS
              backend. Everything — runs, datasets, live agent streams —
              switches to it instantly; no rebuild.
            </CardDescription>
          </div>
          {connected ? (
            <Badge>Connected · {store.amdCloudEndpoint}</Badge>
          ) : awaitingCredentials ? (
            <Badge variant="outline">Awaiting credentials</Badge>
          ) : (
            <Badge variant="secondary">Not connected</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {awaitingCredentials && (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            Ready for your AMD key. When the MI300X credentials arrive: run{" "}
            <code className="font-mono text-xs">backend/deploy_mi300x.sh</code>{" "}
            on the node — it prints the endpoint URL and API key to paste
            here — then hit Connect.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="node-endpoint">API endpoint</Label>
            <Input
              id="node-endpoint"
              placeholder="http://<node-ip>:8000"
              value={endpoint}
              disabled={connected}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="node-token">
              API key{" "}
              <span className="text-muted-foreground">
                (AA_API_KEY — blank if the node runs open)
              </span>
            </Label>
            <Input
              id="node-token"
              type="password"
              placeholder="aa_node_…"
              value={token}
              disabled={connected}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            {connected ? (
              <Button variant="outline" onClick={disconnect}>
                <Unplug className="size-3.5" />
                Disconnect
              </Button>
            ) : (
              <Button onClick={connect} disabled={busy}>
                <PlugZap className="size-3.5" />
                {busy ? "Checking…" : "Connect"}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
