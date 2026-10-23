import { describe, expect, it } from "vitest";
import { resolveAgreementIdentitySequence } from "./agreement-identity-sequence.js";

const currentValues = () => ({
  actions: [{ id: "action:1" }, { id: "action:3" }],
  items: [{ id: "item:2" }],
  paymentSchedule: {
    instalments: [{ id: "instalment:4" }, { id: "instalment:1" }],
  },
});

describe("resolveAgreementIdentitySequence", () => {
  it("keeps a recorded sequence ahead of the current identities", () => {
    const sequence = resolveAgreementIdentitySequence({
      ...currentValues(),
      identitySequence: { action: 7, item: 5, instalment: 9 },
    });

    expect(sequence).toEqual({ action: 7, item: 5, instalment: 9 });
    expect(Object.keys(sequence)).toEqual(["action", "item", "instalment"]);
  });

  it("uses the current identities when they are ahead of the recorded sequence", () => {
    expect(
      resolveAgreementIdentitySequence({
        ...currentValues(),
        identitySequence: { action: 2, item: 1, instalment: 3 },
      }),
    ).toEqual({ action: 3, item: 2, instalment: 4 });
  });

  it.each([-1, 1.5, "3", 2 ** 53])(
    "ignores the invalid recorded ordinal %s",
    (ordinal) => {
      expect(
        resolveAgreementIdentitySequence({
          ...currentValues(),
          identitySequence: {
            action: ordinal,
            item: ordinal,
            instalment: ordinal,
          },
        }),
      ).toEqual({ action: 3, item: 2, instalment: 4 });
    },
  );

  it("counts identities that do not match their namespace as 0", () => {
    expect(
      resolveAgreementIdentitySequence({
        actions: [{ id: "action:0" }, { id: "action:01" }, { id: "item:2" }],
        items: [{}],
        paymentSchedule: { instalments: [{ id: "instalment:abc" }] },
      }),
    ).toEqual({ action: 0, item: 0, instalment: 0 });
  });

  it("gives 0 when actions, items and the payment schedule are absent", () => {
    expect(resolveAgreementIdentitySequence({})).toEqual({
      action: 0,
      item: 0,
      instalment: 0,
    });
  });

  it("throws a TypeError for a non-string id, as it does today", () => {
    expect(() =>
      resolveAgreementIdentitySequence({ actions: [{ id: 1 }] }),
    ).toThrow(TypeError);
  });
});
