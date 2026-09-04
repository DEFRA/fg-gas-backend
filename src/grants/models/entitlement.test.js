import { describe, expect, it } from "vitest";
import { Entitlement } from "./entitlement.js";

const props = {
  clientRef: "wmp-abc-123",
  code: "woodland",
  claimCode: "ENT_CS_CAPITAL_PA3",
  instanceNumber: 1,
  configVersion: "1.1.0",
  data: { totalHectares: 455000, actionCode: "PA3" },
};

describe("Entitlement", () => {
  it("creates a record with a generated id and createdAt", () => {
    const entitlement = Entitlement.create(props);

    expect(entitlement).toMatchObject(props);
    expect(entitlement.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(entitlement.createdAt).getTime()).not.toBeNaN();
  });

  it("is immutable", () => {
    const entitlement = Entitlement.create(props);

    expect(() => {
      entitlement.claimCode = "ENT_OTHER";
    }).toThrow();
    expect(() => {
      entitlement.data.totalHectares = 1;
    }).toThrow();
  });

  it("refuses a record with no data", () => {
    expect(() => Entitlement.create({ ...props, data: {} })).toThrow(
      /Invalid Entitlement/,
    );
  });

  it("refuses a record missing its claim code", () => {
    const { claimCode, ...rest } = props;

    expect(() => Entitlement.create(rest)).toThrow(/Invalid Entitlement/);
  });

  it("refuses a record without an entitlement instance number", () => {
    const { instanceNumber, ...rest } = props;

    expect(() => Entitlement.create(rest)).toThrow(/Invalid Entitlement/);
  });

  it("strips unknown keys", () => {
    const entitlement = Entitlement.create({ ...props, rogue: true });

    expect(entitlement.rogue).toBeUndefined();
  });

  describe("nextInstanceNumber", () => {
    it("returns one when there are no existing entitlements", () => {
      expect(Entitlement.nextInstanceNumber([])).toBe(1);
    });

    it("returns the lowest unused positive instance number", () => {
      expect(
        Entitlement.nextInstanceNumber([
          { instanceNumber: 1 },
          { instanceNumber: 3 },
          { instanceNumber: 4 },
        ]),
      ).toBe(2);
    });

    it("ignores missing and non-integer instance numbers", () => {
      expect(
        Entitlement.nextInstanceNumber([
          { instanceNumber: 2 },
          { instanceNumber: 1.5 },
          {},
        ]),
      ).toBe(1);
    });
  });
});
