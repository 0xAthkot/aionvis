/**
 * Attach a GPU node — the "sign in with your AMD Developer Cloud droplet"
 * primitive. Health-checks the endpoint with the given key, persists the
 * credentials to the integrations store, and returns the node so callers
 * can greet the user. The node's AA_API_KEY is the credential: a bad key
 * is rejected here, before anything is persisted.
 *
 * Callers that hold react-query state must `queryClient.clear()` after a
 * successful attach (or a detach) so every screen refetches from the new
 * source.
 */
import type { HardwareNode } from "@/lib/api/types";
import { useIntegrationsStore } from "@/lib/stores/integrations";

export async function attachNode(
  endpoint: string,
  token: string,
): Promise<HardwareNode | undefined> {
  const base = endpoint.trim().replace(/\/+$/, "");
  if (!base) throw new Error("Enter the node's API endpoint first.");
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/hardware/nodes`, {
      headers: token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {},
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error(
      "Unreachable — check the URL, that the backend is running, and that the port is open.",
    );
  }
  if (res.status === 401)
    throw new Error(
      "The node rejected this API key — check AA_API_KEY in its backend/.env.",
    );
  if (!res.ok) throw new Error(`The node answered HTTP ${res.status}.`);
  const nodes = (await res.json()) as HardwareNode[];
  useIntegrationsStore.getState().save({
    amdCloudEndpoint: base,
    amdCloudToken: token.trim(),
    amdCloudConnected: true,
  });
  return nodes[0];
}

export function detachNode(): void {
  useIntegrationsStore.getState().save({ amdCloudConnected: false });
}
