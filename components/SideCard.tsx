"use client";

import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { isThrow, releaseVelocity, throwTarget, type Sample } from "@/lib/card-throw";
import { t, type Lang } from "@/lib/i18n";
import styles from "./SideCard.module.css";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The transform that puts the centred card on top of its tile. */
function onTile(card: HTMLElement, tile: HTMLElement): string {
  const r = tile.getBoundingClientRect();
  const dx = r.left + r.width / 2 - document.documentElement.clientWidth / 2;
  const dy = r.top + r.height / 2 - document.documentElement.clientHeight / 2;
  return `translate(${dx}px, ${dy}px) scale(${r.width / card.offsetWidth}, ${r.height / card.offsetHeight})`;
}

/**
 * One side's full text as a card in the middle of the screen, opened from its
 * tile. It closes with the X, a tap outside, Escape, or by being thrown;
 * `onClose` runs once the closing animation is over.
 */
export function SideCard({
  lang,
  party,
  name,
  text,
  tile,
  onClose,
}: {
  lang: Lang;
  party: string;
  name: string;
  text: string;
  tile: HTMLElement;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLParagraphElement>(null);
  const closing = useRef(false);
  const drag = useRef<{ id: number; x: number; y: number; dx: number; dy: number; samples: Sample[] } | null>(null);
  const [scrolls, setScrolls] = useState(false);

  useLayoutEffect(() => {
    const dlg = dialog.current!;
    const el = card.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dlg.showModal();
    el.focus({ preventScroll: true });
    setScrolls(body.current!.scrollHeight > body.current!.clientHeight);
    scrim.current!.animate({ opacity: [0, 1] }, { duration: 200 });
    if (reduced()) {
      el.animate({ opacity: [0, 1] }, { duration: 150 });
    } else {
      el.animate({ transform: [onTile(el, tile), "none"], opacity: [0.4, 1] }, { duration: 320, easing: EASE });
    }
    return () => {
      document.body.style.overflow = overflow;
      if (dlg.open) dlg.close();
    };
  }, [tile]);

  function finish(a: Animation) {
    a.onfinish = onClose;
  }

  /** Throws the card away when given a direction, else shrinks it back to its tile. */
  function close(toss?: { x: number; y: number }) {
    if (closing.current) return;
    closing.current = true;
    const el = card.current!;
    const here = getComputedStyle(el).transform;
    el.getAnimations().forEach((a) => a.cancel());
    el.style.transform = "";
    scrim.current!.animate({ opacity: [1, 0] }, { duration: 200, fill: "forwards" });
    if (reduced()) {
      finish(el.animate({ opacity: [1, 0] }, { duration: 150, fill: "forwards" }));
    } else if (toss) {
      finish(
        el.animate(
          { transform: [here, `translate(${toss.x}px, ${toss.y}px) rotate(${Math.max(-30, Math.min(30, toss.x / 40))}deg)`], opacity: [1, 0] },
          { duration: 280, easing: "ease-in", fill: "forwards" },
        ),
      );
    } else {
      finish(
        el.animate(
          { transform: [here, onTile(el, tile)], opacity: [1, 0.3] },
          { duration: 260, easing: EASE, fill: "forwards" },
        ),
      );
    }
  }

  function press(e: PointerEvent<HTMLDivElement>) {
    if (closing.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || (scrolls && body.current!.contains(target))) return;
    card.current!.getAnimations().forEach((a) => a.cancel());
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, samples: [] };
    card.current!.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.dx = e.clientX - d.x;
    d.dy = e.clientY - d.y;
    d.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    card.current!.style.transform = `translate(${d.dx}px, ${d.dy}px) rotate(${d.dx / 40}deg)`;
  }

  function release(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || closing.current) return;
    drag.current = null;
    const { vx, vy } = e.type === "pointercancel" ? { vx: 0, vy: 0 } : releaseVelocity(d.samples);
    if (e.type !== "pointercancel" && isThrow(d.dx, d.dy, vx, vy)) {
      close(throwTarget(d.dx, d.dy, vx, vy, Math.hypot(window.innerWidth, window.innerHeight)));
      return;
    }
    const el = card.current!;
    const from = el.style.transform || "none";
    el.style.transform = "";
    el.animate({ transform: [from, "none"] }, { duration: 300, easing: SPRING });
  }

  return (
    <dialog
      ref={dialog}
      className={styles.root}
      aria-label={name}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div ref={scrim} className={styles.scrim} onClick={() => close()} />
      <div
        ref={card}
        className={styles.card}
        data-side={party}
        tabIndex={-1}
        onPointerDown={press}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <div className={styles.head}>
          <p className={styles.name}>{name}</p>
          <button type="button" className={styles.close} aria-label={t(lang, "judging.close")} onClick={() => close()}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 4l10 10M14 4L4 14" />
            </svg>
          </button>
        </div>
        <p ref={body} className={styles.body} data-scroll={scrolls ? "" : undefined} tabIndex={scrolls ? 0 : undefined}>
          {text}
        </p>
      </div>
    </dialog>
  );
}
