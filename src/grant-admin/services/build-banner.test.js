import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { buildBanner } from "./build-banner.js";

vi.mock("../../common/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const application = {
  clientRef: "wood-1001",
  code: "woodland",
  currentStatus: "STATUS_PREPARING_CLAIM",
  identifiers: { sbi: "113598882" },
  phases: [
    {
      code: "PHASE_PRE_AWARD",
      answers: { applicant: { business: { name: "Elmwood Land Co" } } },
    },
  ],
};

const grantWith = (banner) => ({ pages: { claims: { details: { banner } } } });

const banner = {
  title: { text: "$.answers.applicant.business.name", type: "string" },
  summary: {
    scheme: {
      label: "Scheme",
      text: "Woodland Management Plan",
      type: "string",
    },
    sbi: { label: "SBI", text: "$.identifiers.sbi", type: "string" },
  },
};

const build = (grant) => buildBanner({ grant, application, page: "claims" });

describe("buildBanner", () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
  });

  it("resolves a reference to the answer it points at", async () => {
    const result = await build(grantWith(banner));

    expect(result.title).toEqual({
      text: "Elmwood Land Co",
      type: "string",
    });
  });

  it("resolves each summary field, keeping its label", async () => {
    const { summary } = await build(grantWith(banner));

    expect(summary.sbi).toEqual({
      label: "SBI",
      text: "113598882",
      type: "string",
    });
  });

  // A scheme name that never varies is written as itself.
  it("leaves literal text alone", async () => {
    const { summary } = await build(grantWith(banner));

    expect(summary.scheme.text).toBe("Woodland Management Plan");
  });

  it("resolves a jsonata expression", async () => {
    const { title } = await build(
      grantWith({
        title: {
          text: "jsonata:$.clientRef & ' (' & $.identifiers.sbi & ')'",
          type: "string",
        },
      }),
    );

    expect(title.text).toBe("wood-1001 (113598882)");
  });

  // One missing answer is a gap in a header, not a reason to refuse the
  // entitlements underneath it.
  it("drops a field it cannot resolve and warns", async () => {
    const { summary, title } = await build(
      grantWith({
        title: { text: "$.answers.neverAsked.about", type: "string" },
        summary: {
          sbi: { label: "SBI", text: "$.identifiers.sbi", type: "string" },
          missing: {
            label: "Missing",
            text: "$.answers.nothing",
            type: "string",
          },
        },
      }),
    );

    expect(title).toBeUndefined();
    expect(summary.sbi.text).toBe("113598882");
    expect(summary.missing).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  // A page headed by nothing tells a case officer less than an honest 404 does.
  it("refuses a page the grant configures no banner for", async () => {
    await expect(build({ code: "woodland", pages: undefined })).rejects.toThrow(
      'Grant "woodland" configures no "claims" page',
    );
    await expect(
      build({ code: "woodland", pages: { payments: {} } }),
    ).rejects.toThrow(/configures no "claims" page/);
  });

  it("refuses with a 404 rather than a server error", async () => {
    await expect(
      build({ code: "woodland", pages: undefined }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });

  it("has an empty summary when the banner configures none", async () => {
    const result = await build(
      grantWith({ title: { text: "$.clientRef", type: "string" } }),
    );

    expect(result).toEqual({
      title: { text: "wood-1001", type: "string" },
      summary: {},
    });
  });
});
