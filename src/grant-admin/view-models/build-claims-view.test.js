import { describe, expect, it } from "vitest";
import {
  buildClaimsView,
  buildClaimView,
  buildEntitlementView,
} from "./build-claims-view.js";

const banner = {
  title: { label: "Applicant", text: "test", type: "string" },
  summary: {
    sbi: { label: "SBI", text: "sbi-1", type: "string" },
  },
};

const template = {
  claimCode: "ENT_PA3",
  name: "PA3 entitlement",
  materialised: false,
  maxEntitlements: 1,
};

const overview = (overrides = {}) => ({
  banner,
  creationOptions: [],
  claimableEntitlements: [],
  claimsRequiredRoles: null,
  access: "full",
  claims: [],
  claimPayments: new Set(),
  ...overrides,
});

const submittedClaim = (overrides = {}) => ({
  clientClaimRef: "WMP-001-C01",
  claimCode: "ENT_PA3",
  name: "PA3 entitlement",
  quantity: { value: 4.2, unit: "HA" },
  totalClaimAmountPence: 150000,
  requiresApproval: false,
  submittedAt: "2026-09-15T12:50:08.932Z",
  ...overrides,
});

describe("build claims view", () => {
  it("returns the banner it is given, as supplied", () => {
    expect(buildClaimsView(overview()).banner).toBe(banner);
  });

  it("returns the access decision and the roles it was made against", () => {
    const result = buildClaimsView(
      overview({
        access: "view-only",
        claimsRequiredRoles: { allOf: ["ROLE_CLAIMS"] },
      }),
    );

    expect(result.access).toBe("view-only");
    expect(result.claimsRequiredRoles).toEqual({ allOf: ["ROLE_CLAIMS"] });
  });

  it("returns the entitlements alongside it", () => {
    const result = buildClaimsView(overview({ creationOptions: [template] }));

    expect(result.availableEntitlements).toEqual([template]);
  });

  it("keeps remaining capacity out of the entitlements a case officer can create", () => {
    const result = buildClaimsView(
      overview({ creationOptions: [{ ...template, remainingCapacity: 3 }] }),
    );

    expect(result.availableEntitlements).toEqual([template]);
  });

  it("returns nothing claimable when nothing has been created", () => {
    const result = buildClaimsView(overview({ creationOptions: [template] }));

    expect(result.claimableEntitlements).toEqual([]);
    expect(result.claims).toEqual([]);
  });

  it("marks a claim with a Payment as scheduled", () => {
    const claim = submittedClaim();

    const result = buildClaimsView(
      overview({
        claims: [claim],
        claimPayments: new Set([claim.clientClaimRef]),
      }),
    );

    expect(result.claims).toEqual([{ ...claim, paymentScheduled: true }]);
  });

  it("leaves a claim with no Payment unscheduled", () => {
    const claim = submittedClaim();

    const result = buildClaimsView(overview({ claims: [claim] }));

    expect(result.claims).toEqual([{ ...claim, paymentScheduled: false }]);
  });

  // The Payment a claim raised is its own, so one scheduled claim must not
  // speak for another on the same application.
  it("schedules each claim on its own Payment", () => {
    const paid = submittedClaim({ clientClaimRef: "WMP-001-C01" });
    const unpaid = submittedClaim({ clientClaimRef: "WMP-001-C02" });

    const result = buildClaimsView(
      overview({
        claims: [paid, unpaid],
        claimPayments: new Set([paid.clientClaimRef]),
      }),
    );

    expect(result.claims.map((claim) => claim.paymentScheduled)).toEqual([
      true,
      false,
    ]);
  });

  it("returns the supplied claimable entitlements", () => {
    const claimable = [
      { entitlementId: "ent-1", claimCode: "ENT_PA3", canEdit: true },
    ];

    const result = buildClaimsView(
      overview({ claimableEntitlements: claimable }),
    );

    expect(result.claimableEntitlements).toEqual(claimable);
  });

  it("leaves out anything the view does not name", () => {
    const result = buildClaimsView(
      overview({ entitlements: [{ entitlementId: "ent-1" }] }),
    );

    expect(result).not.toHaveProperty("entitlements");
  });
});

describe("build claim view", () => {
  it("shows the template being created against and no submitted claims", () => {
    const result = buildClaimView(
      overview({
        creationDetails: { ...template, remainingCapacity: 2 },
      }),
    );

    expect(result.entitlementTemplate).toEqual(template);
    expect(result).not.toHaveProperty("claims");
  });
});

describe("build entitlement view", () => {
  it("shows the entitlement being changed and the template it was made under", () => {
    const claimableEntitlement = {
      entitlementId: "ent-1",
      claimCode: "ENT_PA3",
      canEdit: true,
    };

    const result = buildEntitlementView(
      overview({
        claimableEntitlement,
        entitlementTemplate: { ...template, remainingCapacity: 2 },
      }),
    );

    expect(result.claimableEntitlement).toEqual(claimableEntitlement);
    expect(result.entitlementTemplate).toEqual(template);
    expect(result.claims).toEqual([]);
  });
});
