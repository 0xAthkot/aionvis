/**
 * Seed data for the mock backend. Deliberately "lived-in": a corporate tenant
 * with past runs, one live run, datasets in different states, and two trained
 * models — so every screen has something real-looking to render from day one.
 */
import type {
  AnnotatedImage,
  ApiKey,
  DashboardStats,
  Dataset,
  HardwareNode,
  LogEvent,
  Member,
  ModelArtifact,
  Organization,
  PipelineRun,
  Project,
  TelemetrySample,
  TrainingCurvePoint,
} from "@/lib/api/types";
import { placeholderImage } from "./placeholder";

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
const daysAgo = (d: number) => minutesAgo(d * 24 * 60);

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export const organizations: Organization[] = [
  {
    id: "org_aegis",
    name: "Aegis Robotics",
    slug: "aegis-robotics",
    plan: "enterprise",
    createdAt: daysAgo(92),
  },
];

export const members: Member[] = [
  {
    id: "usr_stella",
    orgId: "org_aegis",
    name: "Stella Papadopoulou",
    email: "stella@aegisrobotics.io",
    role: "owner",
  },
  {
    id: "usr_marco",
    orgId: "org_aegis",
    name: "Marco Deluca",
    email: "marco@aegisrobotics.io",
    role: "operator",
  },
];

export const projects: Project[] = [
  {
    id: "prj_pcb",
    orgId: "org_aegis",
    name: "PCB Defect Detection",
    description:
      "Detect solder bridges, missing components and scratches on assembly-line PCBs.",
    targetClasses: ["solder_bridge", "missing_component", "scratch"],
    createdAt: daysAgo(45),
  },
  {
    id: "prj_helmet",
    orgId: "org_aegis",
    name: "Warehouse Safety Compliance",
    description:
      "Detect hard hats and hi-vis vests on warehouse CCTV frames for safety audits.",
    targetClasses: ["hard_hat", "hi_vis_vest", "person"],
    createdAt: daysAgo(12),
  },
];

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------

export const hardwareNodes: HardwareNode[] = [
  {
    id: "node_mi300x_0",
    name: "mi300x-0",
    gpu: "AMD Instinct MI300X",
    gpuCount: 1,
    vramGb: 192,
    rocmVersion: "6.4.1",
    pytorchVersion: "2.7.0+rocm6.4",
    status: "busy",
    region: "us-east",
    provider: "amd-developer-cloud",
  },
];

/** ~30 min of history at 15 s resolution: idle → training ramp. */
export function telemetryHistory(nodeId: string): TelemetrySample[] {
  const samples: TelemetrySample[] = [];
  const points = 120;
  for (let i = 0; i < points; i++) {
    const minsBack = (points - i) * 0.25;
    const t = i / points;
    // Training kicks in at ~40% of the window.
    const training = t > 0.4;
    const ramp = training ? Math.min(1, (t - 0.4) / 0.15) : 0;
    const wobble = Math.sin(i * 1.7) * 0.5 + Math.sin(i * 0.31) * 0.5;
    samples.push({
      nodeId,
      at: minutesAgo(minsBack),
      vramUsedGb: +(8 + ramp * 118 + wobble * 4 * ramp).toFixed(1),
      vramTotalGb: 192,
      gpuUtilPct: Math.round(3 + ramp * 92 + wobble * 3 * ramp),
      tempC: Math.round(41 + ramp * 32 + wobble * 2),
      powerW: Math.round(140 + ramp * 560 + wobble * 25 * ramp),
      throughput: training
        ? { kind: "it_per_s", value: +(3.2 + wobble * 0.2).toFixed(2) }
        : undefined,
    });
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

export const datasets: Dataset[] = [
  {
    id: "ds_pcb_synth_v2",
    orgId: "org_aegis",
    projectId: "prj_pcb",
    name: "pcb-defects-synth-v2",
    origin: "synthetic",
    status: "ready",
    imageCount: 500,
    labeledCount: 500,
    classes: [
      { id: 0, name: "solder_bridge", color: "#d97706", instanceCount: 742 },
      { id: 1, name: "missing_component", color: "#0284c7", instanceCount: 615 },
      { id: 2, name: "scratch", color: "#65a30d", instanceCount: 389 },
    ],
    sizeMb: 1210,
    createdAt: daysAgo(9),
    runId: "run_pcb_v2",
  },
  {
    id: "ds_helmet_cctv",
    orgId: "org_aegis",
    projectId: "prj_helmet",
    name: "helmet-cctv-frames",
    origin: "byod",
    status: "unlabeled",
    imageCount: 1240,
    labeledCount: 0,
    classes: [],
    sizeMb: 3480,
    createdAt: daysAgo(2),
  },
];

function pcbImages(): AnnotatedImage[] {
  const classCount = 3;
  return Array.from({ length: 24 }, (_, i) => {
    const rejected = i % 9 === 8;
    const boxCount = 1 + (i % 3);
    return {
      id: `img_pcb_${String(i).padStart(4, "0")}`,
      datasetId: "ds_pcb_synth_v2",
      fileName: `synth_${String(i).padStart(4, "0")}.png`,
      width: 640,
      height: 480,
      url: placeholderImage(i, `synth_${String(i).padStart(4, "0")}.png`),
      thumbnailUrl: placeholderImage(i, `synth_${String(i).padStart(4, "0")}.png`, 320, 240),
      boxes: Array.from({ length: boxCount }, (_, b) => ({
        classId: (i + b) % classCount,
        cx: 0.25 + ((i * 7 + b * 13) % 50) / 100,
        cy: 0.3 + ((i * 11 + b * 17) % 40) / 100,
        w: 0.12 + ((i + b) % 4) * 0.04,
        h: 0.1 + ((i + b) % 3) * 0.05,
        confidence: +(0.82 + ((i + b) % 15) / 100).toFixed(2),
      })),
      split: i % 5 === 4 ? "val" : "train",
      curationState: rejected ? "rejected" : "accepted",
      critique: rejected
        ? {
            verdict: "rejected",
            reason: `Mask-box IoU ${(0.35 + (i % 10) / 100).toFixed(2)} below 0.85 threshold`,
            iou: +(0.35 + (i % 10) / 100).toFixed(2),
            attempts: 2,
            critic: "Critic Agent (Gemma 4 + OpenCV)",
          }
        : {
            verdict: "accepted",
            iou: +(0.88 + (i % 10) / 100).toFixed(2),
            attempts: 1,
            critic: "Critic Agent (Gemma 4 + OpenCV)",
          },
    } satisfies AnnotatedImage;
  });
}

export const annotatedImages: AnnotatedImage[] = pcbImages();

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export const runs: PipelineRun[] = [
  {
    id: "run_pcb_v2",
    orgId: "org_aegis",
    projectId: "prj_pcb",
    name: "pcb-defects · synthetic v2",
    path: "synthetic",
    status: "succeeded",
    stage: "complete",
    source: {
      path: "synthetic",
      basePrompt:
        "Top-down macro photo of a green printed circuit board on an assembly line with visible solder defects",
      negativePrompt: "blurry, watermark, hands",
      generator: "sdxl",
      randomization: {
        lightingVariation: 0.7,
        cameraAngleVariation: 0.4,
        backgroundDiversity: 0.55,
        occlusionRate: 0.2,
        scenarioCount: 500,
        imageCount: 500,
        guidanceScale: 7.5,
      },
    },
    training: {
      architecture: "yolov10m",
      epochs: 60,
      imageSize: 640,
      batchSize: 32,
      device: "mi300x-0",
    },
    targetClasses: ["solder_bridge", "missing_component", "scratch"],
    progress: {
      pct: 100,
      imagesGenerated: 500,
      imagesTotal: 500,
      masksAccepted: 463,
      masksRejected: 37,
      currentEpoch: 60,
      totalEpochs: 60,
      latestLoss: 0.42,
    },
    createdBy: "usr_stella",
    createdAt: daysAgo(9),
    startedAt: daysAgo(9),
    finishedAt: daysAgo(9),
    datasetId: "ds_pcb_synth_v2",
    modelId: "mdl_pcb_v2",
    costEstimateUsd: 14.2,
  },
  {
    id: "run_pcb_v1",
    orgId: "org_aegis",
    projectId: "prj_pcb",
    name: "pcb-defects · synthetic v1",
    path: "synthetic",
    status: "failed",
    stage: "training",
    source: {
      path: "synthetic",
      basePrompt: "Photo of a circuit board with defects",
      generator: "sdxl",
      randomization: {
        lightingVariation: 0.3,
        cameraAngleVariation: 0.3,
        backgroundDiversity: 0.3,
        occlusionRate: 0.1,
        scenarioCount: 200,
        imageCount: 200,
        guidanceScale: 7,
      },
    },
    training: {
      architecture: "yolov10s",
      epochs: 40,
      imageSize: 640,
      batchSize: 32,
      device: "mi300x-0",
    },
    targetClasses: ["solder_bridge", "missing_component", "scratch"],
    progress: {
      pct: 78,
      imagesGenerated: 200,
      imagesTotal: 200,
      masksAccepted: 154,
      masksRejected: 46,
      currentEpoch: 11,
      totalEpochs: 40,
      latestLoss: 1.31,
    },
    createdBy: "usr_stella",
    createdAt: daysAgo(14),
    startedAt: daysAgo(14),
    finishedAt: daysAgo(14),
    failureReason:
      "Critic rejection rate 23% exceeded quality gate (20%) — dataset too noisy to train. Increase guidance scale or refine base prompt.",
    costEstimateUsd: 6.8,
  },
  {
    id: "run_helmet_byod",
    orgId: "org_aegis",
    projectId: "prj_helmet",
    name: "helmet-cctv · byod labeling",
    path: "byod",
    status: "running",
    stage: "segmentation",
    source: {
      path: "byod",
      datasetId: "ds_helmet_cctv",
      archiveName: "cctv_frames_junel.zip",
      imageCount: 1240,
    },
    training: {
      architecture: "yolov10m",
      epochs: 50,
      imageSize: 640,
      batchSize: 32,
      device: "mi300x-0",
    },
    targetClasses: ["hard_hat", "hi_vis_vest", "person"],
    progress: {
      pct: 34,
      imagesGenerated: 0,
      imagesTotal: 1240,
      masksAccepted: 389,
      masksRejected: 31,
      currentEpoch: 0,
      totalEpochs: 50,
    },
    createdBy: "usr_marco",
    createdAt: minutesAgo(48),
    startedAt: minutesAgo(45),
    costEstimateUsd: 21.5,
  },
];

/** Static log history for the live BYOD run (live tail comes in Phase 3). */
const rawLogs: Pick<LogEvent, "level" | "agent" | "message">[] = [
  { level: "stage", agent: undefined, message: "━━ STAGE: SEGMENTATION — Vision Agent taking over ━━" },
  { level: "gpu", agent: "mlops", message: "hip.empty_cache() — VRAM flushed 41.2 GB → 6.8 GB before SAM 3 load" },
  { level: "info", agent: "vision", message: "Loading SAM 3 checkpoint (sam3_h.pt, 14.1 GB) onto mi300x-0" },
  { level: "info", agent: "vision", message: "Zero-shot prompt set: ['hard hat', 'hi-vis vest', 'person']" },
  { level: "info", agent: "vision", message: "img_0412.jpg → 3 masks (person ×2, hard_hat ×1) in 118 ms" },
  { level: "critic", agent: "critic", message: "REJECT img_0413.jpg: hard_hat mask IoU 0.43 < 0.85 — queued for regeneration" },
  { level: "info", agent: "vision", message: "img_0413.jpg → retry with point-prompt refinement" },
  { level: "critic", agent: "critic", message: "ACCEPT img_0413.jpg: retry IoU 0.91 — converted to YOLO bbox [0.44, 0.31, 0.09, 0.12]" },
  { level: "info", agent: "vision", message: "Batch 13/39 complete — 420/1240 images segmented, accept rate 92.6%" },
];

export const runLogs: LogEvent[] = rawLogs.map((e, i) => ({
  id: `log_${String(i).padStart(4, "0")}`,
  runId: "run_helmet_byod",
  at: minutesAgo(rawLogs.length - i),
  ...e,
}));

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export function trainingCurves(
  epochs: number,
  finalMap50: number,
  finalMap5095: number,
): TrainingCurvePoint[] {
  return Array.from({ length: epochs }, (_, i) => {
    const t = (i + 1) / epochs;
    // Exponential-ish convergence with mild noise.
    const conv = 1 - Math.exp(-3.2 * t);
    const noise = Math.sin(i * 2.3) * 0.012;
    return {
      epoch: i + 1,
      boxLoss: +(2.6 * Math.exp(-2.4 * t) + 0.35 + noise).toFixed(3),
      clsLoss: +(3.1 * Math.exp(-2.8 * t) + 0.28 - noise).toFixed(3),
      map50: +(finalMap50 * conv + noise).toFixed(3),
      map5095: +(finalMap5095 * conv + noise * 0.8).toFixed(3),
      precision: +(Math.min(0.97, 0.98 * conv + 0.1) + noise).toFixed(3),
      recall: +(Math.min(0.95, 0.93 * conv + 0.08) - noise).toFixed(3),
    };
  });
}

export const models: ModelArtifact[] = [
  {
    id: "mdl_pcb_v2",
    orgId: "org_aegis",
    runId: "run_pcb_v2",
    datasetId: "ds_pcb_synth_v2",
    name: "pcb-defect-detector",
    version: 2,
    architecture: "yolov10m",
    fileName: "pcb_defect_v2_yolov10m.pt",
    fileSizeMb: 32.1,
    classes: ["solder_bridge", "missing_component", "scratch"],
    metrics: {
      map50: 0.913,
      map5095: 0.687,
      precision: 0.941,
      recall: 0.882,
      epochsRun: 60,
      trainingTimeMin: 38,
    },
    curves: trainingCurves(60, 0.913, 0.687),
    trainedOn: {
      nodeName: "mi300x-0",
      gpu: "AMD Instinct MI300X",
      vramGb: 192,
      rocmVersion: "6.4.1",
    },
    status: "ready",
    createdAt: daysAgo(9),
    modelCard: [
      "## Summary",
      "yolov10m detector for PCB defects (solder_bridge, missing_component, scratch), trained end-to-end by the Auto-Annotator swarm with zero human labels.",
      "",
      "## Intended Use",
      "Automated optical inspection on assembly lines imaging bare or populated PCBs top-down. Not a substitute for electrical test.",
      "",
      "## Training Data",
      "500 synthetic SDXL images with domain randomization; the Critic Agent accepted 1,371 and rejected 214 candidate labels (OpenCV IoU verification).",
      "",
      "## Evaluation",
      "mAP50 0.913 · mAP50-95 0.687 · precision 0.941 · recall 0.882 after 60 epochs (38 min on MI300X).",
      "",
      "## Limitations",
      "Labels are machine-generated and the imagery is synthetic-only; validate on photos from the actual line before production use.",
      "",
      "---",
      "*Drafted autonomously by the MLOps Agent (Gemma via Fireworks AI).*",
    ].join("\n"),
  },
  {
    id: "mdl_pcb_v1",
    orgId: "org_aegis",
    runId: "run_pcb_v1",
    datasetId: "ds_pcb_synth_v2",
    name: "pcb-defect-detector",
    version: 1,
    architecture: "yolov10s",
    fileName: "pcb_defect_v1_yolov10s.pt",
    fileSizeMb: 15.8,
    classes: ["solder_bridge", "missing_component", "scratch"],
    metrics: {
      map50: 0.744,
      map5095: 0.492,
      precision: 0.81,
      recall: 0.702,
      epochsRun: 40,
      trainingTimeMin: 19,
    },
    curves: trainingCurves(40, 0.744, 0.492),
    trainedOn: {
      nodeName: "mi300x-0",
      gpu: "AMD Instinct MI300X",
      vramGb: 192,
      rocmVersion: "6.4.1",
    },
    status: "archived",
    createdAt: daysAgo(14),
  },
];

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const dashboardStats: DashboardStats = {
  activeRuns: 1,
  queuedRuns: 0,
  modelsTrained: 2,
  imagesGenerated: 700,
  imagesLabeled: 1120,
  gpuHoursUsed: 6.4,
  creditsRemainingUsd: 78.6,
};

export const apiKeys: ApiKey[] = [
  {
    id: "key_ci",
    name: "CI pipeline",
    prefix: "aa_live_3f9d…",
    createdAt: daysAgo(30),
    lastUsedAt: minutesAgo(95),
  },
];
