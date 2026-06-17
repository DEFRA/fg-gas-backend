import { beforeEach, describe, expect, it, vi } from "vitest";
import { findAgreementWithLatestVersionBySourceIdentity } from "../repositories/agreement.repository.js";
import {
  getCurrentAgreementUseCase,
  postCurrentAgreementUseCase,
} from "./current-agreement.use-case.js";
import { renderAgreementRecord } from "./render-agreement.use-case.js";

vi.mock("../repositories/agreement.repository.js");
vi.mock("./render-agreement.use-case.js");

describe("current agreement use case", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    findAgreementWithLatestVersionBySourceIdentity.mockResolvedValue({
      agreement: {
        agreementNumber: "PMF000000001",
        sbi: "106284736",
      },
      version: {},
    });
  });

  it("renders the current agreement as a config-driven agreement model", async () => {
    renderAgreementRecord.mockResolvedValue({
      source: "config",
      agreement: {
        agreementNumber: "PMF000000001",
        code: "pigs-might-fly",
        clientRef: "PMF-APP-001",
        status: "offered",
        identifiers: {
          sbi: "106284736",
        },
      },
      page: {
        id: "offered",
        title: "Review your agreement offer",
      },
      components: [
        {
          component: "heading",
          level: 1,
          text: "Review your agreement offer",
        },
        {
          component: "paragraph",
          text: "If you accept this agreement offer, the resulting agreement will be between Defra and:",
        },
      ],
      actions: [],
    });

    const result = await getCurrentAgreementUseCase({
      clientRef: "PMF-APP-001",
      code: "pigs-might-fly",
      sbi: "106284736",
    });

    expect(renderAgreementRecord).toHaveBeenCalledWith({
      record: {
        agreement: {
          agreementNumber: "PMF000000001",
          sbi: "106284736",
        },
        version: {},
      },
      page: undefined,
    });
    expect(result).toMatchObject({
      source: "config",
      agreement: {
        agreementNumber: "PMF000000001",
      },
      page: {
        title: "Review your agreement offer",
      },
    });
    expect(result.components).toContainEqual({
      component: "heading",
      level: 1,
      text: "Review your agreement offer",
    });
  });

  it("passes the requested mode through as the config page", async () => {
    renderAgreementRecord.mockResolvedValue({
      source: "config",
      page: {
        id: "accept",
        title: "Accept your agreement offer",
      },
      components: [],
      actions: [],
    });

    await getCurrentAgreementUseCase({
      clientRef: "PMF-APP-001",
      code: "pigs-might-fly",
      mode: "accept",
      sbi: "106284736",
    });

    expect(renderAgreementRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        page: "accept",
      }),
    );
  });

  it("renders the accept page when posting the display accept action", async () => {
    renderAgreementRecord.mockResolvedValue({
      source: "config",
      page: {
        id: "accept",
        title: "Accept your agreement offer",
      },
      components: [],
      actions: [],
    });

    const result = await postCurrentAgreementUseCase({
      action: "display-accept",
      clientRef: "PMF-APP-001",
      code: "pigs-might-fly",
      formData: {},
      sbi: "106284736",
    });

    expect(renderAgreementRecord).toHaveBeenCalledWith({
      record: {
        agreement: {
          agreementNumber: "PMF000000001",
          sbi: "106284736",
        },
        version: {},
      },
      page: "accept",
    });
    expect(result.page.id).toBe("accept");
  });
});
