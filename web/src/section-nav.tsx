import { useEffect, useRef, useState } from "react";
import { scrollToId } from "./property-shared";

export const SCROLL_DRIVEN = typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()");

export interface SectionNavItem {
  id: string;
  label: string;
}

interface SectionNavProps {
  items: SectionNavItem[];
  /** Extra class on the sticky wrapper, for page-specific placement and chrome. */
  className?: string;
  /** Class flipped on `<html>` while the bar is stuck under the header. */
  dockClass?: string;
  /**
   * Let CSS scroll-driven animations handle docking where the browser supports
   * them. The property page has a view timeline for that; pages without one
   * pass `false` so the class-based fallback always runs.
   */
  scrollDriven?: boolean;
}

/** Scroll the chip bar just enough that the selected chip sits at the visible end. */
function scrollChipIntoBar(scroller: HTMLElement, chip: HTMLElement) {
  if (scroller.scrollWidth <= scroller.clientWidth + 1) return;
  const scrollerBox = scroller.getBoundingClientRect();
  const chipBox = chip.getBoundingClientRect();
  const styles = getComputedStyle(scroller);
  const padLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const padRight = Number.parseFloat(styles.paddingRight) || 0;
  const visibleLeft = scrollerBox.left + padLeft;
  const visibleRight = scrollerBox.right - padRight;
  let delta = 0;
  if (chipBox.right > visibleRight) delta = chipBox.right - visibleRight;
  else if (chipBox.left < visibleLeft) delta = chipBox.left - visibleLeft;
  else return;
  const next = Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, scroller.scrollLeft + delta));
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  scroller.scrollTo({ left: next, behavior: reduce ? "auto" : "smooth" });
}

/**
 * Sticky section bar: chips that follow the reader's place on the page, dock
 * beneath the header on the way down, and scroll to their section on tap.
 * Writes `--profile-nav-height` on `<html>` so the page can offset for it.
 */
export function SectionNav({ items, className, dockClass = "nav-docked", scrollDriven = true }: SectionNavProps) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const pinRef = useRef<string | null>(null);
  const pinTimer = useRef(0);
  const ids = items.map((item) => item.id).join("|");
  const cssDocking = scrollDriven && SCROLL_DRIVEN;
  const releasePin = () => {
    pinRef.current = null;
    window.clearTimeout(pinTimer.current);
  };
  const selectChip = (id: string) => {
    pinRef.current = id;
    setActive(id);
    window.clearTimeout(pinTimer.current);
    pinTimer.current = window.setTimeout(releasePin, 1600);
    scrollToId(id);
  };
  useEffect(() => {
    const node = navRef.current;
    if (!node) return;
    const sync = () => {
      document.documentElement.style.setProperty("--profile-nav-height", `${Math.round(node.getBoundingClientRect().height)}px`);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--profile-nav-height");
    };
  }, [ids]);
  useEffect(() => {
    const node = navRef.current;
    if (!node) return;
    // With scroll-driven animations the docking hand-off is pure CSS, driven by
    // the compositor. Nothing here needs to run per frame.
    if (cssDocking) return;
    const root = document.documentElement;
    let stickyTop = 0;
    const measure = () => { stickyTop = Number.parseFloat(getComputedStyle(node).top) || 0; };
    const check = () => {
      // A stuck sticky element sits exactly at its `top`; inline it is further down.
      root.classList.toggle(dockClass, node.getBoundingClientRect().top <= stickyTop + 0.5);
    };
    const remeasure = () => { measure(); check(); };
    remeasure();
    // --topbar-height is written by the layout's effect, which runs after this one.
    const frame = requestAnimationFrame(remeasure);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", remeasure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", remeasure);
      root.classList.remove(dockClass);
    };
  }, [cssDocking, dockClass]);
  useEffect(() => {
    const nodes = ids.split("|").map((id) => document.getElementById(id)).filter((node): node is HTMLElement => Boolean(node));
    if (!nodes.length) return;
    const visible = new Map<string, number>();
    const styles = getComputedStyle(document.documentElement);
    // With the hand-off, the docked chrome ends at brand row + tabs (the search
    // row has slid away); without it, the tabs sit under the whole header.
    const header = Number.parseFloat(styles.getPropertyValue("--topbar-height")) || 84;
    const topbar = (cssDocking && Number.parseFloat(styles.getPropertyValue("--topbar-main-height"))) || header;
    const nav = Number.parseFloat(styles.getPropertyValue("--profile-nav-height")) || 68;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
        else visible.delete(entry.target.id);
      }
      const top = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
      // A tap pins the chip until page scroll settles. Ignore the sections we
      // fly past so they do not flash selected on the way.
      if (pinRef.current) return;
      if (top) setActive(top[0]);
    }, { rootMargin: `-${topbar + nav}px 0px -55% 0px`, threshold: 0 });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [ids, cssDocking]);
  useEffect(() => {
    const onScrollEnd = (event: Event) => {
      const target = event.target;
      if (target === scrollerRef.current) return;
      if (target !== document && target !== document.documentElement && target !== document.body && target !== document.scrollingElement) return;
      releasePin();
    };
    window.addEventListener("scrollend", onScrollEnd);
    return () => {
      window.removeEventListener("scrollend", onScrollEnd);
      window.clearTimeout(pinTimer.current);
    };
  }, []);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !active) return;
    const chip = scroller.querySelector<HTMLElement>(`a[href="#${CSS.escape(active)}"]`);
    if (!chip) return;
    const frame = requestAnimationFrame(() => scrollChipIntoBar(scroller, chip));
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return (
    <div ref={navRef} className={`profile-nav-wrap${className ? ` ${className}` : ""}`}>
      <nav ref={scrollerRef} className="side-nav profile-nav" aria-label="On this page">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={active === item.id ? "on" : ""}
            onClick={(event) => { event.preventDefault(); selectChip(item.id); }}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
