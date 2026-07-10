"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { createTelemetryStream } from "@/lib/api/streams";
import type { HardwareNode, TelemetrySample } from "@/lib/api/types";

/**
 * First hardware node + a rolling telemetry window: REST history seeds it,
 * the live stream appends one sample per second.
 */
export function useTelemetry(window = 90, withHistory = true) {
  const { data: nodes } = useQuery({
    queryKey: ["hardware-nodes"],
    queryFn: () => api<HardwareNode[]>(endpoints.hardware.nodes()),
  });
  const node = nodes?.[0];

  const { data: history } = useQuery({
    queryKey: ["telemetry-history", node?.id],
    queryFn: () =>
      api<TelemetrySample[]>(endpoints.hardware.telemetry(node!.id)),
    enabled: withHistory && !!node,
    staleTime: Infinity,
  });

  const [live, setLive] = useState<TelemetrySample[]>([]);

  useEffect(() => {
    if (!node) return;
    const stream = createTelemetryStream(node.id);
    const unsubscribe = stream.subscribe((event) =>
      setLive((prev) => [...prev.slice(-(window - 1)), event.payload]),
    );
    return () => {
      unsubscribe();
      stream.close();
    };
  }, [node, window]);

  const samples = useMemo(
    () => [...(withHistory ? (history ?? []) : []), ...live].slice(-window),
    [history, live, window, withHistory],
  );

  return { node, samples, latest: samples.at(-1) };
}
