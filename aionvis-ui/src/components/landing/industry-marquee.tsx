import {
  Bot,
  Car,
  Factory,
  ShoppingCart,
  Warehouse,
  Wheat,
  type LucideIcon,
} from "lucide-react";

/* Placeholder tiles until the swarm renders each industry's hero image on
   the MI300X (SDXL, same Synthesis Agent as the pipeline) — swap `image`
   from null to the generated file under public/industries/. */
const INDUSTRIES: {
  icon: LucideIcon;
  name: string;
  blurb: string;
  image: string | null;
}[] = [
  {
    icon: Factory,
    name: "AI in Manufacturing",
    blurb:
      "Defect, weld and PPE detectors trained from a sentence — quality control models without a single hand-drawn box.",
    image: null,
  },
  {
    icon: Car,
    name: "AI in Automotive",
    blurb:
      "Detect panels, parts and assembly states on the line, and retrain in minutes when the product changes.",
    image: null,
  },
  {
    icon: Wheat,
    name: "AI in Agriculture",
    blurb:
      "Crop, livestock and machinery detection for fields where nobody wants to hand-label ten thousand aerial photos.",
    image: null,
  },
  {
    icon: Bot,
    name: "AI in Robotics",
    blurb:
      "Give a robot eyes for new objects overnight — synthetic scenes cover bins, grips and clutter before the robot ever sees them.",
    image: null,
  },
  {
    icon: Warehouse,
    name: "AI in Logistics",
    blurb:
      "Forklifts, pallets and safety vests from one sentence — the exact domain the live demo trains end to end.",
    image: null,
  },
  {
    icon: ShoppingCart,
    name: "AI in Retail",
    blurb:
      "Shelf gaps, planogram drift and queue counts — describe the shelf, get the detector.",
    image: null,
  },
];

function IndustryRow({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <div aria-hidden={ariaHidden || undefined} className="flex gap-4 pr-4">
      {INDUSTRIES.map(({ icon: Icon, name, blurb }) => (
        <article
          key={name}
          className="w-72 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-card/40"
        >
          <div className="relative flex aspect-[4/3] items-center justify-center border-b border-white/5 bg-gradient-to-br from-muted/40 to-muted/10">
            <Icon aria-hidden className="size-8 text-muted-foreground/40" />
            <span className="absolute right-2.5 bottom-2 font-mono text-[10px] text-muted-foreground/50">
              awaiting synthesis · MI300X
            </span>
          </div>
          <div className="p-4">
            <h3 className="text-sm font-semibold">{name}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {blurb}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}

export function IndustryMarquee() {
  return (
    <div className="group relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-background to-transparent sm:w-28"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-background to-transparent sm:w-28"
      />
      <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        <IndustryRow />
        <IndustryRow ariaHidden />
      </div>
    </div>
  );
}
