import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Component tests opt into jsdom per file (`// @vitest-environment jsdom`).
// Only there is there a document to clean between tests. Vitest does not
// expose `afterEach` globally, so Testing Library's own auto-cleanup never
// runs; register it here instead.
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);
}
