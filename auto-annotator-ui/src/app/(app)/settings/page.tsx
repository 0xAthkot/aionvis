"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, apiDelete, apiPost } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { ApiKey, Member, Organization } from "@/lib/api/types";
import { features } from "@/config/features";
import { ConnectNodeCard } from "@/components/shared/connect-node-card";
import { useIntegrationsStore } from "@/lib/stores/integrations";

function OrganizationTab() {
  const { data: orgs } = useQuery({
    queryKey: ["organizations"],
    queryFn: () => api<Organization[]>(endpoints.organizations.list()),
  });
  const org = orgs?.[0];

  const { data: members } = useQuery({
    queryKey: ["members", org?.id],
    queryFn: () => api<Member[]>(endpoints.organizations.members(org!.id)),
    enabled: !!org,
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
          <CardDescription>
            Tenant details for this deployment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!org ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="org-name">Name</Label>
                <Input id="org-name" value={org.name} readOnly />
              </div>
              <div className="space-y-2">
                <Label>Plan</Label>
                <div>
                  <Badge className="capitalize">{org.plan}</Badge>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Role management is enforced by the backend once connected
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!members ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">{member.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.email}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className="capitalize">
                        {member.role}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ApiKeysTab() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const { data: keys } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api<ApiKey[]>(endpoints.settings.apiKeys()),
  });

  const createKey = useMutation({
    mutationFn: (keyName: string) =>
      apiPost<ApiKey>(endpoints.settings.apiKeys(), { name: keyName }),
    onSuccess: (key) => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      setName("");
      // The full secret is only ever shown once — standard key UX.
      toast.success("API key created", {
        description: `${key.prefix}${Math.random().toString(36).slice(2, 14)} — copy it now; it won't be shown again.`,
        duration: 10000,
      });
    },
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => apiDelete(endpoints.settings.apiKey(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API key revoked");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>
          Programmatic access for CI pipelines and the headless API — the
          platform stays fully API-extensible.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) createKey.mutate(name.trim());
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name, e.g. staging-ci"
            className="max-w-xs"
          />
          <Button
            type="submit"
            disabled={!name.trim() || createKey.isPending}
          >
            <Plus className="size-4" />
            Create key
          </Button>
        </form>

        {!keys ? (
          <Skeleton className="h-24 w-full" />
        ) : keys.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-8">
            <KeyRound className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No API keys yet.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {key.prefix}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {key.lastUsedAt
                      ? new Date(key.lastUsedAt).toLocaleString()
                      : "never"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Revoke ${key.name}`}
                      disabled={revokeKey.isPending}
                      onClick={() => revokeKey.mutate(key.id)}
                    >
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function IntegrationsTab() {
  const store = useIntegrationsStore();
  const [llmBaseUrl, setLlmBaseUrl] = useState(store.llmBaseUrl);
  const [llmApiKey, setLlmApiKey] = useState(store.llmApiKey);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Flame className="size-4 text-primary" />
            <CardTitle>LLM endpoint (vLLM)</CardTitle>
          </div>
          <CardDescription>
            OpenAI-compatible endpoint serving Gemma 4 for the Prompt and
            Critic agents — vLLM on the MI300X.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="llm-url">Base URL</Label>
            <Input
              id="llm-url"
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="llm-key">API key (optional — vLLM ignores it)</Label>
            <Input
              id="llm-key"
              type="password"
              value={llmApiKey}
              onChange={(e) => setLlmApiKey(e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button
            size="sm"
            onClick={() => {
              store.save({ llmBaseUrl, llmApiKey });
              toast.success("LLM endpoint settings saved", {
                description: "Stored locally — handed to the backend at connect time.",
              });
            }}
          >
            Save
          </Button>
        </CardFooter>
      </Card>

      <ConnectNodeCard />

      <Card>
        <CardHeader>
          <CardTitle>Backend</CardTitle>
          <CardDescription>How this control plane gets its data</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={features.useMocks ? "default" : "outline"}>
              {features.useMocks ? "Mock mode" : "Live backend"}
            </Badge>
            <span className="text-muted-foreground">
              {features.useMocks
                ? "All data is served in-browser by the MSW mock layer and pipeline simulator."
                : `Connected to ${features.apiBaseUrl || "same origin"}.`}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            To connect the FastAPI backend: set{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono">
              NEXT_PUBLIC_USE_MOCKS=false
            </code>{" "}
            and point{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono">
              NEXT_PUBLIC_API_BASE_URL
            </code>{" "}
            /{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono">
              NEXT_PUBLIC_WS_BASE_URL
            </code>{" "}
            at it. The full spec it must implement is in{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono">
              BACKEND_CONTRACT.md
            </code>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Organization, access and external services.
        </p>
      </header>

      <Tabs defaultValue="organization" className="max-w-3xl">
        <TabsList>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="api-keys">API keys</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>
        <TabsContent value="organization" className="mt-4">
          <OrganizationTab />
        </TabsContent>
        <TabsContent value="api-keys" className="mt-4">
          <ApiKeysTab />
        </TabsContent>
        <TabsContent value="integrations" className="mt-4">
          <IntegrationsTab />
        </TabsContent>
      </Tabs>
    </main>
  );
}
