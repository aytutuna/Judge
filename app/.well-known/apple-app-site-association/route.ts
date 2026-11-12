const APP_ID = "8XT2U634Z4.com.okjudge.judge";

/** Universal links for the iOS app: the case and invite pages open in it. The
 * file has no extension and must be plain JSON with no redirect, so it is a
 * route rather than a file in public/. */
export function GET() {
  return Response.json(
    {
      applinks: {
        details: [
          {
            appIDs: [APP_ID],
            components: [{ "/": "/c/*" }, { "/": "/r/*" }],
            // The older format, read before iOS 13.
            appID: APP_ID,
            paths: ["/c/*", "/r/*"],
          },
        ],
        apps: [],
      },
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
