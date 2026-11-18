import { freshVenue, type Venue } from "./venues";

// The place the home court shows. Kept for as long as the page lives, so the
// scene a case is judged in is the one the writer was looking at; it is
// re-picked only once a send went through.
let held: Venue | null = null;

export function homeVenue(): Venue {
  held ??= freshVenue();
  return held;
}

/** A send went through: the next argument gets a new place. */
export function repickHomeVenue(): Venue {
  held = freshVenue();
  return held;
}

export type HeldRequest = { request: string; key: string; venue: Venue };

/** The key and venue of a verdict or case request. The same request keeps
 * both across retries; a different one gets a new key and the home venue. */
export function holdRequest(held: HeldRequest | null, request: string, venue: Venue, newKey: () => string): HeldRequest {
  return held?.request === request ? held : { request, key: newKey(), venue };
}
