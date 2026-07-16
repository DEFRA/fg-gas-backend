import { describe, expect, it } from "vitest";
import { AgreementItem } from "./agreement-item.js";
import { AgreementReference } from "./agreement-reference.js";
import { AgreementVersion } from "./agreement-version.js";
import { Agreement } from "./agreement.js";
import { CurrentAgreement } from "./current-agreement.js";

const reference = new AgreementReference({
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
});

const item = new AgreementItem({
  agreementItemId: "item-1",
  agreementCode: reference.code,
  clientRef: reference.clientRef,
  sourceSystem: "GAS",
  configVersion: "0.0.1",
  identifiers: { sbi: reference.sbi },
  payload: {},
  createdAt: "2026-07-16T00:00:00.000Z",
  state: "accepted",
});

const snapshot = new Agreement({
  agreementNumber: reference.agreementNumber,
  code: reference.code,
  identifiers: { sbi: reference.sbi },
  items: [item],
});

const version = new AgreementVersion({
  agreementNumber: reference.agreementNumber,
  version: 2,
  snapshot,
});

describe("CurrentAgreement", () => {
  it("exposes the latest matching Agreement item in domain language", () => {
    const currentAgreement = new CurrentAgreement({ reference, version });

    expect(currentAgreement).toMatchObject({
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      configVersion: "0.0.1",
      state: "accepted",
      item,
      reference,
      snapshot,
      version,
    });
  });

  it("matches its complete Agreement Reference", () => {
    const currentAgreement = new CurrentAgreement({ reference, version });

    expect(currentAgreement.matchesReference(reference)).toBe(true);
    expect(
      currentAgreement.matchesReference(
        new AgreementReference({
          ...reference,
          agreementNumber: "PMF000000000",
        }),
      ),
    ).toBe(false);
  });

  it("rejects a latest version that does not contain the referenced item", () => {
    const inconsistentVersion = new AgreementVersion({
      agreementNumber: reference.agreementNumber,
      version: 2,
      snapshot: new Agreement({
        agreementNumber: reference.agreementNumber,
        code: reference.code,
        identifiers: { sbi: reference.sbi },
        items: [],
      }),
    });

    expect(
      () => new CurrentAgreement({ reference, version: inconsistentVersion }),
    ).toThrow('Agreement "PMF823153883" latest version is inconsistent');
  });

  it("rejects a persisted Agreement item without a Config Version", () => {
    const unversionedItem = new AgreementItem({
      ...item,
      configVersion: undefined,
    });
    const unversionedVersion = new AgreementVersion({
      agreementNumber: reference.agreementNumber,
      version: 2,
      snapshot: new Agreement({
        agreementNumber: reference.agreementNumber,
        code: reference.code,
        identifiers: { sbi: reference.sbi },
        items: [unversionedItem],
      }),
    });

    expect(
      () => new CurrentAgreement({ reference, version: unversionedVersion }),
    ).toThrow('Agreement "PMF823153883" latest version has no Config Version');
  });
});
