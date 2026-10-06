import { describe, expect, it } from "vitest";
import {
  getRequestContext,
  withRequestContext,
} from "../common/get-request-context.js";
import { setAuditActor } from "./set-audit-actor.js";

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const h = { continue: Symbol("continue") };

const run = (headers) => {
  const context = {};

  const answer = withRequestContext(context, () =>
    setAuditActor({ headers }, h),
  );

  return { context, answer };
};

describe("setAuditActor", () => {
  it("records the operator's Entra object id as the audit user", () => {
    const { context, answer } = run({ "x-actor-id": OID });

    expect(context.user).toBe(OID);
    expect(answer).toBe(h.continue);
  });

  it("records nothing without the header", () => {
    expect(run({}).context.user).toBeUndefined();
  });

  it("ignores a value that is not an object id", () => {
    for (const value of ["jo@example.com", `${OID}x`, "", "{" + OID + "}"]) {
      expect(run({ "x-actor-id": value }).context.user).toBeUndefined();
    }
  });

  it("continues outside a request context", () => {
    expect(getRequestContext()).toBeNull();
    expect(setAuditActor({ headers: { "x-actor-id": OID } }, h)).toBe(
      h.continue,
    );
  });
});
