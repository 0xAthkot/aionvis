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
      <SidebarInset>
        <Topbar onOpenPalette={() => palette.setOpen(true)} />
        <div className="flex-1 overflow-auto">{children}</div>
      </SidebarInset>
      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
    </SidebarProvider>
  );
}
