// First-visit flag of the onboarding guide (#58). Kept in localStorage through the never-throwing wrapper:
// where storage is unavailable the guide simply shows again on the next visit.
import { storage } from "./storage";

export const ONBOARDING_KEY = "csm.onboarding";
/** Bump to show a substantially rewritten guide once more to returning users. */
export const ONBOARDING_VERSION = "1";

export const onboardingSeen = () => storage.get(ONBOARDING_KEY) === ONBOARDING_VERSION;
export const markOnboardingSeen = () => storage.set(ONBOARDING_KEY, ONBOARDING_VERSION);

/** Guide pages: a title and a few bullet points each (i18n keys tour.<id>.title / tour.<id>.<n>). */
export const TOUR_STEPS = [
  { id: "welcome", items: 4 },
  { id: "open", items: 3 },
  { id: "view", items: 4 },
  { id: "site", items: 3 },
  { id: "feat", items: 4 },
  { id: "compare", items: 3 },
] as const;
