/**
 * Mutable in-memory "database" backing the MSW handlers, so create/cancel/
 * curate actions persist for the lifetime of the tab. Reset on reload —
 * exactly the durability a mock deserves.
 */
import * as seed from "./fixtures/seed";

export const db = {
  organizations: structuredClone(seed.organizations),
  members: structuredClone(seed.members),
  projects: structuredClone(seed.projects),
  hardwareNodes: structuredClone(seed.hardwareNodes),
  datasets: structuredClone(seed.datasets),
  annotatedImages: structuredClone(seed.annotatedImages),
  runs: structuredClone(seed.runs),
  runLogs: structuredClone(seed.runLogs),
  models: structuredClone(seed.models),
  apiKeys: structuredClone(seed.apiKeys),
  dashboardStats: structuredClone(seed.dashboardStats),
};

let counter = 0;
export const nextId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;
