import { loadLocales } from "../lib/i18n";

// Server code loads every enabled language before it writes text; tests
// render components and prompts in those languages directly.
await loadLocales();
