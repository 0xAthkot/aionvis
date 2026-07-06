import { features } from "@/config/features";
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
 * Thin typed fetch wrapper. All TanStack Query hooks go through this, so the
 * mock→real backend swap is just `NEXT_PUBLIC_API_BASE_URL` + auth headers.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${features.apiBaseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
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
