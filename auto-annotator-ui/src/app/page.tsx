import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Check,
  ChevronDown,
  Cpu,
  Crosshair,
  Download,
  FileText,
  Flag,
  Minus,
  ShieldCheck,
  Target,
  Upload,
  X,
} from "lucide-react";
import { AgentPipeline } from "@/components/landing/agent-pipeline";
import { HeroVisual } from "@/components/landing/hero-visual";
import { IndustryMarquee } from "@/components/landing/industry-marquee";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Auto-Annotator — Training data that builds itself",
  description:
    "An autonomous agent swarm that turns one sentence into a trained, deployable detection model. Zero human annotation. Built entirely on AMD MI300X.",
};

const NAV_LINKS = [
  { href: "#pipeline", label: "Pipeline" },
  { href: "#features", label: "Features" },
  { href: "#compare", label: "Compare" },
  { href: "#platform", label: "Platform" },
  { href: "#pricing", label: "Pricing" },
  { href: "#industries", label: "Industries" },
  { href: "#faq", label: "FAQ" },
];

const STATS = [
  { value: "Zero", label: "boxes drawn by humans" },
  { value: "<$0.01", label: "LLM cost per run" },
  { value: "1 GPU", label: "whole swarm resident in 192 GB" },
  { value: "minutes", label: "from a sentence to weights" },
];

const FEATURES = [
  {
    icon: Target,
    title: "Inference playground",
    body: "Drop a photo on any trained model and watch it detect — live latency, device badge, boxes drawn on your image. Every model proves itself before you ship it.",
  },
  {
    icon: Flag,
    title: "Active-learning flywheel",
    body: "Model missed something? Flag it in one click. The next run's Prompt Agent dedicates scenarios to exactly that failure. The swarm learns from its own models' mistakes.",
  },
  {
    icon: ShieldCheck,
    title: "Two-stage self-QA",
    body: "The Critic re-derives every box geometrically with OpenCV, then a vision-language model verifies the semantics. Typical runs reject more candidate labels than they accept.",
  },
  {
    icon: Activity,
    title: "Live Mission Control",
    body: "Every agent state, critic verdict, VRAM flush and training epoch streams over WebSockets. Synthetic images appear the moment the diffusion model produces them.",
  },
  {
    icon: Cpu,
    title: "Explicit GPU orchestration",
    body: "A run queue, deliberate hip.empty_cache() handoffs between stages, and live telemetry. One MI300X serves a whole team without VRAM fights.",
  },
  {
    icon: FileText,
    title: "Autonomous model cards",
    body: "After training, the MLOps Agent writes an honest model card — intended use, data provenance, metrics, limitations — for every artifact. Unedited, self-critical.",
  },
  {
    icon: Upload,
    title: "BYOD auto-labeling",
    body: "Already have imagery? Upload an archive and the same swarm segments, labels and QA-checks it. The Scale AI workflow, minus the humans.",
  },
  {
    icon: Download,
    title: "Export anywhere",
    body: "Datasets leave as YOLO, COCO, Pascal VOC or CSV; weights as .pt, ONNX, TorchScript or OpenVINO. Boxes, masks, rotated boxes or pose — never locked in.",
  },
];

type Cell = { text: string; good?: boolean; bad?: boolean };
const COMPARE_ROWS: { label: string; cells: [Cell, Cell, Cell] }[] = [
  {
    label: "Who draws the boxes",
    cells: [
      { text: "Human annotators", bad: true },
      { text: "Humans + SAM assist", bad: true },
      { text: "Nobody — agents label & verify", good: true },
    ],
  },
  {
    label: "Where data comes from",
    cells: [
      { text: "You collect it", bad: true },
      { text: "You collect it", bad: true },
      { text: "Generated from one sentence", good: true },
    ],
  },
  {
    label: "Quality assurance",
    cells: [
      { text: "Human review passes" },
      { text: "Human review passes" },
      { text: "Geometric + VLM self-QA", good: true },
    ],
  },
  {
    label: "When the model fails",
    cells: [
      { text: "Re-collect, re-label, re-pay", bad: true },
      { text: "Re-label", bad: true },
      { text: "One click → targeted new data", good: true },
    ],
  },
  {
    label: "Time to a trained model",
    cells: [
      { text: "Weeks", bad: true },
      { text: "Days" },
      { text: "Minutes", good: true },
    ],
  },
  {
    label: "Marginal cost",
    cells: [
      { text: "$30–100 per 1k boxes", bad: true },
      { text: "Seats + your labeling time" },
      { text: "GPU-minutes, quoted upfront", good: true },
    ],
  },
];

function CellIcon({ cell }: { cell: Cell }) {
  if (cell.good) return <Check className="size-3.5 shrink-0 text-emerald-400" />;
  if (cell.bad) return <X className="size-3.5 shrink-0 text-muted-foreground/60" />;
  return <Minus className="size-3.5 shrink-0 text-muted-foreground/40" />;
}

const FAQS = [
  {
    q: "If no human draws a single box, who checks the labels?",
    a: "Every label passes a two-stage Critic: an OpenCV geometric check that re-derives each box from its mask and rejects poor fits, and a VLM spot-check that confirms crops actually show the claimed class. Labels that fail are regenerated or dropped — and a run whose data doesn't survive scrutiny fails honestly instead of shipping a bad model.",
  },
  {
    q: "Can I use my own images instead of synthetic ones?",
    a: "Yes — upload a zip of your own imagery and the swarm takes it from there: labeling, verification, and training, no annotation required. Flag a missed detection in the playground and the next run generates scenarios targeting exactly that failure.",
  },
  {
    q: "What formats can I export?",
    a: "Datasets export as YOLO, COCO (with segmentation), Pascal VOC, and CSV — parity with what Label Studio offers. Trained models ship as .pt, ONNX, TorchScript, and OpenVINO, ready for deployment.",
  },
  {
    q: "Can I run it on my own hardware?",
    a: "The whole stack self-hosts with one docker compose up — CUDA or ROCm — and the LLM is any OpenAI-compatible endpoint you point it at; vLLM serving Gemma keeps everything on your own silicon. Nothing leaves your network.",
  },
  {
    q: "How long does a run take, and what will it cost?",
    a: "Every run shows a GPU-minute quote and duration estimate before you launch, and Mission Control streams progress live. On an MI300X, one sentence becomes deployable weights in minutes, not hours.",
  },
  {
    q: "What is image annotation?",
    a: "Labeling images — boxes, masks, keypoints — so a model can learn what to look for. It's traditionally the slowest and most expensive step in computer vision, and it's the step Auto-Annotator removes entirely: the agents draw and verify every label themselves.",
  },
  {
    q: "What is model training?",
    a: "Showing a model thousands of labeled examples until it can find those objects in images it has never seen. The MLOps Agent handles it end to end — architecture selection to exported weights — with live epoch metrics streaming to Mission Control.",
  },
];

const PLANS = [
  {
    name: "Developer",
    price: "Free",
    tagline: "Self-hosted, open pipeline",
    features: [
      "docker compose up — full stack locally",
      "Bring your own GPU (CUDA or ROCm)",
      "Bring your own OpenAI-compatible LLM (vLLM)",
      "YOLO / COCO / VOC / CSV / ONNX export",
    ],
    cta: "Run it locally",
    href: "#platform",
    highlight: false,
  },
  {
    name: "Team",
    price: "Per GPU-minute",
    tagline: "Managed MI300X capacity",
    features: [
      "Every run quoted before launch",
      "Shared projects, run queue, registry",
      "Active-learning feedback across the team",
      "A 500-image training run ≈ the price of lunch",
    ],
    cta: "Launch the console",
    href: "/login",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    tagline: "Your data never leaves",
    features: [
      "On-prem or dedicated MI300X nodes",
      "SSO / SAML, isolated tenancy",
      "Self-hosted LLM (vLLM) — zero external calls",
      "Support SLAs",
    ],
    cta: "Talk to us",
    href: "/login",
    highlight: false,
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ---- Navbar ---- */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-background/70 backdrop-blur-md">
        <nav className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary">
              <Crosshair className="size-4 text-primary-foreground" />
            </div>
            <span className="font-semibold tracking-tight">Auto-Annotator</span>
          </Link>
          <div className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="transition-colors hover:text-foreground">
                {l.label}
              </a>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/login">
                Launch console <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </nav>
      </header>

      <main>
        {/* ---- Hero ---- */}
        <section className="relative overflow-hidden pt-32 pb-20 sm:pt-40">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,oklch(0.637_0.237_25.331_/_0.18),transparent)]"
          />
          <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-3xl text-center">
              <Badge variant="outline" className="mb-6 gap-1.5 border-primary/40 py-1 text-xs">
                <span className="size-1.5 rounded-full bg-primary" />
                Powered end to end by AMD MI300X
              </Badge>
              <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
                Stop labeling data.
                <br />
                <span className="bg-gradient-to-r from-primary to-orange-400 bg-clip-text text-transparent">
                  Start describing it.
                </span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
                Auto-Annotator is an autonomous agent swarm that turns one plain-English
                sentence into a trained, deployable detection model — generating,
                labeling and QA-ing its own training data. Zero human annotation.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button asChild size="lg">
                  <Link href="/login">
                    Launch the console <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <a href="#pipeline">See how it works</a>
                </Button>
              </div>
            </div>
            <div className="mx-auto mt-14 max-w-3xl">
              <HeroVisual />
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Real output — these images were generated by the swarm and the
                boxes are its own Critic-verified labels.
              </p>
            </div>
          </div>
        </section>

        {/* ---- Stats strip ---- */}
        <section className="border-y border-white/5 bg-card/40">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-10 sm:px-6 lg:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-3xl font-semibold tracking-tight text-primary">{s.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Pipeline ---- */}
        <section id="pipeline" className="scroll-mt-20 py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Five agents. Zero humans.
              </h2>
              <p className="mt-4 text-muted-foreground">
                Annotation tools help humans label faster. We removed the humans.
                Each agent hands verified work to the next — and the Critic sends
                bad labels back.
              </p>
              <p className="mt-3 font-medium">
                On other GPUs our agents take turns. On one MI300X they work at
                the same time.
              </p>
            </div>
            <AgentPipeline />
            <p className="mt-8 text-center text-sm text-muted-foreground">
              Every stage streams live to Mission Control — agent reasoning, critic
              verdicts, VRAM orchestration, training curves.
            </p>
          </div>
        </section>

        {/* ---- Features ---- */}
        <section id="features" className="scroll-mt-20 border-t border-white/5 bg-card/20 py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                A complete data-to-model factory
              </h2>
              <p className="mt-4 text-muted-foreground">
                Not an annotation tool with AI sprinkled on top — an end-to-end
                MLOps control plane where the data, the labels and the models all
                build themselves.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <div
                    key={f.title}
                    className="group rounded-xl border bg-card p-5 transition-colors hover:border-primary/40"
                  >
                    <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <Icon className="size-4.5" />
                    </div>
                    <p className="mb-1.5 text-sm font-semibold">{f.title}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{f.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ---- Compare ---- */}
        <section id="compare" className="scroll-mt-20 py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Faster labeling is the wrong race
              </h2>
              <p className="mt-4 text-muted-foreground">
                The best annotation tools make humans 10× faster. An agent swarm
                that feeds itself makes the human 0× necessary.
              </p>
            </div>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-card/60 text-left">
                    <th className="p-4 font-medium text-muted-foreground" />
                    <th className="p-4 font-medium text-muted-foreground">
                      Manual platforms
                      <span className="block text-xs font-normal opacity-70">Scale AI · Labelbox</span>
                    </th>
                    <th className="p-4 font-medium text-muted-foreground">
                      AI-assisted tools
                      <span className="block text-xs font-normal opacity-70">Ultralytics · Roboflow</span>
                    </th>
                    <th className="bg-primary/10 p-4 font-semibold text-foreground">
                      Auto-Annotator
                      <span className="block text-xs font-normal text-primary">autonomous swarm</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((row) => (
                    <tr key={row.label} className="border-b last:border-b-0">
                      <td className="p-4 font-medium">{row.label}</td>
                      {row.cells.map((cell, i) => (
                        <td
                          key={i}
                          className={
                            i === 2
                              ? "bg-primary/10 p-4"
                              : "p-4 text-muted-foreground"
                          }
                        >
                          <span className="flex items-center gap-2">
                            <CellIcon cell={cell} />
                            {cell.text}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Synthetic data is easy to generate and hard to trust — the
              self-correcting Critic is the trust layer.
            </p>
          </div>
        </section>

        {/* ---- Platform ---- */}
        <section id="platform" className="scroll-mt-20 border-t border-white/5 bg-card/20 py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid items-start gap-12 lg:grid-cols-2">
              <div>
                <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Born on AMD
                </h2>
                <p className="mt-4 text-muted-foreground">
                  The whole swarm — diffusion, segmentation, training, and
                  optionally the LLM itself — fits resident in one MI300X&apos;s
                  192&nbsp;GB of VRAM. No model juggling, no multi-node
                  orchestration: one box is a complete data-to-model factory.
                </p>
                <ul className="mt-6 space-y-3 text-sm">
                  <li className="flex gap-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>
                      <span className="font-medium">AMD MI300X</span> — PyTorch on
                      ROCm end to end, live <span className="font-mono text-xs">amd-smi</span> telemetry,
                      explicit VRAM orchestration between stages.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>
                      <span className="font-medium">Gemma via vLLM</span> — served
                      on the same MI300X: expands prompts, writes model cards, and
                      semantically verifies labels as a VLM critic. Zero external
                      API calls, zero per-token cost.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>
                      <span className="font-medium">Endpoint-agnostic</span> — the
                      swarm speaks the OpenAI chat protocol, so any compatible
                      endpoint drops in with one env var.
                    </span>
                  </li>
                </ul>
              </div>
              <div>
                <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Self-host it
                </h2>
                <p className="mt-4 text-muted-foreground">
                  The entire stack runs on your machine with your own keys —
                  two commands, no accounts, nothing leaves your network.
                </p>
                <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/90 shadow-xl">
                  <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
                    <span className="font-mono text-xs text-zinc-500">
                      self-host.sh
                    </span>
                  </div>
                  <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-zinc-300">
                    <code>{`# Full stack, your machine, no accounts
git clone <this-repo> && cd auto-annotator

# Optional: point at your own LLM (falls back
# to a deterministic template expander)
echo "LLM_BASE_URL=http://localhost:8001/v1" > backend/.env

docker compose up --build

# UI  → http://localhost:3000
# API → http://localhost:8000/docs`}</code>
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---- Pricing ---- */}
        <section id="pricing" className="scroll-mt-20 py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Priced like infrastructure, not labor
              </h2>
              <p className="mt-4 text-muted-foreground">
                Human labeling scales with boxes. We scale with GPU-minutes — and
                every run shows you its quote before you launch it.
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              {PLANS.map((plan) => (
                <div
                  key={plan.name}
                  className={
                    plan.highlight
                      ? "relative rounded-xl border border-primary/50 bg-card p-6 shadow-[0_0_40px_-12px] shadow-primary/30"
                      : "rounded-xl border bg-card p-6"
                  }
                >
                  {plan.highlight && (
                    <Badge className="absolute -top-2.5 left-6">Most popular</Badge>
                  )}
                  <p className="text-sm font-medium text-muted-foreground">{plan.name}</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight">{plan.price}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{plan.tagline}</p>
                  <ul className="mt-5 space-y-2.5 text-sm">
                    {plan.features.map((f) => (
                      <li key={f} className="flex gap-2.5">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                        <span className="text-muted-foreground">{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    asChild
                    className="mt-6 w-full"
                    variant={plan.highlight ? "default" : "outline"}
                  >
                    <Link href={plan.href}>{plan.cta}</Link>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---- Industries marquee ---- */}
        <section id="industries" className="scroll-mt-20 border-t border-white/5 py-24">
          <div className="mx-auto mb-12 max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                One swarm, every industry
              </h2>
              <p className="mt-4 text-muted-foreground">
                From factory floors to farm fields — if you can describe it,
                the swarm can detect it.
              </p>
            </div>
          </div>
          <IndustryMarquee />
        </section>

        {/* ---- FAQ ---- */}
        <section id="faq" className="scroll-mt-20 border-t border-white/5 bg-card/20 py-24">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Frequently asked questions
              </h2>
            </div>
            <div className="space-y-3">
              {FAQS.map((f) => (
                <details
                  key={f.q}
                  className="group rounded-xl border border-white/10 bg-card/40 px-5"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="pb-5 text-sm leading-relaxed text-muted-foreground">
                    {f.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "FAQPage",
                mainEntity: FAQS.map((f) => ({
                  "@type": "Question",
                  name: f.q,
                  acceptedAnswer: { "@type": "Answer", text: f.a },
                })),
              }),
            }}
          />
        </section>

        {/* ---- Final CTA ---- */}
        <section className="pb-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="relative overflow-hidden rounded-2xl border border-primary/30 px-6 py-16 text-center">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_65%_at_50%_50%,oklch(0.637_0.237_25.331_/_0.22),transparent_100%)]"
              />
              <div className="relative">
                <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                  Your next model is one sentence away
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                  Describe what you need to detect. The swarm handles the rest —
                  and shows you every step.
                </p>
                <Button asChild size="lg" className="mt-8">
                  <Link href="/login">
                    Launch the console <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ---- Footer ---- */}
      <footer className="border-t border-white/5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 text-center sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary">
              <Crosshair className="size-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold">Auto-Annotator</span>
          </div>
          <p className="text-xs text-muted-foreground">
            SDXL · SAM · YOLO26 / YOLO11 / YOLOv10 / RT-DETR · Gemma via
            vLLM · PyTorch on ROCm · MI300X
          </p>
          <p className="text-xs text-muted-foreground/60">
            © 2026 Auto-Annotator.
          </p>
        </div>
      </footer>
    </div>
  );
}
