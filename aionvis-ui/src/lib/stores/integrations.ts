/**
 * External-service configuration, persisted to localStorage.
 *
 * The AMD Developer Cloud fields are LIVE: when `amdCloudConnected` is true,
 * the API client (`src/lib/api/remote.ts`) routes every request and
 * WebSocket to `amdCloudEndpoint` with `amdCloudToken` as the AA_API_KEY —
 * that's how a remote MI300X node attaches at runtime, no env flip needed.
 * The LLM fields remain informational (the backend reads its own .env).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface IntegrationsState {
  llmBaseUrl: string;
  llmApiKey: string;
  amdCloudEndpoint: string;
  amdCloudToken: string;
  /** True once the endpoint answered a health check; routes all traffic. */
  amdCloudConnected: boolean;
  save: (patch: Partial<Omit<IntegrationsState, "save">>) => void;
}

export const useIntegrationsStore = create<IntegrationsState>()(
  persist(
    (set) => ({
      llmBaseUrl: "http://localhost:8001/v1",
      llmApiKey: "",
      amdCloudEndpoint: "",
      amdCloudToken: "",
      amdCloudConnected: false,
      save: (patch) => set(patch),
    }),
    { name: "aa-integrations" },
  ),
);
