import { features } from "@/config/features";
import { remoteBackend, remoteHeaders } from "./remote";
import type { ApiErrorBody } from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Thin typed fetch wrapper. All TanStack Query hooks go through this. The
 * base URL resolves per call: an attached AMD node (Hardware page →
 * Connect) wins over `NEXT_PUBLIC_API_BASE_URL`, and carries its API key —
 * so a remote MI300X plugs in at runtime with no rebuild.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const remote = remoteBackend();
  // FormData bodies must set their own multipart boundary header.
  const isForm = init?.body instanceof FormData;
  const res = await fetch(`${remote?.apiBase ?? features.apiBaseUrl}${path}`, {
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(remote ? remoteHeaders(remote) : {}),
      ...init?.headers,
    },
    ...init,
  });

  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = await res.json();
    } catch {
      // non-JSON error body
    }
    throw new ApiError(
      res.status,
      body.code ?? "unknown_error",
      body.message ?? `Request failed: ${res.status} ${res.statusText}`,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const apiDelete = (path: string): Promise<void> =>
  api<void>(path, { method: "DELETE" });

export const apiPost = <T>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });

export const apiPatch = <T>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export const apiUpload = <T>(path: string, form: FormData): Promise<T> =>
  api<T>(path, { method: "POST", body: form });
