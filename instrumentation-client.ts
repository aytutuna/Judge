import * as Sentry from "@sentry/nextjs";
import { sentryOptions, withoutConsole } from "@/lib/sentry";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    ...sentryOptions,
    // Click breadcrumbs describe the element by its attributes, which could
    // carry text from a case. Release-health sessions would ping on every
    // page view.
    integrations: (defaults) => [
      ...withoutConsole(defaults).filter((i) => i.name !== "BrowserSession" && i.name !== "Breadcrumbs"),
      Sentry.breadcrumbsIntegration({ dom: false }),
    ],
  });
}
