/**
 * External-service configuration, persisted to localStorage. Today these are
 * inert placeholders; when the backend lands they become the real endpoints
 * the control plane hands to it during setup.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface IntegrationsState {
  llmBaseUrl: string;
  llmApiKey: string;
  amdCloudEndpoint: string;
  amdCloudToken: string;
  save: (patch: Partial<Omit<IntegrationsState, "save">>) => void;
}

export const useIntegrationsStore = create<IntegrationsState>()(
  persist(
    (set) => ({
      llmBaseUrl: "http://localhost:8001/v1",
      llmApiKey: "",
      amdCloudEndpoint: "",
      amdCloudToken: "",
      save: (patch) => set(patch),
    }),
    { name: "aa-integrations" },
  ),
);
