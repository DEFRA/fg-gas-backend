import { expect, it } from "vitest";
import { toEtag } from "./agreement-etag.js";

it("includes the resolved Agreement definition version in the ETag", () => {
  expect(toEtag({ agreementNumber: "PMF123", version: 2 }, "1.4.0")).toBe(
    '"PMF123:2:1.4.0"',
  );
});
