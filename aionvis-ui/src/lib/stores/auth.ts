/**
 * Mock authentication — client-side only, persisted to localStorage.
 * Any credentials pass. Replaced by real session handling when the backend
 * lands; the rest of the app only reads `user` and calls `logout()`.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AuthUser {
  name: string;
  email: string;
  role: "owner" | "admin" | "operator" | "viewer";
}

interface AuthState {
  user: AuthUser | null;
  login: (email: string) => void;
  logout: () => void;
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "operator";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      login: (email) =>
        set({ user: { name: nameFromEmail(email), email, role: "owner" } }),
      logout: () => set({ user: null }),
    }),
    { name: "aa-auth" },
  ),
);
