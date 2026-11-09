import { describe, expect, it, vi } from "vitest";
import { blurOnTapOutside } from "../components/shell/AppShell";

const field = () => ({ matches: vi.fn(() => true), blur: vi.fn() });
const target = (inside: boolean) => ({ closest: vi.fn(() => (inside ? {} : null)) }) as unknown as Element;

describe("blurOnTapOutside", () => {
  it("puts the keyboard away on a touch tap on plain page space", () => {
    const active = field();
    blurOnTapOutside("touch", active as unknown as HTMLElement, target(false));
    expect(active.blur).toHaveBeenCalledOnce();
  });

  it("leaves taps on controls, mouse clicks and non-text focus alone", () => {
    const active = field();
    blurOnTapOutside("touch", active as unknown as HTMLElement, target(true));
    blurOnTapOutside("mouse", active as unknown as HTMLElement, target(false));
    const button = { matches: vi.fn(() => false), blur: vi.fn() };
    blurOnTapOutside("touch", button as unknown as HTMLElement, target(false));
    blurOnTapOutside("touch", null, target(false));
    expect(active.blur).not.toHaveBeenCalled();
    expect(button.blur).not.toHaveBeenCalled();
  });
});
