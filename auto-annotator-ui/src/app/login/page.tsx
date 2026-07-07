"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuthStore } from "@/lib/stores/auth";

export default function LoginPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    login(email || "operator@aegisrobotics.io");
    router.replace("/dashboard");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary">
            <Crosshair className="size-5 text-primary-foreground" />
          </div>
          <div className="leading-tight">
            <p className="font-semibold tracking-tight">Auto-Annotator</p>
            <p className="text-xs text-muted-foreground">
              MLOps Command Center
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Access your organization&apos;s control plane
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Work email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </CardContent>
            <CardFooter className="mt-6 flex-col gap-3">
              <Button type="submit" className="w-full">
                Sign in
              </Button>
              <div className="flex w-full items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or</span>
                <Separator className="flex-1" />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="w-full">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled
                    >
                      Continue with SSO (SAML)
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Available on the Enterprise plan once the backend is connected
                </TooltipContent>
              </Tooltip>
            </CardFooter>
          </form>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Demo mode — any credentials sign you in to Aegis Robotics.
        </p>
      </div>
    </main>
  );
}
