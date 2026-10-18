/**
 * Tests never talk to Gemini: drop any key from the environment and make
 * requests to the Gemini host fail fast instead of going over the network.
 */

export const GEMINI_HOST = "generativelanguage.googleapis.com";

delete process.env.GEMINI_API_KEY;

const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url, "http://localhost").hostname === GEMINI_HOST) {
    return Promise.reject(new Error(`blocked in tests: ${url}`));
  }
  return realFetch(input, init);
};
