"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface NavLink {
  href: string; // "#section-id"
  label: string;
}

/**
 * Landing navbar links with scroll-spy: the link whose section currently
 * crosses the reading band (just below the fixed header) lights up red,
 * with the color and underline animating on every switch.
 */
export function LandingNav({ links }: { links: NavLink[] }) {
  const [active, setActive] = useState("");

  useEffect(() => {
    const sections = links
      .map((l) => document.getElementById(l.href.slice(1)))
      .filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(`#${entry.target.id}`);
        }
      },
      // Band from 15% to 25% of the viewport height: sections are taller
      // than it, so exactly one section owns the highlight at a time.
      { rootMargin: "-15% 0px -75% 0px" },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [links]);

  return (
    <div className="hidden items-center gap-5 text-sm md:flex">
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          onClick={() => setActive(l.href)}
          className={cn(
            "relative py-1 text-muted-foreground transition-colors duration-300 hover:text-foreground",
            active === l.href && "text-primary hover:text-primary",
          )}
        >
          {l.label}
          <span
            aria-hidden
            className={cn(
              "absolute inset-x-0 -bottom-px h-px origin-left scale-x-0 bg-primary transition-transform duration-300",
              active === l.href && "scale-x-100",
            )}
          />
        </a>
      ))}
    </div>
  );
}
