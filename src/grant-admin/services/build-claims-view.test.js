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
    entitlements: [],
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

  // Both are stubbed until entitlement instances are written.
  it("returns nothing claimable when nothing has been created", async () => {
    const result = await buildClaimsView(
      overview({ creationOptions: [template] }),
    );

    expect(result.claimableEntitlements).toEqual([]);
    expect(result.claims).toEqual([]);
  });

  it("returns the entitlements that already exist as claimable", async () => {
    const existing = [{ id: "ent-1", claimCode: "ENT_PA3" }];

    const result = await buildClaimsView(overview({ entitlements: existing }));

    expect(result.claimableEntitlements).toEqual(existing);
  });
});
