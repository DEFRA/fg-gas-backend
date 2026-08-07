import { describe, expect, it } from "vitest";
import { Agreement } from "./agreement.js";

const offeredValues = () => ({
  application: { whitePigsCount: 5 },
  actions: [{ id: "action:1", code: "largeWhite" }],
  items: [],
  totalAmountPence: 5000,
});

const createAgreement = (overrides = {}) =>
  Agreement.create({
    agreementNumber: "PMF823153883",
    code: "pigs-might-fly",
    clientRef: "xnp-rr3-nfa",
    configVersion: "1.0.1",
    correlationId: "b5e8b244-6d60-42cd-8da6-3294c7439239",
    identifiers: { sbi: "300000069", frn: "1000000000" },
    values: offeredValues(),
    state: "offered",
    createdAt: "2026-07-17T11:29:00.000Z",
    ...overrides,
  });

describe("Agreement", () => {
  it("creates version 1 with immutable identity, offered values and equal timestamps", () => {
    const agreement = createAgreement();

    expect(agreement).toMatchObject({
      agreementNumber: "PMF823153883",
      version: 1,
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      configVersion: "1.0.1",
      correlationId: "b5e8b244-6d60-42cd-8da6-3294c7439239",
      identifiers: { sbi: "300000069", frn: "1000000000" },
      ...offeredValues(),
      state: "offered",
      createdAt: "2026-07-17T11:29:00.000Z",
      updatedAt: "2026-07-17T11:29:00.000Z",
    });
    expect(agreement).not.toHaveProperty("payload");
    expect(agreement).not.toHaveProperty("supplementaryData");
  });

  it("applies acceptance time produced by configured effects", () => {
    const agreement = createAgreement();

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
      ...offeredValues(),
    });
    expect(agreement).toMatchObject({
      state: "offered",
      version: 1,
      acceptedAt: undefined,
    });
  });

  it("preserves the original acceptance time on later transitions", () => {
    const agreement = new Agreement({
      ...createAgreement(),
      version: 2,
      state: "accepted",
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

  it("does not retain mutable references from creation", () => {
    const identifiers = { sbi: "300000069" };
    const values = offeredValues();
    const agreement = createAgreement({ identifiers, values });

    identifiers.sbi = "999999999";
    values.application.whitePigsCount = 99;
    values.actions[0].code = "changed";

    expect(agreement.identifiers.sbi).toBe("300000069");
    expect(agreement.application.whitePigsCount).toBe(5);
    expect(agreement.actions[0].code).toBe("largeWhite");
  });
});
