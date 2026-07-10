/**
 * Every route the future FastAPI backend must expose, in one place.
 * The MSW handlers in `src/lib/mocks/handlers.ts` implement this map 1:1.
 */
export const API_BASE = "/api/v1";

export const endpoints = {
  dashboard: {
    /** GET → DashboardStats */
    stats: () => `${API_BASE}/dashboard/stats`,
  },

  organizations: {
    /** GET → Organization[] */
    list: () => `${API_BASE}/organizations`,
    /** GET → Member[] */
    members: (orgId: string) => `${API_BASE}/organizations/${orgId}/members`,
  },

  projects: {
    /** GET → Project[] · POST CreateProjectRequest → Project (201) */
    list: () => `${API_BASE}/projects`,
    /** GET → Project */
    get: (id: string) => `${API_BASE}/projects/${id}`,
    /** GET → FoundryFeedback[] · POST CreateFeedbackRequest → FoundryFeedback */
    feedback: (id: string) => `${API_BASE}/projects/${id}/feedback`,
  },

  runs: {
    /** GET → Paginated<PipelineRun> · POST CreateRunRequest → PipelineRun */
    list: () => `${API_BASE}/runs`,
    /** GET → PipelineRun */
    get: (id: string) => `${API_BASE}/runs/${id}`,
    /** POST → PipelineRun */
    cancel: (id: string) => `${API_BASE}/runs/${id}/cancel`,
    /** GET → AgentInstance[] */
    agents: (id: string) => `${API_BASE}/runs/${id}/agents`,
    /** GET → LogEvent[] (history; live tail comes over the WebSocket) */
    logs: (id: string) => `${API_BASE}/runs/${id}/logs`,
    /** GET → RunPreviewImage[] (images generated so far; poll while running) */
    preview: (id: string) => `${API_BASE}/runs/${id}/preview`,
    /** POST CreateRunRequest → CostEstimate (dry-run pricing for the wizard) */
    estimate: () => `${API_BASE}/runs/estimate`,
  },

  foundry: {
    /** POST ExpandPromptRequest → ExpandPromptResponse (Prompt Agent dry-run) */
    expandPrompt: () => `${API_BASE}/foundry/expand-prompt`,
  },

  datasets: {
    /** GET → Dataset[] */
    list: () => `${API_BASE}/datasets`,
    /** GET → Dataset */
    get: (id: string) => `${API_BASE}/datasets/${id}`,
    /** GET → Paginated<AnnotatedImage> */
    images: (id: string) => `${API_BASE}/datasets/${id}/images`,
    /** GET → DatasetAnalytics (class/split distributions, heatmap, dimensions) */
    analytics: (id: string) => `${API_BASE}/datasets/${id}/analytics`,
    /** PATCH CurateImageRequest → AnnotatedImage */
    curateImage: (datasetId: string, imageId: string) =>
      `${API_BASE}/datasets/${datasetId}/images/${imageId}`,
    /** POST { archiveName, sizeMb } → Dataset (registers a BYOD upload) */
    upload: () => `${API_BASE}/datasets/upload`,
    /** POST DatasetExportRequest → { downloadUrl } (YOLO or COCO zip) */
    export: (id: string) => `${API_BASE}/datasets/${id}/export`,
  },

  models: {
    /** GET → ModelArtifact[] */
    list: () => `${API_BASE}/models`,
    /** GET → ModelArtifact */
    get: (id: string) => `${API_BASE}/models/${id}`,
    /** POST { format: "pt" | "onnx" } → { downloadUrl } */
    export: (id: string) => `${API_BASE}/models/${id}/export`,
    /** POST multipart (field "image") → PredictionResult (live inference) */
    predict: (id: string) => `${API_BASE}/models/${id}/predict`,
  },

  hardware: {
    /** GET → HardwareNode[] */
    nodes: () => `${API_BASE}/hardware/nodes`,
    /** GET → TelemetrySample[] (recent history; live tail over WebSocket) */
    telemetry: (nodeId: string) =>
      `${API_BASE}/hardware/nodes/${nodeId}/telemetry`,
  },

  settings: {
    /** GET → ApiKey[] · POST { name } → ApiKey */
    apiKeys: () => `${API_BASE}/settings/api-keys`,
    /** DELETE → 204 (revoke) */
    apiKey: (id: string) => `${API_BASE}/settings/api-keys/${id}`,
  },
} as const;

/**
 * WebSocket routes. Until the backend exists these are served by the mock
 * simulator (Phase 3) through the same StreamSource interface.
 */
export const wsEndpoints = {
  /** RunStreamEvent messages, JSON-encoded. */
  runEvents: (runId: string) => `/ws/v1/runs/${runId}/events`,
  /** TelemetryStreamEvent messages, JSON-encoded. */
  telemetry: (nodeId: string) => `/ws/v1/hardware/${nodeId}/telemetry`,
} as const;
