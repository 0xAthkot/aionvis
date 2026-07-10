"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import {
  CommandPalette,
  useCommandPalette,
} from "@/components/layout/command-palette";
import { Topbar } from "@/components/layout/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useAuthStore } from "@/lib/stores/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  // Wait for the persisted store to rehydrate before deciding to redirect.
  const hydrated = useSyncExternalStore(
    (cb) => useAuthStore.persist.onFinishHydration(cb),
    () => useAuthStore.persist.hasHydrated(),
    () => false,
  );
  const palette = useCommandPalette();

  useEffect(() => {
    if (hydrated && !user) router.replace("/login");
  }, [hydrated, user, router]);

  if (!hydrated || !user) return null;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="relative">
        {/* Aurora accent: one soft primary glow bleeding from the top edge —
            depth without clutter (Linear/Vercel dark-console pattern). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-72 bg-[radial-gradient(640px_240px_at_28%_-80px,--theme(--color-primary/9%),transparent_70%)]"
        />
        <Topbar onOpenPalette={() => palette.setOpen(true)} />
        <div className="relative z-10 flex flex-1 flex-col overflow-auto">
          {children}
        </div>
      </SidebarInset>
      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
    </SidebarProvider>
  );
}
