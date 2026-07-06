/**
 * Pipeline simulator — the mock implementation of the run-events WebSocket.
 *
 * One simulator per active run walks the stage state machine on a timer,
 * emitting the same `RunStreamEvent` messages the real backend will send,
 * while mutating the mock DB so REST reads stay consistent with the stream.
 * On completion it mints the dataset and model artifacts the run promised.
 *
 * It also drives `gpuLoad`, a shared load model the mock telemetry stream
 * eases toward — so VRAM charts everywhere dip at `hip.empty_cache()`
 * boundaries and spike during synthesis/training, exactly like the pitch.
 */
import type {
  RunStreamEvent,
  StreamSource,
  StreamState,
} from "@/lib/api/streams";
import type {
  AgentInstance,
  AgentKind,
  LogEvent,
  LogLevel,
  PipelineRun,
  PipelineStage,
} from "@/lib/api/types";
import { db, nextId } from "./db";
import { datasetClassesFrom, generateAnnotatedImages } from "./fixtures/generators";
import { trainingCurves } from "./fixtures/seed";

// ---------------------------------------------------------------------------
// Shared GPU load model (read by MockTelemetryStream)
// ---------------------------------------------------------------------------

export const gpuLoad = {
  vramGb: 9,
  utilPct: 4,
  /** it/s during training, img/s during synthesis, 0 otherwise. */
  throughput: 0,
  throughputKind: "it_per_s" as "it_per_s" | "img_per_s",
};

function setGpuLoad(vramGb: number, utilPct: number, throughput = 0, kind: "it_per_s" | "img_per_s" = "it_per_s") {
  gpuLoad.vramGb = vramGb;
  gpuLoad.utilPct = utilPct;
  gpuLoad.throughput = throughput;
  gpuLoad.throughputKind = kind;
}

// ---------------------------------------------------------------------------
// Simulator registry
// ---------------------------------------------------------------------------

const simulators = new Map<string, RunSimulator>();

/** Returns (creating if needed) the simulator for a queued/running run. */
export function getRunSimulator(runId: string): RunSimulator | undefined {
  const existing = simulators.get(runId);
  if (existing) return existing;
  const run = db.runs.find((r) => r.id === runId);
  if (!run || (run.status !== "queued" && run.status !== "running"))
    return undefined;
  const sim = new RunSimulator(run);
  simulators.set(runId, sim);
  return sim;
}

/** Live agent states for the REST agents endpoint, when a simulator exists. */
export function getSimulatedAgents(runId: string): AgentInstance[] | undefined {
  return simulators.get(runId)?.agents;
}

// ---------------------------------------------------------------------------
// Stage plans
// ---------------------------------------------------------------------------

const TICK_MS = 450;

interface StagePlan {
  stage: PipelineStage;
  ticks: number;
  /** Contribution to overall progress pct. */
  weight: number;
}

function planFor(run: PipelineRun): StagePlan[] {
  const synthetic = run.path === "synthetic";
  return [
    ...(synthetic
      ? [
          { stage: "prompt_expansion" as const, ticks: 14, weight: 5 },
          { stage: "synthesis" as const, ticks: 55, weight: 25 },
        ]
      : []),
    { stage: "segmentation" as const, ticks: 45, weight: synthetic ? 22 : 32 },
    { stage: "critic_review" as const, ticks: 25, weight: synthetic ? 13 : 18 },
    { stage: "dataset_compile" as const, ticks: 8, weight: 5 },
    { stage: "training" as const, ticks: 60, weight: synthetic ? 30 : 40 },
  ];
}

const AGENT_ROSTER: Record<
  AgentKind,
  { displayName: string; model: string; provider: string }
> = {
  prompt: { displayName: "Prompt Agent", model: "Gemma 4", provider: "Fireworks AI" },
  synthesis: { displayName: "Synthesis Agent", model: "SDXL", provider: "MI300X · local" },
  vision: { displayName: "Vision Agent", model: "SAM 3", provider: "MI300X · local" },
  critic: { displayName: "Critic Agent", model: "Gemma 4 + OpenCV", provider: "Fireworks AI" },
  mlops: { displayName: "MLOps Agent", model: "YOLOv10 · PyTorch", provider: "MI300X · ROCm" },
};

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const randInt = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1));

// ---------------------------------------------------------------------------
// The simulator
// ---------------------------------------------------------------------------

export class RunSimulator {
  readonly agents: AgentInstance[];
  private handlers = new Set<(event: RunStreamEvent) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private plan: StagePlan[];
  private stageIdx = 0;
  private tick = 0;
  private started = false;

  constructor(private run: PipelineRun) {
    this.plan = planFor(run);
    const kinds: AgentKind[] =
      run.path === "synthetic"
        ? ["prompt", "synthesis", "vision", "critic", "mlops"]
        : ["vision", "critic", "mlops"];
    this.agents = kinds.map((kind) => ({
      id: `${run.id}_${kind}`,
      runId: run.id,
      kind,
      state: "idle",
      ...AGENT_ROSTER[kind],
    }));
    // A seeded mid-flight run resumes from its persisted stage.
    const resumeIdx = this.plan.findIndex((p) => p.stage === run.stage);
    if (run.status === "running" && resumeIdx >= 0) this.stageIdx = resumeIdx;
  }

  attach(handler: (event: RunStreamEvent) => void): () => void {
    this.handlers.add(handler);
    this.start();
    return () => this.handlers.delete(handler);
  }

  private emit(event: RunStreamEvent) {
    this.handlers.forEach((h) => h(event));
  }

  private start() {
    if (this.started) return;
    this.started = true;

    if (this.run.status === "queued") {
      this.run.status = "running";
      this.run.startedAt = new Date().toISOString();
      db.dashboardStats.queuedRuns = Math.max(0, db.dashboardStats.queuedRuns - 1);
      db.dashboardStats.activeRuns += 1;
      this.emit({ kind: "status", payload: { runId: this.run.id, status: "running" } });
      this.log("info", undefined, `Run accepted — scheduling agent swarm on ${this.run.training.device}`);
    }
    this.enterStage(this.plan[this.stageIdx].stage);
    this.timer = setInterval(() => this.onTick(), TICK_MS);
  }

  private stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  // -- event helpers ---------------------------------------------------------

  private log(level: LogLevel, agent: AgentKind | undefined, message: string) {
    const event: LogEvent = {
      id: nextId("log"),
      runId: this.run.id,
      at: new Date().toISOString(),
      level,
      agent,
      message,
    };
    db.runLogs.push(event);
    // Cap per-run history so a long session can't grow unbounded.
    const mine = db.runLogs.filter((l) => l.runId === this.run.id);
    if (mine.length > 500) {
      const cutoff = mine[mine.length - 500].at;
      for (let i = db.runLogs.length - 1; i >= 0; i--) {
        if (db.runLogs[i].runId === this.run.id && db.runLogs[i].at < cutoff)
          db.runLogs.splice(i, 1);
      }
    }
    this.emit({ kind: "log", payload: event });
  }

  private setAgent(kind: AgentKind, state: AgentInstance["state"], task?: string) {
    const agent = this.agents.find((a) => a.kind === kind);
    if (!agent) return;
    agent.state = state;
    agent.currentTask = task;
    this.emit({ kind: "agent", payload: { ...agent } });
  }

  private progress(patch: Partial<PipelineRun["progress"]>) {
    Object.assign(this.run.progress, patch);
    this.run.progress.pct = this.overallPct();
    this.emit({ kind: "progress", payload: { ...this.run.progress } });
  }

  private overallPct(): number {
    const done = this.plan
      .slice(0, this.stageIdx)
      .reduce((sum, p) => sum + p.weight, 0);
    const current = this.plan[this.stageIdx];
    const frac = current ? Math.min(1, this.tick / current.ticks) : 1;
    return Math.min(99, Math.round(done + (current?.weight ?? 0) * frac));
  }

  // -- stage machine ----------------------------------------------------------

  private onTick() {
    // An operator may have cancelled via REST while we were running.
    if (this.run.status === "cancelled") {
      this.stop();
      this.agents.forEach((a) => this.setAgent(a.kind, "idle"));
      setGpuLoad(9, 4);
      db.dashboardStats.activeRuns = Math.max(0, db.dashboardStats.activeRuns - 1);
      this.log("warn", undefined, "Run cancelled by operator — releasing GPU");
      return;
    }

    this.tick++;
    const stage = this.plan[this.stageIdx];
    this.tickStage(stage.stage);

    if (this.tick >= stage.ticks) {
      this.exitStage(stage.stage);
      this.stageIdx++;
      this.tick = 0;
      if (this.stageIdx >= this.plan.length) {
        this.finish();
      } else {
        const next = this.plan[this.stageIdx].stage;
        this.transition(stage.stage, next);
        this.enterStage(next);
      }
    }
  }

  private transition(from: PipelineStage, to: PipelineStage) {
    this.run.stage = to;
    this.emit({
      kind: "stage",
      payload: { runId: this.run.id, from, to, at: new Date().toISOString() },
    });
  }

  private enterStage(stage: PipelineStage) {
    const total = this.run.progress.imagesTotal;
    switch (stage) {
      case "prompt_expansion":
        this.log("stage", undefined, "━━ STAGE: PROMPT EXPANSION — Prompt Agent taking over ━━");
        this.setAgent("prompt", "thinking", "Expanding base prompt with domain randomization");
        setGpuLoad(12, 8);
        this.log("info", "prompt", `Requesting Gemma 4 via Fireworks AI · target: ${total} scenarios`);
        break;
      case "synthesis":
        this.log("stage", undefined, "━━ STAGE: SYNTHESIS — Synthesis Agent taking over ━━");
        this.setAgent("prompt", "done");
        this.setAgent("synthesis", "working", `Generating ${total} images (SDXL fp16)`);
        setGpuLoad(52, 96, 3.4, "img_per_s");
        this.log("info", "synthesis", "Loading SDXL UNet + VAE (6.9 GB fp16) onto MI300X");
        break;
      case "segmentation":
        this.log("stage", undefined, "━━ STAGE: SEGMENTATION — Vision Agent taking over ━━");
        this.setAgent("synthesis", "done");
        this.log("gpu", "mlops", `hip.empty_cache() — VRAM flushed ${gpuLoad.vramGb.toFixed(1)} GB → 7.1 GB before SAM 3 load`);
        this.setAgent("vision", "working", "Zero-shot segmentation with SAM 3");
        setGpuLoad(64, 88);
        this.log("info", "vision", "Loading SAM 3 checkpoint (sam3_h.pt, 14.1 GB)");
        this.log("info", "vision", `Zero-shot prompt set: [${this.run.targetClasses.map((c) => `'${c.replace(/_/g, " ")}'`).join(", ")}]`);
        break;
      case "critic_review":
        this.log("stage", undefined, "━━ STAGE: CRITIC REVIEW — Critic Agent taking over ━━");
        this.setAgent("vision", "done");
        this.setAgent("critic", "thinking", "Verifying mask geometry with OpenCV");
        setGpuLoad(32, 46);
        this.log("info", "critic", "Geometric verification: IoU threshold 0.85, min box area 24 px²");
        break;
      case "dataset_compile":
        this.log("stage", undefined, "━━ STAGE: DATASET COMPILE — MLOps Agent taking over ━━");
        this.setAgent("critic", "done");
        this.setAgent("mlops", "working", "Compiling YOLO dataset");
        setGpuLoad(14, 12);
        break;
      case "training":
        this.log("stage", undefined, "━━ STAGE: TRAINING — MLOps Agent taking over ━━");
        this.log("gpu", "mlops", `hip.empty_cache() — VRAM flushed ${gpuLoad.vramGb.toFixed(1)} GB → 6.4 GB before training`);
        this.setAgent("mlops", "working", `Training ${this.run.training.architecture.toUpperCase()} · ${this.run.training.epochs} epochs`);
        setGpuLoad(128, 97, 3.1, "it_per_s");
        this.log("info", "mlops", `torch.compile(model, backend="inductor") on ROCm ${db.hardwareNodes[0].rocmVersion}`);
        break;
      default:
        break;
    }
  }

  private tickStage(stage: PipelineStage) {
    const p = this.run.progress;
    const plan = this.plan[this.stageIdx];
    const total = p.imagesTotal;

    switch (stage) {
      case "prompt_expansion": {
        if (this.tick % 3 === 0) {
          const n = Math.round((this.tick / plan.ticks) * total);
          this.log("info", "prompt", `Expanded ${n}/${total} scenarios · varying lighting, optics, occlusion`);
        }
        this.progress({});
        break;
      }
      case "synthesis": {
        const generated = Math.min(total, Math.round((this.tick / plan.ticks) * total));
        if (this.tick % 4 === 0) {
          this.log("info", "synthesis", `Batch ${Math.ceil(this.tick / 4)} · ${generated}/${total} images · ${rand(3.1, 3.7).toFixed(1)} img/s · CFG ${this.run.source.path === "synthetic" ? this.run.source.randomization.guidanceScale : 7.5}`);
        }
        this.progress({ imagesGenerated: generated });
        break;
      }
      case "segmentation": {
        if (this.tick % 3 === 0) {
          const idx = randInt(0, total - 1);
          this.log("info", "vision", `img_${String(idx).padStart(4, "0")}.png → ${randInt(1, 4)} masks in ${randInt(85, 240)} ms`);
        }
        this.progress({});
        break;
      }
      case "critic_review": {
        const target = Math.round(total * 0.92);
        const accepted = Math.min(target, Math.round((this.tick / plan.ticks) * target));
        const rejected = Math.round(accepted * 0.085);
        if (this.tick % 3 === 1) {
          const idx = randInt(0, total - 1);
          const img = `img_${String(idx).padStart(4, "0")}.png`;
          if (Math.random() < 0.25) {
            const iou = rand(0.3, 0.8).toFixed(2);
            this.log("critic", "critic", `REJECT ${img}: mask IoU ${iou} < 0.85 — queued for regeneration`);
          } else {
            const iou = rand(0.86, 0.98).toFixed(2);
            this.log("critic", "critic", `ACCEPT ${img}: IoU ${iou} — converted to YOLO bbox [${rand(0.2, 0.7).toFixed(2)}, ${rand(0.2, 0.7).toFixed(2)}, ${rand(0.08, 0.3).toFixed(2)}, ${rand(0.08, 0.3).toFixed(2)}]`);
          }
        }
        this.progress({ masksAccepted: accepted, masksRejected: rejected });
        break;
      }
      case "dataset_compile": {
        const steps = [
          "Writing YOLO label files (normalized xywh)",
          "Train/val split 80/20 · stratified by class",
          "Generating dataset.yaml",
          "Class balance check passed",
        ];
        if (this.tick % 2 === 0 && steps[this.tick / 2 - 1])
          this.log("info", "mlops", steps[this.tick / 2 - 1]);
        this.progress({});
        break;
      }
      case "training": {
        const epochs = this.run.training.epochs;
        const epoch = Math.max(1, Math.min(epochs, Math.ceil((this.tick / plan.ticks) * epochs)));
        const t = epoch / epochs;
        const boxLoss = 2.6 * Math.exp(-2.4 * t) + 0.35 + rand(-0.03, 0.03);
        const clsLoss = 3.1 * Math.exp(-2.8 * t) + 0.28 + rand(-0.03, 0.03);
        if (this.tick % 3 === 0) {
          this.log("info", "mlops", `Epoch ${epoch}/${epochs} · box_loss ${boxLoss.toFixed(3)} · cls_loss ${clsLoss.toFixed(3)} · ${rand(2.9, 3.3).toFixed(1)} it/s`);
        }
        if (this.tick % 12 === 0) {
          const map50 = 0.91 * (1 - Math.exp(-3.2 * t));
          this.log("info", "mlops", `val: mAP50 ${map50.toFixed(3)} · mAP50-95 ${(map50 * 0.75).toFixed(3)}`);
        }
        this.progress({ currentEpoch: epoch, latestLoss: +(boxLoss + clsLoss).toFixed(3) });
        break;
      }
      default:
        break;
    }
  }

  private exitStage(stage: PipelineStage) {
    const total = this.run.progress.imagesTotal;
    switch (stage) {
      case "prompt_expansion":
        this.log("info", "prompt", `Expansion complete — ${total} scenario prompts staged`);
        break;
      case "synthesis":
        this.progress({ imagesGenerated: total });
        this.log("info", "synthesis", `Synthesis complete — ${total} images written to /data/runs/${this.run.id}/raw`);
        break;
      case "segmentation":
        this.log("info", "vision", `Segmentation complete — masks proposed for ${total} images`);
        break;
      case "critic_review": {
        const rate = ((this.run.progress.masksRejected / Math.max(1, this.run.progress.masksAccepted + this.run.progress.masksRejected)) * 100).toFixed(1);
        this.log("critic", "critic", `Quality gate PASSED — reject rate ${rate}% < 20% threshold`);
        break;
      }
      case "dataset_compile":
        this.log("info", "mlops", "Dataset compiled and frozen — handing off to trainer");
        break;
      case "training":
        this.progress({ currentEpoch: this.run.training.epochs });
        break;
      default:
        break;
    }
  }

  // -- completion -------------------------------------------------------------

  private finish() {
    this.stop();
    const run = this.run;
    const map50 = +rand(0.87, 0.94).toFixed(3);
    const map5095 = +(map50 * rand(0.72, 0.78)).toFixed(3);

    // Dataset artifact
    let datasetId: string | undefined =
      run.source.path === "byod" ? run.source.datasetId : undefined;
    const instances = Math.round(run.progress.imagesTotal * 1.6);
    if (run.path === "synthetic") {
      datasetId = nextId("ds");
      db.datasets.unshift({
        id: datasetId,
        orgId: run.orgId,
        projectId: run.projectId,
        name: `${run.name.split("·")[0].trim().replace(/\s+/g, "-")}-synth-${datasetId.slice(-4)}`,
        origin: "synthetic",
        status: "ready",
        imageCount: run.progress.imagesTotal,
        labeledCount: run.progress.masksAccepted,
        classes: datasetClassesFrom(run.targetClasses, instances),
        sizeMb: Math.round(run.progress.imagesTotal * 2.4),
        createdAt: new Date().toISOString(),
        runId: run.id,
      });
      db.annotatedImages.push(...generateAnnotatedImages(datasetId, run.targetClasses, 24, run.progress.imagesTotal));
      db.dashboardStats.imagesGenerated += run.progress.imagesTotal;
    } else if (datasetId) {
      const dataset = db.datasets.find((d) => d.id === datasetId);
      if (dataset) {
        dataset.status = "ready";
        dataset.labeledCount = run.progress.masksAccepted;
        dataset.classes = datasetClassesFrom(run.targetClasses, instances);
        dataset.runId = run.id;
        if (!db.annotatedImages.some((img) => img.datasetId === dataset.id)) {
          db.annotatedImages.push(...generateAnnotatedImages(dataset.id, run.targetClasses, 24, 1000));
        }
      }
    }

    // Model artifact
    const modelId = nextId("mdl");
    const baseName = run.name.split("·")[0].trim().replace(/\s+/g, "-");
    const priorVersions = db.models.filter((m) => m.name === baseName).length;
    db.models.unshift({
      id: modelId,
      orgId: run.orgId,
      runId: run.id,
      datasetId: datasetId ?? "",
      name: baseName,
      version: priorVersions + 1,
      architecture: run.training.architecture,
      fileName: `${baseName}_v${priorVersions + 1}_${run.training.architecture}.pt`,
      fileSizeMb: +rand(15, 34).toFixed(1),
      classes: run.targetClasses,
      metrics: {
        map50,
        map5095,
        precision: +rand(0.9, 0.96).toFixed(3),
        recall: +rand(0.84, 0.91).toFixed(3),
        epochsRun: run.training.epochs,
        trainingTimeMin: randInt(18, 42),
      },
      curves: trainingCurves(run.training.epochs, map50, map5095),
      trainedOn: {
        nodeName: db.hardwareNodes[0].name,
        gpu: db.hardwareNodes[0].gpu,
        vramGb: db.hardwareNodes[0].vramGb,
        rocmVersion: db.hardwareNodes[0].rocmVersion,
      },
      status: "ready",
      createdAt: new Date().toISOString(),
    });

    // Run bookkeeping
    run.status = "succeeded";
    run.stage = "complete";
    run.finishedAt = new Date().toISOString();
    run.datasetId = datasetId;
    run.modelId = modelId;
    run.progress.pct = 100;

    db.dashboardStats.activeRuns = Math.max(0, db.dashboardStats.activeRuns - 1);
    db.dashboardStats.modelsTrained += 1;
    db.dashboardStats.imagesLabeled += run.progress.masksAccepted;
    db.dashboardStats.gpuHoursUsed = +(db.dashboardStats.gpuHoursUsed + rand(0.4, 0.9)).toFixed(1);

    this.setAgent("mlops", "done");
    setGpuLoad(9, 4);
    this.log("gpu", "mlops", "hip.empty_cache() — VRAM released, node returned to pool");
    this.log("info", "mlops", `Training complete — best.pt saved · mAP50 ${map50} · mAP50-95 ${map5095}`);
    this.log("stage", undefined, "━━ RUN COMPLETE — model registered in the Model Registry ━━");

    this.emit({ kind: "progress", payload: { ...run.progress } });
    this.emit({ kind: "stage", payload: { runId: run.id, from: "training", to: "complete", at: new Date().toISOString() } });
    this.emit({ kind: "status", payload: { runId: run.id, status: "succeeded" } });
  }
}

// ---------------------------------------------------------------------------
// StreamSource adapter
// ---------------------------------------------------------------------------

export class MockRunStream implements StreamSource<RunStreamEvent> {
  state: StreamState = "open";
  private detachers: (() => void)[] = [];

  constructor(private runId: string) {}

  subscribe(handler: (event: RunStreamEvent) => void): () => void {
    const sim = getRunSimulator(this.runId);
    if (!sim) return () => {};
    const detach = sim.attach(handler);
    this.detachers.push(detach);
    return detach;
  }

  close(): void {
    this.detachers.forEach((d) => d());
    this.detachers = [];
    this.state = "closed";
  }
}
