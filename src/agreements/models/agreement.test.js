import { describe, expect, it } from "vitest";
import { Agreement } from "./agreement.js";

describe("Agreement", () => {
  it("creates version 1 with immutable identity and equal timestamps", () => {
    const identifiers = { sbi: "300000069", frn: "1000000000" };
    const payload = { whitePigsCount: 5 };

    const agreement = Agreement.create({
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      configVersion: "1.0.1",
      correlationId: "b5e8b244-6d60-42cd-8da6-3294c7439239",
      identifiers,
      payload,
      state: "offered",
      createdAt: "2026-07-17T11:29:00.000Z",
    });

    expect(agreement).toEqual({
      agreementNumber: "PMF823153883",
      version: 1,
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      configVersion: "1.0.1",
      correlationId: "b5e8b244-6d60-42cd-8da6-3294c7439239",
      identifiers,
      payload,
      state: "offered",
      createdAt: "2026-07-17T11:29:00.000Z",
      updatedAt: "2026-07-17T11:29:00.000Z",
      acceptedAt: undefined,
      paymentCalculation: undefined,
      supplementaryData: undefined,
    });
  });

  it("applies acceptance time produced by configured effects", () => {
    const agreement = Agreement.create({
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      configVersion: "1.0.1",
      identifiers: { sbi: "300000069" },
      payload: {},
      state: "offered",
      createdAt: "2026-07-17T11:29:00.000Z",
    });

    const accepted = agreement.transition({
      target: "accepted",
      transitionedAt: "2026-07-18T09:15:00.000Z",
      changes: { acceptedAt: "2026-07-18T09:14:00.000Z" },
    });

    expect(accepted).toMatchObject({
      state: "accepted",
      version: 2,
      updatedAt: "2026-07-18T09:15:00.000Z",
      acceptedAt: "2026-07-18T09:14:00.000Z",
    });
    expect(agreement).toMatchObject({
      state: "offered",
      version: 1,
      acceptedAt: undefined,
    });
  });

  it("preserves the original acceptance time on later transitions", () => {
    const agreement = new Agreement({
      agreementNumber: "PMF823153883",
      version: 2,
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      configVersion: "1.0.1",
      correlationId: "b5e8b244-6d60-42cd-8da6-3294c7439239",
      identifiers: { sbi: "300000069" },
      payload: {},
      state: "accepted",
      createdAt: "2026-07-17T11:29:00.000Z",
      updatedAt: "2026-07-18T09:15:00.000Z",
      acceptedAt: "2026-07-18T09:15:00.000Z",
    });

    const terminated = agreement.transition({
      target: "terminated",
      transitionedAt: "2026-07-19T10:00:00.000Z",
      changes: { acceptedAt: "2026-07-19T10:00:00.000Z" },
    });

    expect(terminated.acceptedAt).toBe("2026-07-18T09:15:00.000Z");
  });

  it("does not retain mutable references from the creation command", () => {
    const identifiers = { sbi: "300000069" };
    const payload = { applicant: { name: "A Farmer" } };
    const agreement = Agreement.create({
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      configVersion: "1.0.1",
      identifiers,
      payload,
      state: "offered",
    });

    identifiers.sbi = "999999999";
    payload.applicant.name = "Another Farmer";

    expect(agreement.identifiers.sbi).toBe("300000069");
    expect(agreement.payload.applicant.name).toBe("A Farmer");
  });
});
