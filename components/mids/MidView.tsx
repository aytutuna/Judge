import type { CSSProperties, ReactNode } from "react";
import type { Arms, Mid } from "./cast";
import styles from "./Mids.module.css";

// Drawn in the mascot's own units: body centre (512, 500), radius 56, feet on
// y = 600. Arm angles are degrees from hanging straight down, positive
// outward; negative crosses in front of the body.
const VIEW = "400 396 224 204";
const VIEW_W = 224;
const VIEW_H = 204;
const SHOULDER_L: [number, number] = [466, 514];
const SHOULDER_R: [number, number] = [558, 514];
const ARM = 48;

const POSES: Record<Arms, [number, number]> = {
  rest: [16, 16],
  wave: [16, 150],
  up: [160, 160],
  hold: [-30, -30],
  chin: [14, -62],
  shrug: [62, 62],
  point: [16, 75],
  stretch: [172, 172],
  write: [-35, -55],
  clap: [-40, -40],
  high: [16, 135],
  vote: [20, 165],
  beam: [90, 90],
};

export const ASPECT = VIEW_H / VIEW_W;

function Arm({ side, angle, children }: { side: "l" | "r"; angle: number; children?: ReactNode }) {
  const [sx, sy] = side === "l" ? SHOULDER_L : SHOULDER_R;
  const turn = side === "l" ? angle : -angle;
  const origin = `${sx}px ${sy}px`;
  return (
    <g className={styles.arm} data-side={side} style={{ transform: `rotate(${turn}deg)`, transformOrigin: origin }}>
      <g className={styles.wiggle} style={{ transformOrigin: origin }}>
      <path d={`M${sx} ${sy} L${sx} ${sy + ARM}`} />
      {children ? (
        // Turned back so whatever the hand holds stays upright.
        <g
          className={styles.held}
          style={{ transform: `rotate(${-turn}deg)`, transformOrigin: `${sx}px ${sy + ARM}px` }}
        >
          <g transform={`translate(${sx} ${sy + ARM})`}>{children}</g>
        </g>
      ) : null}
      </g>
    </g>
  );
}

function Flag({ fill }: { fill: string }) {
  return (
    <g className={styles.flag}>
      <path d="M0 4 V-62" className={styles.pole} />
      <path d="M2 -62 H38 L29 -49 L38 -36 H2 Z" style={{ fill }} />
    </g>
  );
}

function Glass() {
  return (
    <g>
      <path d="M0 0 L8 14" className={styles.pole} />
      <circle cx="17" cy="32" r="19" className={styles.lens} />
    </g>
  );
}

function Pad() {
  return (
    <g>
      <rect x="-4" y="-30" width="24" height="30" rx="3" className={styles.sheet} />
      <path d="M1 -22 H15 M1 -16 H13 M1 -10 H15" className={styles.lines} />
    </g>
  );
}

function Pencil() {
  return <path d="M-2 -2 L-12 -16" className={styles.pencil} />;
}

function Eyes({ m }: { m: Mid }) {
  const [lx, ly] = m.look;
  const shift = { transform: `translate(${lx * 6}px, ${ly * 5 + (m.eyes === "down" ? 7 : 0)}px)` };
  if (m.eyes === "happy" || m.eyes === "closed") {
    const d =
      m.eyes === "happy"
        ? "M484 498 Q493 484 502 498 M522 498 Q531 484 540 498"
        : "M484 494 Q493 503 502 494 M522 494 Q531 503 540 494";
    return (
      <g className={styles.eyes} style={shift}>
        <path d={d} className={styles.lid} />
      </g>
    );
  }
  const ry = m.eyes === "wide" ? 15 : m.eyes === "squint" ? 6 : m.eyes === "down" ? 11 : 13.5;
  const rx = m.eyes === "wide" ? 10 : 8.5;
  return (
    <g className={styles.eyes} style={shift}>
      <g className={styles.blink}>
        <ellipse cx="493" cy="494" rx={rx} ry={ry} />
        <ellipse cx="531" cy="494" rx={rx} ry={ry} />
      </g>
    </g>
  );
}

function Bubble({ kind }: { kind: NonNullable<Mid["bubble"]> }) {
  if (kind === "sleep" || kind === "note") {
    return (
      <span className={styles.float} data-kind={kind} aria-hidden>
        {kind === "sleep" ? (
          <>
            <i>z</i>
            <i>z</i>
          </>
        ) : (
          <svg viewBox="0 0 16 16">
            <path d="M6 12.5a2 2 0 1 1-1.2-1.8V3l7-1.5v8.3a2 2 0 1 1-1.2-1.8V4.1L6 5.1z" />
          </svg>
        )}
      </span>
    );
  }
  return (
    <span className={styles.bubble} data-kind={kind} aria-hidden>
      {kind === "talk" || kind === "dots" ? (
        <>
          <i />
          <i />
          <i />
        </>
      ) : kind === "web" ? (
        <svg viewBox="0 0 20 20">
          <path d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM2.5 10h15M10 2.5c2 2.2 3 4.7 3 7.5s-1 5.3-3 7.5c-2-2.2-3-4.7-3-7.5s1-5.3 3-7.5Z" />
        </svg>
      ) : kind === "think" ? (
        "?"
      ) : (
        "!"
      )}
    </span>
  );
}

const VOTE_FILL = {
  "flag-a": "var(--party-a-strong)",
  "flag-b": "var(--party-b-strong)",
  "flag-o": "var(--muted)",
} as const;

export function MidView({ m, size, delay, w, h }: { m: Mid; size: number; delay: number; w: number; h: number }) {
  const tall = size * ASPECT;
  // Further back is a touch smaller, so the floor reads as a floor.
  const depth = 0.82 + 0.18 * Math.min(1, Math.max(0, (m.y - 0.4) / 0.55));
  const [la, ra] = POSES[m.arms];
  const front = la < 0 || ra < 0;
  const flag = m.prop === "flag-a" || m.prop === "flag-b" || m.prop === "flag-o" ? VOTE_FILL[m.prop] : null;
  const pose: CSSProperties = {
    width: size,
    height: tall,
    transform: `translate(${m.x * w - size / 2}px, ${m.y * h - tall}px)`,
    transitionDuration: `${m.t}ms`,
    zIndex: Math.round(m.y * 100),
    ["--d" as string]: `${-delay}ms`,
  };

  const arms =
    m.arms === "beam" ? (
      <g className={styles.beam}>
        <path d="M428 506 H596" />
        <path d="M434 506 V490 M590 506 V490" className={styles.thin} />
        <ellipse cx="434" cy="488" rx="15" ry="5" style={{ fill: "var(--party-a-strong)" }} />
        <ellipse cx="590" cy="488" rx="15" ry="5" style={{ fill: "var(--party-b-strong)" }} />
      </g>
    ) : (
      <>
        <Arm side="l" angle={la}>
          {m.prop === "pad" ? <Pad /> : null}
        </Arm>
        <Arm side="r" angle={ra}>
          {flag ? <Flag fill={flag} /> : m.prop === "glass" ? <Glass /> : m.prop === "pad" ? <Pencil /> : null}
        </Arm>
      </>
    );

  return (
    <div className={styles.mid} style={pose} data-motion={m.motion} data-arms={m.arms} data-tint={m.tint ?? undefined}>
      <span className={styles.shadow} />
      <div className={styles.depth} style={{ transform: `scale(${depth.toFixed(3)})` }}>
        <div className={styles.lift}>
          <div className={styles.turn} style={{ transform: `scaleX(${m.face})` }}>
            <svg viewBox={VIEW} width={size} height={tall} aria-hidden>
              <g className={styles.limbs}>
                <g className={styles.leg} data-side="l" style={{ transformOrigin: "497px 550px" }}>
                  <path d="M497 550 L494 594" />
                </g>
                <g className={styles.leg} data-side="r" style={{ transformOrigin: "527px 550px" }}>
                  <path d="M527 550 L530 594" />
                </g>
              </g>
              <g className={styles.torso}>
                {front ? null : <g className={styles.limbs}>{arms}</g>}
                <circle cx="512" cy="500" r="56" className={styles.ball} />
                <Eyes m={m} />
                {m.prop === "paper" ? (
                  <g className={styles.pop}>
                    <rect x="482" y="510" width="60" height="68" rx="5" className={styles.sheet} />
                    <path d="M492 524 H532 M492 535 H526 M492 546 H532 M492 557 H520" className={styles.lines} />
                  </g>
                ) : m.prop === "book" ? (
                  <g className={styles.pop}>
                    <path d="M484 520 Q498 514 512 522 Q526 514 540 520 V560 Q526 554 512 562 Q498 554 484 560 Z" className={styles.sheet} />
                    <path d="M512 522 V562" className={styles.lines} />
                    <path d="M484 560 Q498 554 512 562 Q526 554 540 560" className={styles.cover} />
                  </g>
                ) : null}
                {front ? <g className={styles.limbs}>{arms}</g> : null}
              </g>
            </svg>
          </div>
          {m.bubble ? <Bubble kind={m.bubble} /> : null}
        </div>
      </div>
    </div>
  );
}
