/**
 * Timer-driven mock of the hardware telemetry WebSocket. Emits one sample per
 * second, easing toward the shared `gpuLoad` model that the pipeline
 * simulator drives — so telemetry everywhere reflects what the agents are
 * doing (VRAM flushes between stages, training spikes, idle when done).
 */
import type { StreamSource, StreamState, TelemetryStreamEvent } from "@/lib/api/streams";
import { gpuLoad } from "./simulator";

export class MockTelemetryStream implements StreamSource<TelemetryStreamEvent> {
  private handlers = new Set<(event: TelemetryStreamEvent) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private tick = 0;
  private vram = gpuLoad.vramGb;
  private util = gpuLoad.utilPct;
  state: StreamState = "open";

  constructor(private nodeId: string) {
    this.timer = setInterval(() => this.emit(), 1000);
  }

  private emit() {
    this.tick++;
    // Ease toward the simulator's target load, with sensor wobble on top.
    this.vram += (gpuLoad.vramGb - this.vram) * 0.25;
    this.util += (gpuLoad.utilPct - this.util) * 0.3;
    const wobble = Math.sin(this.tick * 0.6) + Math.sin(this.tick * 0.13) * 0.6;
    const spike = this.util > 60 && this.tick % 37 < 3 ? 1 : 0;

    const event: TelemetryStreamEvent = {
      kind: "telemetry",
      payload: {
        nodeId: this.nodeId,
        at: new Date().toISOString(),
        vramUsedGb: +Math.max(4, this.vram + wobble * 2 + spike * 14).toFixed(1),
        vramTotalGb: 192,
        gpuUtilPct: Math.round(Math.min(100, Math.max(1, this.util + wobble * 2 + spike * 6))),
        tempC: Math.round(40 + (this.util / 100) * 34 + wobble * 2),
        powerW: Math.round(130 + (this.util / 100) * 580 + wobble * 20),
        throughput:
          gpuLoad.throughput > 0
            ? {
                kind: gpuLoad.throughputKind,
                value: +(gpuLoad.throughput + wobble * 0.12).toFixed(2),
              }
            : undefined,
      },
    };
    this.handlers.forEach((h) => h(event));
  }

  subscribe(handler: (event: TelemetryStreamEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    clearInterval(this.timer);
    this.handlers.clear();
    this.state = "closed";
  }
}
