import { describe, expect, it } from "vitest";
import { toTestAgreementResponse } from "./to-test-agreement-response.js";

const agreement = {
  agreementNumber: "PMF823153889",
  version: 2,
  code: "pigs-might-fly",
  clientRef: "pmf-test-client",
  configVersion: "1.0.1",
  correlationId: "corr-1",
  identifiers: { sbi: "300000071", frn: "1101234567" },
  application: { whitePigsCount: 5 },
  startDate: "2026-08-01",
  endDate: "2027-07-31",
  actions: [{ id: "action:1", code: "largeWhite" }],
  items: [],
  totalAmountPence: 5000,
  paymentSchedule: { instalments: [{ id: "instalment:1" }] },
  state: "withdrawn",
  createdAt: "2026-07-15T12:00:00.000Z",
  updatedAt: "2026-07-16T12:00:00.000Z",
  // Internal bookkeeping that must not leak.
  identitySequence: { action: 1, item: 0, instalment: 1 },
  acceptedAt: "2026-07-16T12:00:00.000Z",
};

describe("toTestAgreementResponse", () => {
  it("maps the stable response fields from the Agreement", () => {
    const response = toTestAgreementResponse(agreement);

    expect(response).toEqual({
      agreementNumber: "PMF823153889",
      version: 2,
      code: "pigs-might-fly",
      clientRef: "pmf-test-client",
      configVersion: "1.0.1",
      correlationId: "corr-1",
      identifiers: { sbi: "300000071", frn: "1101234567" },
      application: { whitePigsCount: 5 },
      startDate: "2026-08-01",
      endDate: "2027-07-31",
      actions: [{ id: "action:1", code: "largeWhite" }],
      items: [],
      totalAmountPence: 5000,
      paymentSchedule: { instalments: [{ id: "instalment:1" }] },
      state: "withdrawn",
      createdAt: "2026-07-15T12:00:00.000Z",
      updatedAt: "2026-07-16T12:00:00.000Z",
    });
  });

  it("does not leak internal Agreement fields", () => {
    const response = toTestAgreementResponse(agreement);

    expect(response).not.toHaveProperty("identitySequence");
    expect(response).not.toHaveProperty("acceptedAt");
  });

  it("omits fields the Agreement does not define", () => {
    const response = toTestAgreementResponse({
      agreementNumber: "FPTT123456789",
      code: "frps-private-beta",
      clientRef: "fptt-client",
      state: "offered",
      version: 1,
    });

    expect(response).not.toHaveProperty("paymentSchedule");
    expect(response).not.toHaveProperty("actions");
    expect(response).not.toHaveProperty("createdAt");
  });
});
