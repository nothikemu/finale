import { Dashboard } from "@/components/Dashboard";

// Panels read secrets and live upstream data per request, so the page is never
// prerendered at build time. Upstream results are cached in-process instead.
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main className="page">
      <h1 className="visually-hidden">nothikemu personal dashboard</h1>
      <Dashboard />
    </main>
  );
}
