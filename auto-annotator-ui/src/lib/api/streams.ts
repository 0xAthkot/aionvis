/**
 * Streaming contract for live run events and hardware telemetry.
 *
 * Components consume `StreamSource` only. Today the factories return mock
 * (timer-driven) sources; when the FastAPI backend lands, `WsStreamSource`
 * connects to the routes in `wsEndpoints` with zero component changes.
 */
import { features } from "@/config/features";
import { MockRunStream } from "@/lib/mocks/simulator";
import { MockTelemetryStream } from "@/lib/mocks/telemetry-stream";
import { wsEndpoints } from "./endpoints";
import type {
  AgentInstance,
  LogEvent,
  RunProgress,
  RunStatus,
  StageTransition,
  TelemetrySample,
} from "./types";

// ---------------------------------------------------------------------------
// Event unions — these are the exact JSON message shapes the backend
// WebSockets must emit.
// ---------------------------------------------------------------------------

export type RunStreamEvent =
  | { kind: "log"; payload: LogEvent }
  | { kind: "stage"; payload: StageTransition }
  | { kind: "agent"; payload: AgentInstance }
  | { kind: "progress"; payload: RunProgress }
  | { kind: "status"; payload: { runId: string; status: RunStatus } };

export type TelemetryStreamEvent = {
  kind: "telemetry";
  payload: TelemetrySample;
};

export type StreamState = "connecting" | "open" | "closed";

export interface StreamSource<E> {
  /** Register a handler; returns an unsubscribe function. */
  subscribe(handler: (event: E) => void): () => void;
  close(): void;
  readonly state: StreamState;
}

// ---------------------------------------------------------------------------
// Real implementation (used once the backend exists)
// ---------------------------------------------------------------------------

export class WsStreamSource<E> implements StreamSource<E> {
  private handlers = new Set<(event: E) => void>();
  private ws: WebSocket;
  state: StreamState = "connecting";

  constructor(path: string) {
    this.ws = new WebSocket(`${features.wsBaseUrl}${path}`);
    this.ws.onopen = () => (this.state = "open");
    this.ws.onclose = () => (this.state = "closed");
    this.ws.onmessage = (msg) => {
      const event = JSON.parse(msg.data as string) as E;
      this.handlers.forEach((h) => h(event));
    };
  }

  subscribe(handler: (event: E) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.ws.close();
    this.state = "closed";
  }
}

// ---------------------------------------------------------------------------
// Factories — the only place that knows whether streams are mocked
// ---------------------------------------------------------------------------

export function createRunStream(runId: string): StreamSource<RunStreamEvent> {
  if (features.useMocks) {
    return new MockRunStream(runId);
  }
  return new WsStreamSource<RunStreamEvent>(wsEndpoints.runEvents(runId));
}

export function createTelemetryStream(
  nodeId: string,
): StreamSource<TelemetryStreamEvent> {
  if (features.useMocks) {
    return new MockTelemetryStream(nodeId);
  }
  return new WsStreamSource<TelemetryStreamEvent>(wsEndpoints.telemetry(nodeId));
}
