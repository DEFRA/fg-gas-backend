import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { renderAgreementUseCase } from "./render-agreement.use-case.js";

vi.mock("../../common/mongo-client.js");

describe("renderAgreementUseCase", () => {
  const useCollections = ({ agreements, agreementVersions }) =>
    db.collection.mockImplementation((name) => {
      if (name === "agreement_versions") {
        return agreementVersions;
      }

      return agreements;
    });

  const agreementDocument = {
    _id: "agreement-id",
    agreementNumber: "PMF000000001",
    code: "pigs-might-fly",
    sbi: "106284736",
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z",
    items: [
      {
        agreementItemId: "agreement-item-id",
        clientRef: "PMF-APP-001",
        configVersion: "0.0.1",
        identifiers: {
          frn: "110000001",
          crn: "crn-1",
          defraId: "defra-id-1",
        },
        payload: {
          clientRef: "PMF-APP-001",
          code: "pigs-might-fly",
          identifiers: {
            sbi: "106284736",
          },
          answers: {
            businessName: "Mason House Farm",
            payment: {
              agreementLevelItems: {
                PMF0: {
                  code: "PMF0",
                  description: "No pigs fly safely",
                  annualPaymentPence: 0,
                },
                PMF1: {
                  code: "PMF1",
                  description: "Help pigs fly safely",
                  annualPaymentPence: 125000,
                },
              },
            },
          },
        },
        createdAt: "2026-06-01T10:00:00.000Z",
      },
    ],
  };

  const latestVersionDocument = {
    _id: "version-id",
    agreementId: "agreement-id",
    agreementNumber: "PMF000000001",
    sbi: "106284736",
    version: 1,
    createdAt: "2026-06-01T10:00:00.000Z",
    snapshot: {
      ...agreementDocument,
      items: [
        {
          ...agreementDocument.items[0],
          status: "offered",
          payment: null,
        },
      ],
    },
  };

  it("renders the PMF offered page from the latest Agreement version", async () => {
    const agreements = {
      findOne: vi.fn().mockResolvedValue(agreementDocument),
    };
    const agreementVersions = {
      findOne: vi.fn().mockResolvedValue(latestVersionDocument),
    };
    useCollections({ agreements, agreementVersions });

    const result = await renderAgreementUseCase({
      agreementNumber: "PMF000000001",
    });

    expect(result).toMatchObject({
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
    });
    expect(result.components).toContainEqual({
      component: "heading",
      level: 1,
      text: "Review your agreement offer",
    });
    expect(result.components).toContainEqual({
      component: "paragraph",
      text: "If you accept this agreement offer, the resulting agreement will be between Defra and:",
    });
    expect(result.components).toContainEqual({
      component: "paragraph",
      classes: "govuk-body govuk-!-font-weight-bold",
      items: [
        {
          component: "text",
          text: "Mason House Farm",
        },
        {
          component: "line-break",
        },
        {
          component: "text",
          text: "SBI: 106284736",
        },
      ],
    });
    expect(result.components).toContainEqual({
      component: "table",
      head: [{ text: "Pig Type" }, { text: "Amount" }],
      rows: [[{ text: "Help pigs fly safely" }, { text: "£1,250" }]],
    });
    expect(result.components).toContainEqual({
      component: "details",
      summaryItems: [
        {
          text: "If you need to make an update",
        },
      ],
      items: [
        {
          component: "paragraph",
          text: "Contact the Rural Payments Agency (RPA) if you have a query.",
        },
      ],
    });
    expect(result.actions).toEqual([
      {
        href: "/PMF000000001/accept",
        text: "Continue",
      },
    ]);
    expect(agreements.findOne).toHaveBeenCalledWith(
      {
        agreementNumber: "PMF000000001",
      },
      {
        session: undefined,
      },
    );
    expect(agreementVersions.findOne).toHaveBeenCalledWith(
      {
        agreementId: "agreement-id",
      },
      {
        sort: { version: -1 },
        session: undefined,
      },
    );
  });

  it("renders the PMF view page as a read-only draft agreement document", async () => {
    useCollections({
      agreements: {
        findOne: vi.fn().mockResolvedValue(agreementDocument),
      },
      agreementVersions: {
        findOne: vi.fn().mockResolvedValue(latestVersionDocument),
      },
    });

    const result = await renderAgreementUseCase({
      agreementNumber: "PMF000000001",
      page: "view",
    });

    expect(result.page).toEqual({
      id: "view",
      layout: "document",
      title: "Pigs Might Fly agreement document",
    });
    expect(result.actions).toEqual([]);
    expect(result.components).toContainEqual({
      component: "notification-banner",
      title: "This is a draft version of your agreement",
      items: expect.any(Array),
    });
    expect(result.components).toContainEqual({
      component: "watermark",
      header: "Draft Agreement",
      text: "DRAFT",
    });
    expect(result.components).toContainEqual({
      component: "summary-list",
      rows: expect.arrayContaining([
        {
          label: "Agreement start date",
          text: "XXXXX",
        },
      ]),
    });
  });

  it("renders the PMF accepted page like the WMP offer accepted confirmation", async () => {
    const acceptedVersionDocument = {
      ...latestVersionDocument,
      snapshot: {
        ...latestVersionDocument.snapshot,
        items: [
          {
            ...latestVersionDocument.snapshot.items[0],
            status: "accepted",
            acceptedAt: "2026-06-16T12:00:00.000Z",
            acceptedBy: "applicant",
            payment: {
              agreementStartDate: "2026-07-01",
              agreementEndDate: "2027-06-30",
            },
          },
        ],
      },
    };

    useCollections({
      agreements: {
        findOne: vi.fn().mockResolvedValue(agreementDocument),
      },
      agreementVersions: {
        findOne: vi.fn().mockResolvedValue(acceptedVersionDocument),
      },
    });

    const result = await renderAgreementUseCase({
      agreementNumber: "PMF000000001",
      page: "accepted",
    });

    expect(result.page).toEqual({
      id: "accepted",
      title: "Offer accepted",
    });
    expect(result.components).toContainEqual({
      component: "panel",
      title: "Agreement offer accepted",
      items: [
        {
          component: "text",
          text: "The start date for this agreement is",
        },
        {
          component: "line-break",
        },
        {
          component: "text",
          text: "1 July 2026",
        },
      ],
    });
    expect(result.components).toContainEqual({
      component: "paragraph",
      text: "Your agreement number is PMF000000001.",
    });
    expect(result.components).toContainEqual({
      component: "unordered-list",
      items: expect.arrayContaining([
        {
          component: "url",
          text: "your agreement document",
          href: "/PMF000000001",
          target: "_blank",
        },
      ]),
    });
  });

  it("renders the PMF accepted view page with duration, signature and data protection sections", async () => {
    const acceptedVersionDocument = {
      ...latestVersionDocument,
      snapshot: {
        ...latestVersionDocument.snapshot,
        items: [
          {
            ...latestVersionDocument.snapshot.items[0],
            status: "accepted",
            acceptedAt: "2026-06-16T12:00:00.000Z",
            acceptedBy: "applicant",
            payment: {
              agreementStartDate: "2026-07-01",
              agreementEndDate: "2027-06-30",
            },
          },
        ],
      },
    };

    useCollections({
      agreements: {
        findOne: vi.fn().mockResolvedValue(agreementDocument),
      },
      agreementVersions: {
        findOne: vi.fn().mockResolvedValue(acceptedVersionDocument),
      },
    });

    const result = await renderAgreementUseCase({
      agreementNumber: "PMF000000001",
      page: "view",
    });

    expect(result.components).toContainEqual({
      component: "heading",
      id: "schedule",
      level: 2,
      text: "Agreement duration",
    });
    expect(result.components).toContainEqual({
      component: "summary-list",
      rows: [
        {
          label: "Agreement Start Date:",
          text: "1 Jul 2026",
        },
        {
          label: "Agreement End Date:",
          text: "30 Jun 2027",
        },
      ],
    });
    expect(result.components).toContainEqual({
      component: "heading",
      id: "signature",
      level: 2,
      text: "Electronic signature",
    });
    expect(result.components).toContainEqual({
      component: "paragraph",
      items: [
        {
          component: "text",
          text: "The agreement comprising this agreement document, the terms and conditions and the payments has been accepted by ",
        },
        {
          component: "text",
          text: "Mason House Farm",
        },
        {
          component: "text",
          text: " on ",
        },
        {
          component: "text",
          text: "16 Jun 2026",
        },
        {
          component: "text",
          text: ".",
        },
      ],
    });
    expect(result.components).toContainEqual({
      component: "heading",
      id: "protection",
      level: 2,
      text: "Data protection",
    });
  });

  it("renders the PMF accept page with the Agreement item action target", async () => {
    useCollections({
      agreements: {
        findOne: vi.fn().mockResolvedValue(agreementDocument),
      },
      agreementVersions: {
        findOne: vi.fn().mockResolvedValue(latestVersionDocument),
      },
    });

    const result = await renderAgreementUseCase({
      agreementNumber: "PMF000000001",
      page: "accept",
    });

    expect(result.page).toEqual({
      id: "accept",
      title: "Accept your agreement offer",
    });
    expect(result.components).toContainEqual({
      component: "heading",
      level: 1,
      text: "Accept your agreement offer",
    });
    expect(result.actions).toEqual([
      {
        action: "/PMF000000001/actions/accept",
        checkbox: {
          name: "confirm",
          value: "confirmed",
          text: "I confirm I have read the information in this section and accept this agreement offer.",
        },
        fields: [
          { name: "code", value: "pigs-might-fly" },
          { name: "clientRef", value: "PMF-APP-001" },
          { name: "acceptedBy", value: "applicant" },
        ],
        text: "Accept agreement offer",
      },
    ]);
  });

  it("renders page titles from the Agreement definition config", async () => {
    useCollections({
      agreements: {
        findOne: vi.fn().mockResolvedValue(agreementDocument),
      },
      agreementVersions: {
        findOne: vi.fn().mockResolvedValue(latestVersionDocument),
      },
    });

    const result = await renderAgreementUseCase(
      {
        agreementNumber: "PMF000000001",
        page: "accept",
      },
      {
        getAgreementDefinition: () => ({
          pages: {
            accept: {
              title: "Config-defined accept page title",
              components: [
                {
                  component: "heading",
                  level: 1,
                  text: "Config-defined accept page title",
                },
              ],
            },
            offered: {
              title: "Config-defined offered page title",
              components: [],
            },
          },
        }),
      },
    );

    expect(result.page).toEqual({
      id: "accept",
      title: "Config-defined accept page title",
    });
    expect(result.components).toContainEqual({
      component: "heading",
      level: 1,
      text: "Config-defined accept page title",
    });
  });

  it("renders the config-backed Agreement item without PMF-specific item matching", async () => {
    const genericAgreement = {
      ...agreementDocument,
      agreementNumber: "CFG000000001",
      code: "configurable-grant",
      items: [
        {
          ...agreementDocument.items[0],
          payload: {
            ...agreementDocument.items[0].payload,
            code: "configurable-grant",
          },
        },
      ],
    };
    const genericVersion = {
      ...latestVersionDocument,
      agreementNumber: "CFG000000001",
      snapshot: {
        ...genericAgreement,
        items: [
          {
            ...genericAgreement.items[0],
            status: "offered",
          },
        ],
      },
    };
    useCollections({
      agreements: {
        findOne: vi.fn().mockResolvedValue(genericAgreement),
      },
      agreementVersions: {
        findOne: vi.fn().mockResolvedValue(genericVersion),
      },
    });

    const result = await renderAgreementUseCase(
      {
        agreementNumber: "CFG000000001",
      },
      {
        getAgreementDefinition: (agreementCode) => ({
          code: agreementCode,
          pages: {
            offered: {
              title: "Generic config-backed agreement",
              components: [
                {
                  component: "heading",
                  level: 1,
                  text: "$.agreement.code",
                },
              ],
            },
          },
        }),
      },
    );

    expect(result.agreement.code).toBe("configurable-grant");
    expect(result.page.title).toBe("Generic config-backed agreement");
    expect(result.components).toContainEqual({
      component: "heading",
      level: 1,
      text: "configurable-grant",
    });
  });

  it("throws not found when the Agreement does not exist", async () => {
    useCollections({
      agreements: {
        findOne: vi.fn().mockResolvedValue(null),
      },
      agreementVersions: {
        findOne: vi.fn(),
      },
    });

    await expect(
      renderAgreementUseCase({
        agreementNumber: "PMF000000001",
      }),
    ).rejects.toThrow(Boom.notFound("Agreement not found"));
  });
});
