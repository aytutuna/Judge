import type { FrameworkChoice } from "./types";

/** Narrowed to literal unions so dictionary lookups like
 * `t(lang, `preset.${p.id}.label`)` are statically typed (no `as Key` casts).
 * `label`/`blurb` stay as the English display fallbacks and the eval
 * script's vocabulary; `instruction` is model prompt text and stays English. */
export type PresetId = "balanced" | "outcomes" | "principles" | "fairness" | "loyalty";

export type Preset = {
  id: PresetId;
  label: string;
  emoji: string;
  blurb: string;
  instruction: string;
};

export const PRESETS: Preset[] = [
  {
    id: "balanced",
    label: "Balanced",
    emoji: "⚖️",
    blurb: "Common-sense mix",
    instruction:
      "Weigh values the way broadly shared common-sense morality does: outcomes, fairness, rights, and relationships all count, none automatically dominates, and the side most thoughtful, fair-minded people would back in this specific situation is favored.",
  },
  {
    id: "outcomes",
    label: "Outcomes",
    emoji: "🎯",
    blurb: "Results matter most",
    instruction:
      "Prioritize consequences: which position leads to the most overall wellbeing and the least harm, counting everyone affected equally.",
  },
  {
    id: "principles",
    label: "Principles",
    emoji: "📜",
    blurb: "Rules & rights first",
    instruction:
      "Prioritize duties, rights, promises, and consistency: a position that breaks a valid rule or right loses even if it produces better outcomes.",
  },
  {
    id: "fairness",
    label: "Fairness",
    emoji: "🤝",
    blurb: "Equal treatment",
    instruction:
      "Prioritize fairness: equal treatment, earned desert, honored agreements, and fair process outrank both raw outcomes and personal loyalty.",
  },
  {
    id: "loyalty",
    label: "Loyalty",
    emoji: "❤️",
    blurb: "People before rules",
    instruction:
      "Give extra weight to loyalty, care, and special obligations to family, friends, and team — relationships can outrank abstract rules and efficiency.",
  },
];

export type SliderId = "freedom_safety" | "individual_group" | "head_heart";

export type SliderDef = {
  id: SliderId;
  left: string;
  right: string;
};

export const SLIDERS: SliderDef[] = [
  { id: "freedom_safety", left: "Freedom", right: "Safety" },
  { id: "individual_group", left: "Individual", right: "Group" },
  { id: "head_heart", left: "Head", right: "Heart" },
];

export const DEFAULT_FRAMEWORK: FrameworkChoice = { preset: "balanced" };

export function getPreset(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/** Turn the user's framework choice into a judging instruction fragment. */
export function frameworkInstruction(choice: FrameworkChoice): string {
  const parts: string[] = [getPreset(choice.preset).instruction];
  for (const def of SLIDERS) {
    const v = choice.sliders?.[def.id];
    if (v === undefined || v === 50) continue;
    const toward = v < 50 ? def.left : def.right;
    const strength = Math.abs(v - 50) >= 35 ? "strongly" : "somewhat";
    parts.push(
      `When ${def.left.toLowerCase()} and ${def.right.toLowerCase()} conflict, lean ${strength} toward ${toward.toLowerCase()}.`,
    );
  }
  parts.push(
    "Use this framework to decide which side is more right: it should settle most values disputes, and only a clash it truly cannot rank is left conditional.",
  );
  return parts.join(" ");
}

/** Short human-readable label for a framework choice, for display. */
export function frameworkLabel(choice: FrameworkChoice): string {
  const preset = getPreset(choice.preset);
  const tweaks = SLIDERS.filter((s) => {
    const v = choice.sliders?.[s.id];
    return v !== undefined && v !== 50;
  }).map((s) => ((choice.sliders?.[s.id] ?? 50) < 50 ? s.left : s.right));
  return tweaks.length
    ? `${preset.emoji} ${preset.label} · ${tweaks.join(", ")}`
    : `${preset.emoji} ${preset.label}`;
}
