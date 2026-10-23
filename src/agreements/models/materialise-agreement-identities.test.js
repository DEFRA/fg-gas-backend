import { describe, expect, it } from "vitest";
import { agreementValueSchema } from "../schemas/agreement-value.schema.js";
import { Agreement } from "./agreement.js";
import {
  materialiseCreationIdentities,
  reconcileTransitionIdentities,
} from "./materialise-agreement-identities.js";

const validationOptions = {
  abortEarly: false,
  allowUnknown: false,
  convert: false,
};

const creationCandidate = () => ({
  application: {},
  actions: [{ ref: "new-action", code: "CSAM1" }],
  items: [{ ref: "new-item", code: "PA3" }],
  paymentSchedule: {
    instalments: [
      {
        dueDate: "2026-12-01",
        totalAmountPence: 200,
        lineItems: [
          { actionRef: "new-action", amountPence: 100 },
          { itemRef: "new-item", amountPence: 100 },
        ],
      },
    ],
  },
});

const currentAgreement = () => ({
  actions: [
    { id: "action:1", code: "CSAM1" },
    { id: "action:3", code: "REMOVED-ACTION" },
  ],
  items: [{ id: "item:2", code: "PA3" }],
  paymentSchedule: {
    instalments: [
      {
        id: "instalment:5",
        dueDate: "2026-11-01",
        totalAmountPence: 100,
        lineItems: [{ actionId: "action:1", amountPence: 100 }],
      },
    ],
  },
});

const transitionCandidate = () => ({
  application: {},
  actions: [
    { id: "action:1", code: "CSAM1" },
    { ref: "new-action", code: "CSAM2" },
  ],
  items: [
    { id: "item:2", code: "PA3" },
    { ref: "new-item", code: "PA4" },
  ],
  paymentSchedule: {
    instalments: [
      {
        id: "instalment:5",
        dueDate: "2026-11-01",
        totalAmountPence: 100,
        lineItems: [{ actionId: "action:1", amountPence: 100 }],
      },
      {
        dueDate: "2027-11-01",
        totalAmountPence: 200,
        lineItems: [
          { actionRef: "new-action", amountPence: 100 },
          { itemRef: "new-item", amountPence: 100 },
        ],
      },
    ],
  },
});

const duplicateReferenceCases = [
  [
    "creation",
    () => {
      const candidate = creationCandidate();
      candidate.actions.push({ ref: "new-action", code: "CSAM2" });
      return materialiseCreationIdentities(candidate);
    },
  ],
  [
    "transition",
    () => {
      const candidate = transitionCandidate();
      candidate.actions.push({ ref: "new-action", code: "CSAM3" });
      return reconcileTransitionIdentities(currentAgreement(), candidate);
    },
  ],
];

const unknownCandidateReferenceCases = [
  [
    "creation",
    () => {
      const candidate = creationCandidate();
      candidate.paymentSchedule.instalments[0].lineItems[0].actionRef =
        "missing-action";
      return materialiseCreationIdentities(candidate);
    },
  ],
  [
    "transition",
    () => {
      const candidate = transitionCandidate();
      candidate.paymentSchedule.instalments[1].lineItems[0].actionRef =
        "missing-action";
      return reconcileTransitionIdentities(currentAgreement(), candidate);
    },
  ],
];

const unknownExistingIdentityCases = [
  [
    "Revenue Action",
    "action:2",
    (candidate) => {
      candidate.actions[0].id = "action:2";
    },
  ],
  [
    "Capital Item",
    "item:1",
    (candidate) => {
      candidate.items[0].id = "item:1";
    },
  ],
  [
    "Payment Schedule Instalment",
    "instalment:4",
    (candidate) => {
      candidate.paymentSchedule.instalments[0].id = "instalment:4";
    },
  ],
];

describe("Agreement identity materialisation", () => {
  it("materialises creation identities and candidate references", () => {
    const values = materialiseCreationIdentities(creationCandidate());

    expect(values.actions).toEqual([{ id: "action:1", code: "CSAM1" }]);
    expect(values.items).toEqual([{ id: "item:1", code: "PA3" }]);
    expect(values.paymentSchedule.instalments).toEqual([
      {
        id: "instalment:1",
        dueDate: "2026-12-01",
        totalAmountPence: 200,
        lineItems: [
          { actionId: "action:1", amountPence: 100 },
          { itemId: "item:1", amountPence: 100 },
        ],
      },
    ]);
    expect(
      agreementValueSchema.validate(values, validationOptions).error,
    ).toBeUndefined();
  });

  it("creation ignores a candidate-supplied id", () => {
    const candidate = creationCandidate();
    candidate.actions[0].id = "action:9";
    candidate.items[0].id = "item:9";
    candidate.paymentSchedule.instalments[0].id = "instalment:9";

    const values = materialiseCreationIdentities(candidate);

    expect(values.actions[0].id).toBe("action:1");
    expect(values.items[0].id).toBe("item:1");
    expect(values.paymentSchedule.instalments[0].id).toBe("instalment:1");
  });

  it("preserves existing identities and allocates after current maxima", () => {
    const values = reconcileTransitionIdentities(
      currentAgreement(),
      transitionCandidate(),
    );

    expect(values.actions.map(({ id }) => id)).toEqual([
      "action:1",
      "action:4",
    ]);
    expect(values.items.map(({ id }) => id)).toEqual(["item:2", "item:3"]);
    expect(values.paymentSchedule.instalments.map(({ id }) => id)).toEqual([
      "instalment:5",
      "instalment:6",
    ]);
    expect(values.paymentSchedule.instalments[1].lineItems).toEqual([
      { actionId: "action:4", amountPence: 100 },
      { itemId: "item:3", amountPence: 100 },
    ]);
    expect(
      agreementValueSchema.validate(values, validationOptions).error,
    ).toBeUndefined();
  });

  it("does not reuse identities removed by an earlier transition", () => {
    const agreement = new Agreement({
      ...currentAgreement(),
      state: "offered",
      version: 1,
    });
    const withoutIdentities = agreement.transition({
      target: "offered",
      transitionedAt: "2026-11-01T00:00:00.000Z",
      values: reconcileTransitionIdentities(agreement, {
        application: {},
        actions: [],
        items: [],
      }),
    });
    const reloadedAgreement = new Agreement(structuredClone(withoutIdentities));
    const withNewIdentities = reconcileTransitionIdentities(
      reloadedAgreement,
      creationCandidate(),
    );

    expect(withNewIdentities.actions[0].id).toBe("action:4");
    expect(withNewIdentities.items[0].id).toBe("item:3");
    expect(withNewIdentities.paymentSchedule.instalments[0].id).toBe(
      "instalment:6",
    );
  });

  it.each(unknownExistingIdentityCases)(
    "rejects an unknown existing %s identity",
    (label, id, modifyCandidate) => {
      const candidate = transitionCandidate();
      modifyCandidate(candidate);

      expect(() =>
        reconcileTransitionIdentities(currentAgreement(), candidate),
      ).toThrow(
        `Agreement transition cannot select unknown stable ${label} identity "${id}"`,
      );
    },
  );

  it.each(duplicateReferenceCases)(
    "rejects duplicate %s candidate references",
    (_workflow, materialise) => {
      expect(materialise).toThrow("duplicate candidate reference");
    },
  );

  it.each(unknownCandidateReferenceCases)(
    "rejects unknown %s candidate references",
    (_workflow, materialise) => {
      expect(materialise).toThrow("unknown candidate reference");
    },
  );

  it("rejects persisted Payment Schedule references to removed entries", () => {
    const candidate = transitionCandidate();
    candidate.paymentSchedule.instalments[0].lineItems = [
      { actionId: "action:3", amountPence: 100 },
    ];

    expect(() =>
      reconcileTransitionIdentities(currentAgreement(), candidate),
    ).toThrow('unknown persisted reference "action:3"');
  });

  it.each(["actions", "items"])(
    "rejects a transition from an agreement without %s",
    (field) => {
      const agreement = currentAgreement();
      agreement[field] = undefined;

      expect(() =>
        reconcileTransitionIdentities(agreement, transitionCandidate()),
      ).toThrow(TypeError);
    },
  );

  it("allocates instalments from 1 when the agreement has no Payment Schedule", () => {
    const agreement = currentAgreement();
    delete agreement.paymentSchedule;
    const candidate = transitionCandidate();
    delete candidate.paymentSchedule.instalments[0].id;

    const values = reconcileTransitionIdentities(agreement, candidate);

    expect(values.paymentSchedule.instalments.map(({ id }) => id)).toEqual([
      "instalment:1",
      "instalment:2",
    ]);
  });
});
