/**
 * MSW request handlers — the mock implementation of the API contract.
 * Every route in `src/lib/api/endpoints.ts` is implemented here, 1:1.
 */
import { http, HttpResponse, delay } from "msw";
import { API_BASE } from "@/lib/api/endpoints";
import type {
  AnnotatedImage,
  CostEstimate,
  CreateFeedbackRequest,
  CreateProjectRequest,
  CreateRunRequest,
  CurateImageRequest,
  ExpandPromptRequest,
  ExpandPromptResponse,
  FoundryFeedback,
  Paginated,
  PipelineRun,
  PredictionResult,
  PreviewImagesRequest,
  PreviewImagesResponse,
  RunPreviewImage,
} from "@/lib/api/types";
import { computeAnalytics } from "./analytics";
import { db, nextId } from "./db";
import { placeholderImage } from "./fixtures/placeholder";
import { getSimulatedAgents } from "./simulator";

/** Small realistic latency so loading skeletons are actually visible. */
const lag = () => delay(Math.round(150 + Math.random() * 250));

/** Playground hard cases flagged this session (per-tab, like the rest of db). */
const feedbackStore: FoundryFeedback[] = [];

const notFound = (code: string, message: string) =>
  HttpResponse.json({ status: 404, code, message }, { status: 404 });

function paginate<T>(items: T[], url: string): Paginated<T> {
  const params = new URL(url).searchParams;
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 50);
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    total: items.length,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// Use-case understanding (mirrors backend/app/agents/prompt_agent.py): the
// user says what the model is FOR; the mock "Gemma" infers the deployment
// viewpoint and turns the rest into scene context.
// ---------------------------------------------------------------------------

const PLATFORM_VIEWS: [RegExp, string][] = [
  [/\b(drone|uav|quadcopter|aerial)\b/i, "seen from a low-altitude aerial drone view"],
  [/\b(cctv|surveillance|security camera|dome camera)\b/i, "seen from a high-mounted security camera"],
  [/\b(assembly|conveyor|production line|inspection|aoi|pcb|circuit)\b/i, "in a sharp top-down inspection view"],
  [/\b(dashcam|windshield|vehicle|truck|car)\b/i, "seen from a vehicle-mounted camera at road level"],
  [/\b(robot|robotic arm|gripper|cobot)\b/i, "seen from a robot-mounted camera at close working distance"],
];

const INTENT_WORDS =
  /\b(my|our|your|the|a|an|i|we|it|to|that|which|should|must|can|will|wants?|needs?|has|have|detects?|detecting|detection|finds?|finding|spots?|spotting|identif(?:y|ies|ying)|recogni[sz]es?|counts?|counting|locates?|flags?|flagging|model|camera|system|app|drone|uav|cctv|surveillance|robot|dashcam|vehicle)\b/gi;

/** Viewpoint implied by the platform named in the use case ("" if none). */
export function deploymentView(useCase: string): string {
  for (const [pattern, view] of PLATFORM_VIEWS) {
    if (pattern.test(useCase)) return view;
  }
  return "";
}

/** The use case minus its intent phrasing — environment words only. */
export function sceneContext(useCase: string): string {
  return useCase
    .replace(INTENT_WORDS, " ")
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .replace(/[.!?\s]+$/, "");
}

export const handlers = [
  // -- Dashboard ------------------------------------------------------------
  http.get(`${API_BASE}/dashboard/stats`, async () => {
    await lag();
    return HttpResponse.json(db.dashboardStats);
  }),

  // -- Tenancy --------------------------------------------------------------
  http.get(`${API_BASE}/organizations`, async () => {
    await lag();
    return HttpResponse.json(db.organizations);
  }),

  http.get(`${API_BASE}/organizations/:orgId/members`, async ({ params }) => {
    await lag();
    return HttpResponse.json(
      db.members.filter((m) => m.orgId === params.orgId),
    );
  }),

  http.get(`${API_BASE}/projects`, async () => {
    await lag();
    return HttpResponse.json(db.projects);
  }),

  http.post(`${API_BASE}/projects`, async ({ request }) => {
    await lag();
    const body = (await request.json()) as CreateProjectRequest;
    const project = {
      id: nextId("proj"),
      orgId: db.organizations[0].id,
      name: body.name.trim().slice(0, 80),
      description: (body.description ?? "").trim().slice(0, 300),
      targetClasses: body.targetClasses
        .map((c) => c.trim().toLowerCase().replace(/\s+/g, "_"))
        .filter(Boolean)
        .slice(0, 8),
      createdAt: new Date().toISOString(),
    };
    db.projects.push(project);
    return HttpResponse.json(project, { status: 201 });
  }),

  http.get(`${API_BASE}/projects/:id`, async ({ params }) => {
    await lag();
    const project = db.projects.find((p) => p.id === params.id);
    return project
      ? HttpResponse.json(project)
      : notFound("project_not_found", `No project ${params.id}`);
  }),

  http.get(`${API_BASE}/projects/:id/feedback`, async ({ params }) => {
    await lag();
    return HttpResponse.json(
      feedbackStore.filter((f) => f.projectId === params.id),
    );
  }),

  http.post(`${API_BASE}/projects/:id/feedback`, async ({ params, request }) => {
    await lag();
    const body = (await request.json()) as CreateFeedbackRequest;
    const fb: FoundryFeedback = {
      id: `fb_${String(feedbackStore.length + 1).padStart(4, "0")}`,
      projectId: String(params.id),
      modelId: body.modelId,
      note: body.note,
      detections: body.detections,
      createdAt: new Date().toISOString(),
    };
    feedbackStore.unshift(fb);
    return HttpResponse.json(fb, { status: 201 });
  }),

  // -- Runs -----------------------------------------------------------------
  http.get(`${API_BASE}/runs`, async ({ request }) => {
    await lag();
    return HttpResponse.json(paginate(db.runs, request.url));
  }),

  http.post(`${API_BASE}/runs`, async ({ request }) => {
    await lag();
    const body = (await request.json()) as CreateRunRequest;
    // The mock node is an MI300X, so runs stream (agents overlap) — except
    // audit runs on imported labels, which are near-instant and stay
    // sequential. Mirrors the real backend's selection in routers.create_run.
    const source = body.source;
    const sourceDataset =
      source.path === "byod"
        ? db.datasets.find((d) => d.id === source.datasetId)
        : undefined;
    const run: PipelineRun = {
      id: nextId("run"),
      orgId: db.organizations[0].id,
      projectId: body.projectId,
      name: body.name,
      path: body.source.path,
      status: "queued",
      stage: "queued",
      pipelineMode: sourceDataset?.importedLabels ? "sequential" : "streaming",
      // Mock node profile is the MI300X where SAM 3 is installed; the user's
      // explicit choice wins — mirrors routers.create_run's resolution.
      visionBackend: body.visionBackend ?? "sam3",
      source: body.source,
      training: body.training,
      targetClasses: body.targetClasses,
      progress: {
        pct: 0,
        imagesGenerated: 0,
        imagesTotal: body.source.path === "synthetic"
          ? body.source.randomization.imageCount
          : body.source.imageCount,
        masksAccepted: 0,
        masksRejected: 0,
        currentEpoch: 0,
        totalEpochs: body.training.epochs,
      },
      createdBy: db.members[0].id,
      createdAt: new Date().toISOString(),
    };
    db.runs.unshift(run);
    db.dashboardStats.queuedRuns += 1;
    // The real pipeline consumes the project's pending hard cases at launch.
    for (const f of feedbackStore) {
      if (f.projectId === body.projectId && !f.consumedByRunId)
        f.consumedByRunId = run.id;
    }
    return HttpResponse.json(run, { status: 201 });
  }),

  http.get(`${API_BASE}/runs/:id`, async ({ params }) => {
    await lag();
    const run = db.runs.find((r) => r.id === params.id);
    return run
      ? HttpResponse.json(run)
      : notFound("run_not_found", `No run ${params.id}`);
  }),

  http.post(`${API_BASE}/runs/:id/cancel`, async ({ params }) => {
    await lag();
    const run = db.runs.find((r) => r.id === params.id);
    if (!run) return notFound("run_not_found", `No run ${params.id}`);
    run.status = "cancelled";
    run.finishedAt = new Date().toISOString();
    return HttpResponse.json(run);
  }),

  http.get(`${API_BASE}/runs/:id/agents`, async ({ params }) => {
    await lag();
    const run = db.runs.find((r) => r.id === params.id);
    if (!run) return notFound("run_not_found", `No run ${params.id}`);
    // If a simulator is animating this run, report its live agent states.
    const simulated = getSimulatedAgents(String(params.id));
    if (simulated) return HttpResponse.json(simulated.map((a) => ({ ...a })));
    const roster = [
      { kind: "prompt", displayName: "Prompt Agent", model: "Gemma 4", provider: "vLLM · MI300X" },
      { kind: "synthesis", displayName: "Synthesis Agent", model: "SDXL", provider: "MI300X · local" },
      { kind: "vision", displayName: "Vision Agent", model: "SAM 3", provider: "MI300X · local" },
      { kind: "critic", displayName: "Critic Agent", model: "Gemma 4 VLM + geometry", provider: "vLLM · MI300X" },
      { kind: "mlops", displayName: "MLOps Agent", model: "YOLOv10 · PyTorch", provider: "MI300X · ROCm" },
    ] as const;
    const active = run.path === "byod"
      ? roster.filter((a) => a.kind !== "prompt" && a.kind !== "synthesis")
      : roster;
    return HttpResponse.json(
      active.map((a) => ({
        id: `${run.id}_${a.kind}`,
        runId: run.id,
        state:
          run.status !== "running" ? "idle"
          : a.kind === "vision" ? "working"
          : a.kind === "critic" ? "thinking"
          : "idle",
        currentTask:
          run.status === "running" && a.kind === "vision"
            ? "Segmenting batch 14/39 (SAM 3 zero-shot)"
            : undefined,
        ...a,
      })),
    );
  }),

  http.get(`${API_BASE}/runs/:id/logs`, async ({ params }) => {
    await lag();
    return HttpResponse.json(db.runLogs.filter((l) => l.runId === params.id));
  }),

  http.get(`${API_BASE}/runs/:id/preview`, async ({ params }) => {
    await lag();
    const run = db.runs.find((r) => r.id === params.id);
    if (!run) return notFound("not_found", `Run '${params.id}' not found`);
    if (run.source.path !== "synthetic") return HttpResponse.json([]);
    const count = Math.min(run.progress.imagesGenerated, 48);
    const view = deploymentView(run.source.useCase);
    const scene = sceneContext(run.source.useCase) ||
      run.targetClasses.join(", ").replace(/_/g, " ");
    const previews: RunPreviewImage[] = Array.from({ length: count }, (_, i) => ({
      fileName: `img_${String(i).padStart(4, "0")}.jpg`,
      url: placeholderImage(i + 7, `foundry ${i}`, 320, 320),
      scenario: `Photorealistic scene of ${scene}${view ? `, ${view}` : ""} — variation ${i + 1}`,
    }));
    return HttpResponse.json(previews);
  }),

  http.post(`${API_BASE}/runs/estimate`, async ({ request }) => {
    await lag();
    const body = (await request.json()) as CreateRunRequest;
    const images = body.source.path === "synthetic"
      ? body.source.randomization.imageCount
      : body.source.imageCount;
    const synthesisMin = body.source.path === "synthetic" ? images * 0.03 : 0;
    const segmentationMin = images * 0.012;
    const arch = body.training.architecture;
    // Mirrors the backend's per-architecture factor (RT-DETR ≈ 3× a nano YOLO).
    const archFactor = arch.startsWith("rtdetr")
      ? arch.endsWith("l") ? 3 : 4.5
      : ({ n: 1, s: 1.3, m: 1.8, l: 2.5, x: 3.5 }[arch.slice(-1)] ?? 1);
    const trainingMin = body.training.epochs * (images / 1000) * 0.9 * archFactor;
    const estimate: CostEstimate = {
      gpuMinutes: Math.round(synthesisMin + segmentationMin + trainingMin),
      estimatedUsd: +((synthesisMin + segmentationMin + trainingMin) * 0.33).toFixed(2),
      breakdown: [
        ...(body.source.path === "synthetic"
          ? [
              { stage: "prompt_expansion", minutes: 2 },
              { stage: "synthesis", minutes: Math.round(synthesisMin) },
            ] as CostEstimate["breakdown"]
          : []),
        { stage: "segmentation", minutes: Math.round(segmentationMin) },
        { stage: "critic_review", minutes: Math.round(segmentationMin * 0.4) },
        { stage: "training", minutes: Math.round(trainingMin) },
      ],
    };
    return HttpResponse.json(estimate);
  }),

  // -- Foundry ----------------------------------------------------------------
  http.post(`${API_BASE}/foundry/expand-prompt`, async ({ request }) => {
    // A bit slower than CRUD — "Gemma is thinking".
    await delay(900 + Math.random() * 600);
    const body = (await request.json()) as ExpandPromptRequest;
    const r = body.randomization;

    // Mirror the real Prompt Agent: the user's USE CASE ("my drone needs to
    // detect rotten potatoes") becomes scene prompts — deployment viewpoint
    // inferred, intent phrasing stripped, classes always depicted.
    const view = deploymentView(body.useCase);
    const context = sceneContext(body.useCase);
    const classes = body.targetClasses.map((c) => c.replace(/_/g, " ")).join(", ");

    const lighting = [
      "under harsh industrial overhead lighting",
      "in dim lighting with strong shadows",
      "under diffuse overcast daylight",
      "with warm low-angle evening light",
      "under flickering artificial light",
      "backlit by a bright light source",
    ];
    const angles = view
      ? [view, `${view}, directly overhead`, `${view}, at a low oblique angle`]
      : [
          "top-down orthographic view",
          "45-degree oblique angle",
          "low side angle close-up",
          "slightly tilted handheld perspective",
          "wide shot from a fixed mount",
        ];
    const backgrounds = [
      "with a cluttered real-world background",
      "against a clean uniform background",
      "in the middle of the working environment",
      "with natural surroundings out of focus",
      "with equipment visible in the background",
    ];
    const conditions = [
      "with light dust on the surface",
      "partially occluded by a worker's glove",
      "with minor motion blur",
      "in pristine condition",
      "with visible wear and fingerprints",
    ];

    const pick = <T,>(arr: T[], i: number, intensity: number) =>
      arr[Math.floor(i * (1 + intensity * 7)) % arr.length];

    const hardCases = body.projectId
      ? feedbackStore
          .filter((f) => f.projectId === body.projectId && !f.consumedByRunId)
          .map((f) => f.note)
      : [];
    const count = Math.min(body.previewCount ?? 8, 12);
    const scenarios = Array.from({ length: count }, (_, i) => {
      const parts = [
        `Photorealistic scene of ${context || classes}`,
        pick(angles, i + 1, r.cameraAngleVariation),
        pick(lighting, i + 2, r.lightingVariation),
        pick(backgrounds, i + 3, r.backgroundDiversity),
      ];
      if (r.occlusionRate > 0.15) parts.push(pick(conditions, i + 4, r.occlusionRate));
      if (i < hardCases.length)
        parts.push(`emphasizing this observed failure: ${hardCases[i]}`);
      return `${parts.join(", ")}, clearly showing ${classes}, sharp focus`;
    });

    const response: ExpandPromptResponse = {
      scenarios,
      totalScenarios: r.scenarioCount,
      model: "Gemma 4",
      provider: "vLLM · MI300X",
    };
    return HttpResponse.json(response);
  }),

  http.post(`${API_BASE}/foundry/preview-images`, async ({ request }) => {
    // Noticeably slower than CRUD — "the diffusion model is painting".
    await delay(1600 + Math.random() * 900);
    const body = (await request.json()) as PreviewImagesRequest;
    const count = Math.max(1, Math.min(body.count ?? 3, 4));
    const view = deploymentView(body.useCase);
    const scene = sceneContext(body.useCase) ||
      body.targetClasses.join(", ").replace(/_/g, " ");
    const response: PreviewImagesResponse = {
      images: Array.from({ length: count }, (_, i) => ({
        fileName: `preview_${String(i).padStart(2, "0")}.jpg`,
        url: placeholderImage(i + 31, `preview ${i + 1}`, 640, 640),
        scenario: `Photorealistic scene of ${scene}${view ? `, ${view}` : ""} — sample ${i + 1}`,
      })),
      model:
        body.generator === "flux"
          ? "FLUX.1-schnell (simulated)"
          : "stabilityai/sdxl-turbo (simulated)",
    };
    return HttpResponse.json(response);
  }),

  // -- Datasets ---------------------------------------------------------------
  http.get(`${API_BASE}/datasets`, async ({ request }) => {
    await lag();
    return HttpResponse.json(paginate(db.datasets, request.url));
  }),

  http.get(`${API_BASE}/datasets/:id`, async ({ params }) => {
    await lag();
    const dataset = db.datasets.find((d) => d.id === params.id);
    return dataset
      ? HttpResponse.json(dataset)
      : notFound("dataset_not_found", `No dataset ${params.id}`);
  }),

  http.get(`${API_BASE}/datasets/:id/images`, async ({ params, request }) => {
    await lag();
    const images = db.annotatedImages.filter(
      (img) => img.datasetId === params.id,
    );
    return HttpResponse.json(paginate(images, request.url));
  }),

  http.get(`${API_BASE}/datasets/:id/analytics`, async ({ params }) => {
    await lag();
    const dataset = db.datasets.find((d) => d.id === params.id);
    if (!dataset) return notFound("dataset_not_found", `No dataset ${params.id}`);
    const images = db.annotatedImages.filter(
      (img) => img.datasetId === params.id,
    );
    return HttpResponse.json(computeAnalytics(dataset, images));
  }),

  http.patch(
    `${API_BASE}/datasets/:datasetId/images/:imageId`,
    async ({ params, request }) => {
      await lag();
      const body = (await request.json()) as CurateImageRequest;
      const image = db.annotatedImages.find(
        (img) => img.id === params.imageId && img.datasetId === params.datasetId,
      );
      if (!image) return notFound("image_not_found", `No image ${params.imageId}`);
      image.curationState = body.curationState;
      return HttpResponse.json(image satisfies AnnotatedImage);
    },
  ),

  http.post(`${API_BASE}/datasets/:id/export`, async ({ params }) => {
    await delay(600); // "zipping"
    if (!db.datasets.some((d) => d.id === params.id))
      return notFound("dataset_not_found", `No dataset ${params.id}`);
    // Smallest valid zip (empty archive) as a data URI so the download
    // click actually produces a file in mock mode.
    return HttpResponse.json({
      downloadUrl: "data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==",
    });
  }),

  http.post(`${API_BASE}/datasets/upload`, async ({ request }) => {
    await lag();
    const body = (await request.json()) as { archiveName: string; sizeMb: number };
    const dataset = {
      id: nextId("ds"),
      orgId: db.organizations[0].id,
      name: body.archiveName.replace(/\.zip$/i, ""),
      origin: "byod" as const,
      status: "unlabeled" as const,
      imageCount: Math.max(50, Math.round(body.sizeMb * 0.36)),
      labeledCount: 0,
      classes: [],
      sizeMb: body.sizeMb,
      createdAt: new Date().toISOString(),
    };
    db.datasets.unshift(dataset);
    return HttpResponse.json(dataset, { status: 201 });
  }),

  // -- Models -----------------------------------------------------------------
  http.get(`${API_BASE}/models`, async () => {
    await lag();
    return HttpResponse.json(db.models);
  }),

  http.get(`${API_BASE}/models/:id`, async ({ params }) => {
    await lag();
    const model = db.models.find((m) => m.id === params.id);
    return model
      ? HttpResponse.json(model)
      : notFound("model_not_found", `No model ${params.id}`);
  }),

  http.post(`${API_BASE}/models/:id/export`, async ({ params, request }) => {
    await lag();
    const model = db.models.find((m) => m.id === params.id);
    if (!model) return notFound("model_not_found", `No model ${params.id}`);
    await request.json(); // { format } — the stub is format-agnostic
    // Stub bytes as a data URI so the download click actually produces a
    // file in mock mode (same pattern as the dataset export above); the
    // page names it via the anchor's download attribute.
    return HttpResponse.json({
      downloadUrl:
        "data:application/octet-stream;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==",
    });
  }),

  http.post(`${API_BASE}/models/:id/predict`, async ({ params }) => {
    // Simulated inference latency, then plausible detections.
    await delay(350 + Math.random() * 450);
    const model = db.models.find((m) => m.id === params.id);
    if (!model) return notFound("model_not_found", `No model ${params.id}`);
    const boxes = Array.from(
      { length: 1 + Math.floor(Math.random() * 3) },
      (_, i) => ({
        classId: i % model.classes.length,
        cx: 0.25 + Math.random() * 0.5,
        cy: 0.25 + Math.random() * 0.5,
        w: 0.15 + Math.random() * 0.2,
        h: 0.15 + Math.random() * 0.2,
        confidence: 0.55 + Math.random() * 0.4,
      }),
    );
    const result: PredictionResult = {
      boxes,
      latencyMs: Math.round(9 + Math.random() * 14),
      device: "cuda:0 · MI300X (simulated)",
      width: 640,
      height: 640,
    };
    return HttpResponse.json(result);
  }),

  // -- Hardware -----------------------------------------------------------------
  http.get(`${API_BASE}/hardware/nodes`, async () => {
    await lag();
    return HttpResponse.json(db.hardwareNodes);
  }),

  http.get(`${API_BASE}/hardware/nodes/:nodeId/telemetry`, async ({ params }) => {
    await lag();
    const { telemetryHistory } = await import("./fixtures/seed");
    return HttpResponse.json(telemetryHistory(String(params.nodeId)));
  }),

  // -- Settings -------------------------------------------------------------
  http.get(`${API_BASE}/settings/api-keys`, async () => {
    await lag();
    return HttpResponse.json(db.apiKeys);
  }),

  http.post(`${API_BASE}/settings/api-keys`, async ({ request }) => {
    await lag();
    const body = (await request.json()) as { name: string };
    const key = {
      id: nextId("key"),
      name: body.name,
      prefix: `aa_live_${Math.random().toString(36).slice(2, 6)}…`,
      createdAt: new Date().toISOString(),
    };
    db.apiKeys.push(key);
    return HttpResponse.json(key, { status: 201 });
  }),

  http.delete(`${API_BASE}/settings/api-keys/:id`, async ({ params }) => {
    await lag();
    const idx = db.apiKeys.findIndex((k) => k.id === params.id);
    if (idx === -1) return notFound("key_not_found", `No API key ${params.id}`);
    db.apiKeys.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),
];
