import type { DomainRandomizationConfig } from "@/lib/api/types";

/**
 * Main subject per scene, mirroring the backend's prompt_agent.plan_scenes:
 * null = every class (≤ maxClassesPerScene classes and no mix), else a smooth
 * weighted round-robin over the class mix, so every prefix of the plan is as
 * close to the requested shares as integers allow.
 */
export function planScenes(
  targetClasses: string[],
  r: DomainRandomizationConfig,
  count: number,
): (string | null)[] {
  const classes = targetClasses.map((c) => c.replace(/_/g, " "));
  const k = Math.max(1, r.maxClassesPerScene ?? 3);
  if (!r.classMix && classes.length <= k) return Array(count).fill(null);
  const mix = new Map(
    Object.entries(r.classMix ?? {}).map(([c, v]) => [
      c.replace(/_/g, " ").toLowerCase(),
      Math.max(0, v),
    ]),
  );
  let weights = classes.map((c) =>
    r.classMix ? mix.get(c.toLowerCase()) ?? 0 : 1,
  );
  if (weights.reduce((a, b) => a + b, 0) <= 0) weights = classes.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const current = classes.map(() => 0);
  const plan: string[] = [];
  for (let s = 0; s < count; s++) {
    weights.forEach((w, j) => (current[j] += w));
    let pick = 0;
    current.forEach((v, j) => {
      if (v > current[pick]) pick = j;
    });
    current[pick] -= total;
    plan.push(classes[pick]);
  }
  return plan;
}
