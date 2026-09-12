import { AllNeedsPanel } from "../features/needs/all-needs-panel.js";

/** Review, machine-wide — open `question` and `blocker` notes across every repo (P8). */
export function AllNeedsView() {
  return (
    <section aria-labelledby="review-heading" className="flex flex-col gap-4">
      <h2 id="review-heading" className="text-xl font-extrabold">
        Review
      </h2>
      <p className="text-sm text-muted-foreground">Across every project on this machine.</p>
      <AllNeedsPanel />
    </section>
  );
}
