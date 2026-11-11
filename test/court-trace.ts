import { createHash } from "node:crypto";
import { seeded } from "../components/court/engine";
import type { CourtScene } from "../components/court/engine";

type Create = (canvas: HTMLCanvasElement, opts: { src: (name: string) => string; reduced: boolean }) => {
  set(scene: CourtScene): void;
  dispose(): void;
};

const BEATS = ["names", "facts", "judges", "bothSides", "crux", "ruling", "vote1", "more", "vote2", "trial", "final"] as const;

/** Plays a whole judging visit with a fixed random stream and clock, and
 * returns every drawing call the court made, with a hash of them. */
export async function courtTrace(
  create: Create,
  scenes: (beat: (typeof BEATS)[number]) => CourtScene,
): Promise<{ hash: string; calls: string[] }> {
  const calls: string[] = [];
  const target = {} as Record<string, unknown>;
  const ctx = new Proxy(target, {
    get: (t, k) => (k in t ? t[k as string] : (...args: unknown[]) => void calls.push(`${String(k)}(${args.map((a) => (typeof a === "object" ? "img" : String(a))).join(",")})`)),
    set: (t, k, v) => (calls.push(`${String(k)}=${String(v)}`), (t[k as string] = v), true),
  });
  const canvas = { getContext: () => ctx, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }) };
  const frames: ((t: number) => void)[] = [];
  const rand = seeded(20260511);
  const saved = { document: globalThis.document, Image: globalThis.Image, raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame, random: Math.random, now: performance.now };
  Object.assign(globalThis, {
    document: { hidden: false, createElement: () => canvas, addEventListener() {}, removeEventListener() {} },
    Image: class {
      naturalWidth = 16;
      width = 16;
      height = 16;
      onload: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
    requestAnimationFrame: (f: (t: number) => void) => frames.push(f),
    cancelAnimationFrame: () => frames.splice(0),
  });
  Math.random = rand;
  performance.now = () => 0;
  try {
    const court = create(canvas as unknown as HTMLCanvasElement, { src: (n) => n, reduced: false });
    await new Promise((r) => setTimeout(r, 0));
    let t = 0;
    const run = (n: number) => {
      for (let i = 0; i < n; i++) frames.splice(0).forEach((f) => f((t += 50)));
    };
    court.set({ kind: "home", busy: false });
    run(120);
    court.set({ kind: "home", busy: true });
    run(80);
    for (const beat of BEATS) {
      court.set(scenes(beat));
      run(60);
    }
    court.dispose();
  } finally {
    Object.assign(globalThis, { document: saved.document, Image: saved.Image, requestAnimationFrame: saved.raf, cancelAnimationFrame: saved.caf });
    Math.random = saved.random;
    performance.now = saved.now;
  }
  return { hash: createHash("sha256").update(calls.join("\n")).digest("hex"), calls };
}
