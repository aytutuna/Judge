import { useEffect, useState, type RefObject } from "react";
import { setSceneStatus } from "@/lib/scene-bridge";

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function wantsLessData(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return true;
  return window.matchMedia("(prefers-reduced-data: reduce)").matches;
}

/** True once the 3D scene may load: after `load` plus an idle callback,
 * with `ref` near the viewport, WebGL available and no data saver.
 * Otherwise the scene status becomes "fallback". */
export function useSceneGate(ref: RefObject<HTMLElement | null>): boolean {
  const [go, setGo] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (wantsLessData() || !hasWebGL()) {
      setSceneStatus("fallback");
      return;
    }
    let cancelled = false;
    let io: IntersectionObserver | null = null;
    let idleId = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = () => {
      if (cancelled) return;
      io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io?.disconnect();
          if (!cancelled) setGo(true);
        },
        { rootMargin: "200px" },
      );
      io.observe(el);
    };
    const afterLoad = () => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(watch, { timeout: 2500 });
      } else timer = setTimeout(watch, 1200);
    };
    if (document.readyState === "complete") afterLoad();
    else window.addEventListener("load", afterLoad, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", afterLoad);
      if (idleId && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleId);
      if (timer) clearTimeout(timer);
      io?.disconnect();
    };
  }, [ref]);
  return go;
}
