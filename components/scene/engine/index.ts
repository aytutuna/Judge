import {
  DirectionalLight,
  HemisphereLight,
  NeutralToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  VSMShadowMap,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { PALETTE_NUM } from "@/lib/palette";
import {
  getSceneMode,
  getSceneYou,
  sceneInput,
  sceneOutput,
  subscribeScene,
  subscribeSceneInput,
  subscribeStoryStep,
  type SceneMode,
  type Vote,
} from "@/lib/scene-bridge";
import {
  BED_TOP,
  ORB_SPLIT_POS,
  SPHERE_R,
  STORY_VERDICT,
  THETA_LIMIT,
  VERDICT_POINTER_RAD,
  blendPose,
  easePose,
  heroTargets,
  idleFactor,
  lerp,
  orbSlots,
  snapStoryQ,
  sphereCentre,
  sphereScale,
  ss,
  storyBlend,
  storyPose,
  verdictWinner,
  zeroPose,
} from "@/lib/scene-poses";
import { createBalance, type Winner } from "./balance";
import { mobileSceneBand } from "@/lib/scene-layout";
import { frameCamera, frameCard, projectContent, type Band } from "./camera";
import { createCrux } from "./crux";
import { createFragments } from "./fragments";
import { createJudges } from "./judges";
import { createDprGovernor, createLoop } from "./loop";
import { createBin, createMaterials } from "./materials";

export type EngineOptions = {
  /** Small or coarse-pointer screen: fewer segments and pieces, DPR cap 1.5. */
  small: boolean;
  /** Real shadow map (desktop) instead of baked blobs (mobile). */
  shadows: boolean;
  /** No rAF loop: one frame per mode, step or size change. */
  reduced: boolean;
  /** "stage": the page-wide hero/story layout. "card": centred in a small
   * box of its own (the judging card). */
  frame?: "stage" | "card";
  /** After shaders are compiled and the first frame is on screen. */
  onReady?: () => void;
  /** WebGL context lost: the stage falls back to the SVG. */
  onLost?: () => void;
  /** After every update (rendered or not); sceneOutput is current. */
  onFrame?: () => void;
};

export type BalanceEngine = {
  /** Canvas size in CSS px. */
  resize(w: number, h: number): void;
  renderOnce(): void;
  start(): void;
  stop(): void;
  dispose(): void;
  setReduced(reduced: boolean): void;
  /** Canvas faded out: skip rendering (unless judging, a loading indicator). */
  setHidden(hidden: boolean): void;
};

/** Builds the scene on `canvas`. Throws if WebGL is unavailable. */
export function createBalanceEngine(canvas: HTMLCanvasElement, opts: EngineOptions): BalanceEngine {
  const card = opts.frame === "card";
  const maxDpr = opts.small ? 1.5 : 2;
  const startDpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const renderer = new WebGLRenderer({
    canvas,
    antialias: startDpr < 2,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(startDpr);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = opts.shadows;
  renderer.shadowMap.type = VSMShadowMap;
  renderer.setClearColor(0x000000, 0);

  const bin = createBin();
  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.38;
  bin.add(envRT);
  room.dispose();
  pmrem.dispose();

  const camera = new PerspectiveCamera(30, 1, 0.1, 120);

  // Warm key from the upper left, steep enough that shadows stay under
  // their objects; a cool sage fill from the right; a rim from behind for
  // edges against the ivory page.
  scene.add(new HemisphereLight(0xfffaf3, 0xd9cfc2, 0.5));
  const key = new DirectionalLight(0xfff0dc, 2.6);
  key.position.set(-1.2, 10, 2.2);
  key.castShadow = opts.shadows;
  if (opts.shadows) {
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 22 });
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 6;
    key.shadow.blurSamples = 12;
  }
  scene.add(key);
  const fill = new DirectionalLight(PALETTE_NUM.sageTint, 0.6);
  fill.position.set(6, 2.5, 3);
  scene.add(fill);
  const rim = new DirectionalLight(PALETTE_NUM.paper, 1.4);
  rim.position.set(1.5, 4, -6);
  scene.add(rim);

  const mats = createMaterials(bin);
  const segments = opts.small ? 64 : 96;
  const balance = createBalance(scene, mats, bin, { segments, shadows: opts.shadows });
  const fragments = createFragments(scene, mats, bin, { perKind: opts.small ? 4 : 6, shadows: opts.shadows });
  const crux = createCrux(scene, mats, bin, { small: opts.small });
  const judges = createJudges(scene, mats, bin, { shadows: opts.shadows });

  /* ---------- state ---------- */
  let W = 1;
  let H = 1;
  let reduced = opts.reduced;
  let hidden = false;
  let wantRun = false;
  let compiled = false;
  let ready = false;
  let disposed = false;
  let theta = 0;
  let omega = 0;
  let time = 0; // ambient clock: slows to a stop when idle
  let pxs = 0;
  let pys = 0;
  let lastQ = Number.NaN;
  let nextRock = 0;
  let rockSeed = 11;
  let absorbA = 0;
  let absorbB = 0;
  let lastVotes: readonly Vote[] | null = null;
  let lastRenderAt = 0;
  let clock = 0; // real seconds, for one-shot effects
  let enter = 0; // entrance: the beam settles onto the pivot
  let settledFor: SceneMode | null = null;
  let settledAt = Number.NaN;
  const band: Band = { top: 0, bottom: 0, yMin: 0 };
  const heroLive = zeroPose();
  const heroTarget = zeroPose();
  const story = zeroPose();
  const pose = zeroPose();
  const rect = { top: 0, right: 0, bottom: 0, left: 0 };
  const view = { px: 0, py: 0, time: 0, idle: 0, reduced };
  const storySrc = { pose: story, votes: STORY_VERDICT.votes, n: STORY_VERDICT.votes.length };
  const heroSrc: { pose: typeof heroLive; votes: readonly Vote[] | null; n: number } = {
    pose: heroLive,
    votes: null,
    n: 3,
  };
  // Critically damped (no bounce), normalised to 0 -> 1 over k = 0..1.
  const settle = (k: number) => 1 - (1 + 8 * k) * Math.exp(-8 * k);
  const rand = () => (rockSeed = (rockSeed * 16807) % 2147483647) / 2147483647;

  // setSize clears the drawing buffer, so every resize is followed by an
  // immediate frame (otherwise a blank canvas can be presented).
  const governor = createDprGovernor({
    start: startDpr,
    onChange(dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(W, H, false);
      redraw();
    },
  });

  /** Advances the scene by dt. `snap` jumps every value to its target
   * (reduced motion, single frames). Returns whether anything still moves. */
  function update(dt: number, snap: boolean): boolean {
    const nowMs = performance.now();
    const mode = getSceneMode();
    clock += dt;
    // A verdict at first paint, or reduced motion, shows the settled pose.
    if (reduced || (!ready && mode.kind === "verdict")) enter = 1;
    else if (ready) enter = Math.min(1, enter + dt / 0.8);
    const judging = mode.kind === "judging";
    const desk = !card && W >= 960;
    const small = !desk;

    // A card never plays the scroll story.
    const q = card ? -3 : reduced ? snapStoryQ(sceneInput.q) : sceneInput.q;
    const qMoved = q !== lastQ;
    lastQ = q;

    // Hero springs. A verdict's targets depend on the live values, so a
    // snap iterates until the sequence has played through.
    let gap = 0;
    if (snap) {
      for (let i = 0; i < 4; i++) {
        heroTargets(mode, heroLive, heroTarget);
        Object.assign(heroLive, heroTarget);
      }
    } else {
      heroTargets(mode, heroLive, heroTarget);
      gap = easePose(heroLive, heroTarget, dt);
    }
    storyPose(q, story);
    const w = storyBlend(q);
    blendPose(heroLive, story, w, pose);

    // Ambient motion (sway, bob, spin) runs while there is recent input or a
    // judging run, and eases to a stop 5 s after the last input.
    const ambient = reduced ? 0 : judging ? 1 : idleFactor(nowMs - sceneInput.lastInputAt);
    time += dt * ambient;

    const kp = snap ? 1 : 1 - Math.exp(-dt * 3);
    const tpx = reduced ? 0 : sceneInput.px;
    const tpy = reduced ? 0 : sceneInput.py;
    pxs += (tpx - pxs) * kp;
    pys += (tpy - pys) * kp;
    const pointerMoving = Math.abs(tpx - pxs) > 1e-3 || Math.abs(tpy - pys) > 1e-3;

    // Beam: a damped spring toward the pose tilt, the pointer and a little
    // sway. Once a verdict shows, the pointer barely moves it.
    const verdictHold = mode.kind === "verdict" ? heroLive.drop * (1 - w) : 0;
    const authority = lerp(0.13, VERDICT_POINTER_RAD, verdictHold);
    let tau = pose.tilt + pxs * authority;
    tau += Math.sin(time * 0.55) * 0.025 * ambient * (1 - verdictHold);
    tau += Math.sin(time * 2.3) * 0.035 * pose.busy;
    if (!snap && !reduced && pose.rock > 0.05 && time >= nextRock) {
      omega += (rand() - 0.5) * 0.6 * pose.rock;
      nextRock = time + 1.2 + rand() * 1.4;
    }
    if (snap || reduced) {
      theta = tau;
      omega = 0;
    } else {
      omega += sceneInput.impulse;
      // A verdict tips with a single small overshoot, not a seesaw.
      const damping = mode.kind === "verdict" ? 6.5 : 5.2;
      const acc = 38 * (tau - theta) - damping * omega;
      omega += acc * dt;
      theta += omega * dt;
      theta = Math.max(-THETA_LIMIT, Math.min(THETA_LIMIT, theta));
    }
    sceneInput.impulse = 0;
    const energy = sceneInput.energy;
    sceneInput.energy = Math.max(0, energy - dt * 2.2);
    const springMoving = Math.abs(omega) > 1e-4 || Math.abs(tau - theta) > 1e-4;

    // Spheres.
    const lift = pose.lift;
    const bobA = Math.sin(time * 1.3) * 0.05 * lift;
    const bobB = Math.sin(time * 1.3 + 1.7) * 0.05 * lift;
    const pulse = 1 + 0.05 * energy + 0.025 * Math.sin(time * 4) * pose.busy;
    const breathe = Math.sin(time * 1.1) * 0.02 * pose.busy * (1 - pose.sink);
    const rise = 1.2 * (1 - settle(enter)) + breathe;
    const a = sphereCentre(-1, theta, lift, bobA + rise);
    const b = sphereCentre(1, theta, lift, bobB + rise);
    const base = sphereScale(lift, pulse) * (1 - pose.split * (1 - pose.reform));
    const scaleA = base * (1 + 0.04 * absorbA);
    const scaleB = base * (1 + 0.04 * absorbB);
    balance.update(theta, a, b, scaleA, scaleB, dt * ambient, pose.camDown, rise);
    crux.update(pose, time, dt * ambient, dt, snap);
    fragments.update(pose, time, a, b, crux.glowAt, small, ss(0, 1, enter));

    // Verdict emphasis once the beam has come to rest.
    let winner: Winner = null;
    if (mode.kind === "verdict" && w < 0.5) {
      if (settledFor !== mode) {
        settledFor = mode;
        settledAt = Number.NaN;
      }
      const resting = heroLive.drop > 0.98 && Math.abs(tau - theta) < 0.012 && Math.abs(omega) < 0.08;
      if (Number.isNaN(settledAt) && resting) settledAt = snap ? -Infinity : clock;
      if (!Number.isNaN(settledAt)) winner = verdictWinner(mode.verdict);
    } else settledFor = null;
    const since = clock - settledAt;
    balance.emphasis(winner, since, theta, dt);

    view.px = pxs;
    view.py = pys;
    view.time = time;
    view.idle = ambient;
    view.reduced = reduced;
    const yMin = lerp(0, BED_TOP - 0.4, pose.camDown);
    if (card) frameCard(camera, pose, W, H, view);
    else {
      if (!desk) {
        Object.assign(band, mobileSceneBand(W, H, ss(-1, -0.2, q)));
        band.yMin = yMin;
      }
      frameCamera(camera, pose, desk, W, H, view, band);
    }

    if (mode.kind === "verdict") lastVotes = mode.verdict.votes;
    else if (heroLive.orbs < 0.01 && heroLive.drop < 0.01) lastVotes = null;
    heroSrc.votes = mode.kind === "verdict" ? mode.verdict.votes : lastVotes;
    heroSrc.n = heroSrc.votes && heroSrc.votes.length > 0 ? heroSrc.votes.length : 3;
    const absorbed = judges.update(heroSrc, storySrc, w, time, dt * ambient, dt, a, b, camera.quaternion, snap);
    absorbA = absorbed.absorbA;
    absorbB = absorbed.absorbB;

    // What the stage needs for the overlap fade.
    const orbTop = orbSlots(1)[0].y + 0.45;
    const sorted = pose.split * (1 - pose.sink) * (1 - pose.reform);
    const yMax = Math.max(
      a.y + SPHERE_R * scaleA,
      b.y + SPHERE_R * scaleB,
      pose.orbs > 0.05 ? lerp(ORB_SPLIT_POS.y, orbTop, pose.orbs) : 0,
      sorted > 0.05 ? 3.3 : 0,
    );
    projectContent(camera, W, H, yMin, yMax, rect);
    sceneOutput.contentRect = rect;

    const moving =
      !reduced &&
      (gap > 1e-3 ||
        springMoving ||
        ambient > 0 ||
        energy > 0 ||
        pointerMoving ||
        qMoved ||
        enter < 1 ||
        since < 1);
    sceneOutput.settled = !moving;
    return moving;
  }

  function draw() {
    if (!compiled) {
      renderer.compile(scene, camera);
      compiled = true;
    }
    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      opts.onReady?.();
    }
  }

  let dirty = true;
  const loop = createLoop((dt, now) => {
    const moving = update(dt, false);
    const judging = getSceneMode().kind === "judging";
    const visible = !hidden || judging || !ready;
    if ((moving || dirty) && visible) {
      draw();
      dirty = false;
      if (lastRenderAt > 0) governor.sample(now - lastRenderAt);
      lastRenderAt = now;
    } else lastRenderAt = 0;
    opts.onFrame?.();
    // Settled with nothing left to draw: stop scheduling frames (battery,
    // CPU). wake() restarts the loop on input, mode or step changes, and
    // when the canvas is shown again.
    if (!moving && !(dirty && visible)) loop.stop();
  });

  /** Restarts a loop that stopped because the scene settled. */
  function wake() {
    if (disposed || reduced || !wantRun || loop.running) return;
    loop.start();
  }

  /** Same moment, new frame (after a resize). */
  function redraw() {
    if (disposed || !compiled) return;
    update(0, reduced);
    draw();
  }

  function renderOnce() {
    if (disposed) return;
    if (!compiled) {
      // Compile with everything visible so later reveals never stall.
      renderer.compile(scene, camera);
      compiled = true;
    }
    update(0, true);
    draw();
    dirty = false;
    opts.onFrame?.();
  }

  let you = getSceneYou();
  balance.paintSides(you);
  judges.paintSides(you);

  const unsubMode = subscribeScene(() => {
    if (getSceneYou() !== you) {
      you = getSceneYou();
      balance.paintSides(you);
      judges.paintSides(you);
    }
    dirty = true;
    if (reduced) renderOnce();
    else wake();
  });
  const unsubStep = subscribeStoryStep(() => {
    dirty = true;
    if (reduced) renderOnce();
    else wake();
  });
  const unsubInput = subscribeSceneInput(wake);

  const onLost = (e: Event) => {
    e.preventDefault();
    loop.stop();
    opts.onLost?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  return {
    resize(w, h) {
      W = Math.max(1, Math.round(w));
      H = Math.max(1, Math.round(h));
      renderer.setSize(W, H, false);
      governor.reset();
      dirty = true;
      if (reduced || !loop.running) renderOnce();
      else redraw();
    },
    renderOnce,
    start() {
      wantRun = true;
      if (reduced) renderOnce();
      else loop.start();
    },
    stop() {
      wantRun = false;
      loop.stop();
    },
    setReduced(r) {
      if (r === reduced) return;
      reduced = r;
      if (r) {
        loop.stop();
        renderOnce();
      } else if (wantRun) loop.start();
    },
    setHidden(h) {
      if (h === hidden) return;
      dirty = true;
      hidden = h;
      wake();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loop.stop();
      unsubMode();
      unsubStep();
      unsubInput();
      canvas.removeEventListener("webglcontextlost", onLost);
      sceneOutput.contentRect = null;
      bin.drain();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
