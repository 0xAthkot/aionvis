/**
 * External-service configuration, persisted to localStorage. Today these are
 * inert placeholders; when the backend lands they become the real endpoints
 * the control plane hands to it during setup.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface IntegrationsState {
  fireworksBaseUrl: string;
  fireworksApiKey: string;
  amdCloudEndpoint: string;
  amdCloudToken: string;
  save: (patch: Partial<Omit<IntegrationsState, "save">>) => void;
}

export const useIntegrationsStore = create<IntegrationsState>()(
  persist(
    (set) => ({
      fireworksBaseUrl: "https://api.fireworks.ai/inference/v1",
      fireworksApiKey: "",
      amdCloudEndpoint: "",
      amdCloudToken: "",
      save: (patch) => set(patch),
    }),
    { name: "aa-integrations" },
  ),
);
