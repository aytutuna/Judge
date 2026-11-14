/** Ids of verdicts just judged in this tab. The verdict page asks once, so a
 * reload or a link opened later does not count as fresh. */
const fresh = new Set<string>();

export const markFresh = (id: string) => void fresh.add(id);
export const isFresh = (id: string) => fresh.has(id);
export const clearFresh = (id: string) => void fresh.delete(id);
