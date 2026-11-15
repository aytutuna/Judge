import { vi } from "vitest";
import { loadLocales } from "../lib/i18n";

// Server code loads every enabled language before it writes text; tests
// render components and prompts in those languages directly.
await loadLocales();

// Route tests sign in as accounts that never ticked the private-details
// agreement, so the gate lets everyone through. A test of the gate points it
// back at the real function with mockImplementation.
vi.mock("../lib/feedback/agreement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/feedback/agreement")>()),
  agreementRefusal: vi.fn(async () => null),
}));
