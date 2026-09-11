import { HealthReport } from "../features/health/health-report.js";

/** Health — per harness, last hook seen, hooks present, CLI version, index size (design spec §8). */
export function HealthView() {
  return (
    <section aria-labelledby="health-heading" className="flex flex-col gap-4">
      <h2 id="health-heading" className="text-xl font-extrabold">
        Health
      </h2>
      <HealthReport />
    </section>
  );
}
