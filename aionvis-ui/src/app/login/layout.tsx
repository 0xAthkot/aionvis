import type { Metadata } from "next";

// The login page is a client component, so its tab title lives here.
// Prefixed to "aionVIS · Sign in" by the root layout's title template.
export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
