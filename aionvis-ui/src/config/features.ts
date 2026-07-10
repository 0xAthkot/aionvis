/**
 * Runtime feature flags for the Control Plane.
 *
 * The UI is built frontend-first: every data source goes through the typed
 * contract in `src/lib/api`. Flipping `useMocks` off (and pointing
 * `apiBaseUrl` / `wsBaseUrl` at the FastAPI backend) is the intended way to
 * "connect" the real backend later — no component changes required.
 */
export const features = {
  /** Serve all API traffic from the in-browser MSW mock layer. */
  useMocks: process.env.NEXT_PUBLIC_USE_MOCKS !== "false",

  /** Base URL of the future FastAPI backend. Empty = same origin. */
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "",

  /** Base URL of the future WebSocket server (e.g. ws://localhost:8000). */
  wsBaseUrl: process.env.NEXT_PUBLIC_WS_BASE_URL ?? "",
} as const;
