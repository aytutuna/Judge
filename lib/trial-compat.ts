/** Request header of a client that knows the "minor" objection outcome
 * ("Judge-Trial: minor"). Builds without it would show an outcome they do not
 * know as real doubt about the ruling, so they are sent "survived" instead. */
export const TRIAL_HEADER = "Judge-Trial";

export function acceptsMinor(req: Request): boolean {
  return (req.headers.get(TRIAL_HEADER) ?? "")
    .split(",")
    .some((v) => v.trim().toLowerCase() === "minor");
}

/** A copy of a JSON value with every crux_trial outcome "minor" turned into
 * "survived". Everything else, including the input, is left alone. */
export function withoutMinor<T>(value: T): T {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const w = withoutMinor(v);
      if (w !== v) changed = true;
      return w;
    });
    return (changed ? out : value) as T;
  }
  if (value === null || typeof value !== "object") return value;
  const src = value as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(src)) {
    let w = withoutMinor(v);
    if (k === "crux_trial" && w && typeof w === "object" && (w as { outcome?: unknown }).outcome === "minor") {
      w = { ...(w as object), outcome: "survived" };
    }
    if (w !== v) (out ??= { ...src })[k] = w;
  }
  return (out ?? value) as T;
}

/** The response as this client can read it: untouched for a client that
 * sends Judge-Trial: minor, else with minor outcomes shown as survived. */
export async function forTrialClient(req: Request, res: Response): Promise<Response> {
  if (acceptsMinor(req) || !res.headers.get("content-type")?.includes("json")) return res;
  const text = await res.text();
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  let body = text;
  if (text.includes('"minor"')) {
    try {
      body = JSON.stringify(withoutMinor(JSON.parse(text)));
    } catch {
      // not JSON after all: send it as it was
    }
  }
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

export function trialCompat<A extends unknown[]>(
  handler: (req: Request, ...rest: A) => Response | Promise<Response>,
): (req: Request, ...rest: A) => Promise<Response> {
  return async (req, ...rest) => forTrialClient(req, await handler(req, ...rest));
}
