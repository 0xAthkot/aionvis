"use client";

import { Mail, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const CONTACT = "aionvisofficial@gmail.com";

/**
 * "Talk to us" → an animated dialog (shadcn fade/zoom) that composes a
 * message. The site is static, so submit opens the visitor's mail client
 * pre-filled to our address — and the address itself is always visible.
 */
export function ContactDialog({ cta }: { cta: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const subject = encodeURIComponent(
      `aionVIS enterprise inquiry${name.trim() ? ` — ${name.trim()}` : ""}`,
    );
    const body = encodeURIComponent(
      `${message.trim()}\n\n— ${name.trim() || "Anonymous"}${
        email.trim() ? ` (${email.trim()})` : ""
      }`,
    );
    window.location.href = `mailto:${CONTACT}?subject=${subject}&body=${body}`;
    toast.success("Opening your mail client…", {
      description: `Composing to ${CONTACT}`,
    });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="mt-6 w-full" variant="outline">
          {cta}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Talk to us</DialogTitle>
          <DialogDescription>
            Dedicated MI300X nodes, on-prem deployments, SLAs — tell us what
            you need and we&apos;ll get back to you.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contact-name">Name</Label>
              <Input
                id="contact-name"
                placeholder="Ada Lovelace"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-email">Work email</Label>
              <Input
                id="contact-email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-message">What are you building?</Label>
            <Textarea
              id="contact-message"
              rows={4}
              placeholder="Detection targets, data constraints, deployment environment…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full">
            <Send className="size-4" />
            Compose email
          </Button>
        </form>
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Mail className="size-3.5" />
          or write directly to{" "}
          <a
            href={`mailto:${CONTACT}`}
            className="text-foreground underline underline-offset-4"
          >
            {CONTACT}
          </a>
        </p>
      </DialogContent>
    </Dialog>
  );
}
