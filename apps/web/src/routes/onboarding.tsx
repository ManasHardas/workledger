import { HOME_HREF } from "../lib/router.js";

/**
 * `#/onboarding` — the wizard of docs/contracts/p8/daemon-and-api.md §Wizard routes lands in
 * #79. Until then the route exists so Home's "Add projects" has somewhere real to point, and so
 * `workledger open` on a machine with no repos does not land on a blank page.
 */
export function OnboardingView() {
  return (
    <section aria-labelledby="onboarding-heading" className="flex flex-col gap-4">
      <h2 id="onboarding-heading" className="text-xl font-semibold">
        Add projects
      </h2>
      <p className="text-sm text-muted-foreground">Onboarding coming in #79.</p>
      <a
        href={HOME_HREF}
        className="w-fit rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← Home
      </a>
    </section>
  );
}
