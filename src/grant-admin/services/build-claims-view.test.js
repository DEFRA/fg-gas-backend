import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildClaimsView } from "./build-claims-view.js";

vi.mock("../../common/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const code = "grant-1";
const clientRef = "application-1";

const claimsPage = {
  claims: {
    details: {
      banner: {
        title: { text: "$.answers.answer1", type: "string" },
        summary: {
          applicationId: {
            label: "Application ID",
            text: "$.clientRef",
            type: "string",
          },
          sbi: { label: "SBI", text: "$.identifiers.sbi", type: "string" },
        },
      },
    },
  },
};

const template = {
  claimCode: "ENT_PA3",
  name: "PA3 entitlement",
  materialised: false,
  maxEntitlements: 1,
};

describe("build claims view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const overview = (overrides = {}) => ({
    claimsPage: claimsPage.claims,
    applicationContext: {
      clientRef,
      code,
      identifiers: { sbi: "sbi-1" },
      answers: { answer1: "test" },
    },
    creationOptions: [],
    claimableEntitlements: [],
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

  it("returns the banner the grant configures, resolved", async () => {
    const { banner } = await buildClaimsView(overview());

    expect(banner.title.text).toBe("test");
    expect(banner.summary.applicationId.text).toBe(clientRef);
    expect(banner.summary.sbi.text).toBe("sbi-1");
  });

  // A page headed by nothing tells a case officer less than an honest 404.
  it("refuses a grant that configures no claims page", async () => {
    await expect(
      buildClaimsView(overview({ claimsPage: undefined })),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });

  it("returns the entitlements alongside it", async () => {
    const result = await buildClaimsView(
      overview({ creationOptions: [template] }),
    );

    expect(result.banner).toBeDefined();
    expect(result.availableEntitlements).toEqual([template]);
  });

  it("returns nothing claimable when nothing has been created", async () => {
    const result = await buildClaimsView(
      overview({ creationOptions: [template] }),
    );

    expect(result.claimableEntitlements).toEqual([]);
    expect(result.claims).toEqual([]);
  });

  it("marks a claim with a Payment as scheduled", async () => {
    const claim = submittedClaim();

    const result = await buildClaimsView(
      overview({
        claims: [claim],
        claimPayments: new Set([claim.clientClaimRef]),
      }),
    );

    expect(result.claims).toEqual([{ ...claim, paymentScheduled: true }]);
  });

  it("leaves a claim with no Payment unscheduled", async () => {
    const claim = submittedClaim();

    const result = await buildClaimsView(overview({ claims: [claim] }));

    expect(result.claims).toEqual([{ ...claim, paymentScheduled: false }]);
  });

  // The Payment a claim raised is its own, so one scheduled claim must not
  // speak for another on the same application.
  it("scheduled each claim on its own Payment", async () => {
    const paid = submittedClaim({ clientClaimRef: "WMP-001-C01" });
    const unpaid = submittedClaim({ clientClaimRef: "WMP-001-C02" });

    const result = await buildClaimsView(
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

  it("returns the supplied claimable entitlements", async () => {
    const claimable = [
      { entitlementId: "ent-1", claimCode: "ENT_PA3", canEdit: true },
    ];

    const result = await buildClaimsView(
      overview({ claimableEntitlements: claimable }),
    );

    expect(result.claimableEntitlements).toEqual(claimable);
  });
});
