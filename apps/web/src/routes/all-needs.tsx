import { AllNeedsPanel } from "../features/needs/all-needs-panel.js";

/** Needs you, machine-wide — open `question` and `blocker` notes across every repo (P8). */
export function AllNeedsView() {
  return (
    <section aria-labelledby="needs-you-heading" className="flex flex-col gap-4">
      <h2 id="needs-you-heading" className="text-xl font-semibold">
        Needs you
      </h2>
      <p className="text-sm text-muted-foreground">Across every project on this machine.</p>
      <AllNeedsPanel />
    </section>
  );
}
