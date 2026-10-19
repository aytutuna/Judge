/**
 * Stable machine codes for every API error. Web and mobile clients localize
 * from `code`; `error` stays English for logs and non-UI consumers.
 * Pure module: no Next, DOM or Node imports, so a React Native app can reuse it.
 */

/** Default HTTP status per code. Existing free-path responses keep their
 * historical statuses (e.g. "unavailable" is 502 when every judge failed). */
export const API_ERROR_STATUS = {
  invalid: 400,
  too_short: 400,
  too_long: 400,
  signin_required: 401,
  premium_required: 402,
  no_credits: 402,
  fair_use: 402,
  captcha_failed: 403,
  bad_origin: 403,
  not_found: 404,
  in_progress: 409,
  rate_limited: 429,
  quota: 502,
  unavailable: 503,
  daily_cap: 503,
  not_configured: 503,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

export type ApiErrorBody = {
  error: string;
  code: ApiErrorCode;
  /** Seconds until a retry can succeed (rate_limited, daily_cap). */
  retryAfterSec?: number;
  /** ISO time the fair-use allowance resets (fair_use). */
  resetsAt?: string;
};

export function apiErrorBody(
  code: ApiErrorCode,
  error: string,
  extra: Omit<ApiErrorBody, "code" | "error"> = {},
): ApiErrorBody {
  return { error, code, ...extra };
}

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(API_ERROR_STATUS, value);
}
