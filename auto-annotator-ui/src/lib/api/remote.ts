/**
 * Runtime remote-backend resolution — the "paste your AMD key" path.
 *
 * When the user attaches a GPU node (Hardware page → Connect AMD Developer
 * Cloud), the endpoint + API key live in the integrations store and every
 * request resolves here at call time. This works even with mocks on:
 * absolute URLs to another origin never match MSW's relative handlers, so
 * remote traffic passes straight through the service worker.
 */
import { useIntegrationsStore } from "@/lib/stores/integrations";

export interface RemoteBackend {
  /** e.g. "http://129.x.x.x:8000" — no trailing slash. */
  apiBase: string;
  /** Same host over ws(s). */
  wsBase: string;
  /** AA_API_KEY of the node; empty when the node runs open. */
  apiKey: string;
}

/** The attached node, or null when running on env config / mocks. */
export function remoteBackend(): RemoteBackend | null {
  const s = useIntegrationsStore.getState();
  if (!s.amdCloudConnected || !s.amdCloudEndpoint) return null;
  const apiBase = s.amdCloudEndpoint.trim().replace(/\/+$/, "");
  return {
    apiBase,
    wsBase: apiBase.replace(/^http/, "ws"),
    apiKey: s.amdCloudToken.trim(),
  };
}

/** Auth headers for a REST call against the attached node. */
export function remoteHeaders(remote: RemoteBackend): Record<string, string> {
  return remote.apiKey ? { Authorization: `Bearer ${remote.apiKey}` } : {};
}
