import { PageBody, PageHeader } from "../components/ui/page.js";
import { HealthReport } from "../features/health/health-report.js";

/** Health — per harness, last hook seen, hooks present, CLI version, index size (design spec §8). */
export function HealthView() {
  return (
    <>
      <PageHeader title="Health" />
      <PageBody rhythm="home">
        <HealthReport />
      </PageBody>
    </>
  );
}
