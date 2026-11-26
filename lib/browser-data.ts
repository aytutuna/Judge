import { forgetAllCaseNames } from "./case-names-store";
import { forgetLocalHistory } from "./history-store";
import { forgetLastSignIn } from "./last-signin";
import { forgetAllOwnerTokens } from "./owner-store";

/** What an account leaves in this browser: real names, the last sign-in
 * address, the signed-out lists and owner tokens. Language, appearance and
 * the usage switch belong to nobody and stay. */
export function forgetBrowserData(): void {
  forgetAllCaseNames();
  forgetLastSignIn();
  forgetLocalHistory();
  forgetAllOwnerTokens();
}
