import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeleteAccountPage } from "../components/DeleteAccountPage";
import { t } from "../lib/i18n";

vi.mock("../components/shell/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

describe("DeleteAccountPage", () => {
  it("names the app and the steps, with the contact address", () => {
    const html = renderToStaticMarkup(<DeleteAccountPage contactEmail="support@okjudge.com" />);
    for (const key of ["deletePage.lead", "deletePage.app", "deletePage.web", "deletePage.removed", "deletePage.kept"] as const) {
      expect(html).toContain(esc(t("en", key)));
    }
    expect(html).toContain("Delete your Judge");
    expect(html).toContain("mailto:support@okjudge.com");
  });

  it("leaves out the email section without an address", () => {
    const html = renderToStaticMarkup(<DeleteAccountPage contactEmail={null} />);
    expect(html).not.toContain(esc(t("en", "deletePage.mailTitle")));
  });
});
