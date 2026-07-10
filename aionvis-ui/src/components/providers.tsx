"use client";

import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { features } from "@/config/features";

/**
 * App-wide providers. When mocks are enabled, the MSW worker must be running
 * before the first query fires, so children are held back until it starts.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
        queryCache: new QueryCache({
          // Surface background fetch failures once; components still render
          // their own inline error states.
          onError: (error, query) => {
            if (query.state.data !== undefined) return;
            toast.error("Request failed", { description: error.message });
          },
        }),
      }),
  );
  const [mocksReady, setMocksReady] = useState(!features.useMocks);

  useEffect(() => {
    if (!features.useMocks) return;
    let cancelled = false;
    import("@/lib/mocks/browser")
      .then(({ worker }) => worker.start({ onUnhandledRequest: "bypass" }))
      .then(() => {
        if (!cancelled) setMocksReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!mocksReady) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
