import { NeedsPanel } from "../features/needs/needs-panel.js";

/** Needs you — open `question` and `blocker` notes across sessions (design spec §8). */
export function NeedsYouView() {
  return (
    <section aria-labelledby="needs-you-heading" className="flex flex-col gap-4">
      <h2 id="needs-you-heading" className="text-xl font-semibold">
        Needs you
      </h2>
      <NeedsPanel />
    </section>
  );
}
