import {
  AGREEMENT_CREATED,
  AGREEMENT_STATUS_CHANGED,
  validateReportingEvent,
} from "@defra/grants-reporting-publisher";
import { describe, expect, it } from "vitest";
import { config } from "../../common/config.js";
import {
  createAgreementCreatedReportingPublication,
  createAgreementStatusChangedReportingPublication,
} from "./agreement-reporting.event.js";

const agreement = {
  agreementNumber: "WMP123456789",
  correlationId: "agreement-correlation-id",
  code: "woodland",
  state: "offered",
  identifiers: { sbi: "200000001" },
  startDate: "2026-09-01",
  endDate: "2029-08-31",
  totalAmountPence: 157500,
  createdAt: "2026-08-20T09:00:00.000Z",
  updatedAt: "2026-08-20T09:00:00.000Z",
  parcels: [
    {
      id: "SD8545-9935",
      sheetId: "SD8545",
      parcelId: "9935",
      area: { quantity: 15.75, unit: "ha" },
    },
  ],
  actions: [
    {
      id: "action:1",
      code: "WMP1",
      parcel: "SD8545-9935",
      startDate: "2026-10-01",
      endDate: "2027-09-30",
      quantity: 10.5,
      unit: "ha",
      totalAmountPence: 105000,
    },
  ],
  items: [
    {
      id: "item:1",
      code: "TE4",
      quantity: 2,
      unit: "items",
      totalAmountPence: 52500,
    },
  ],
};

describe("Agreement reporting events", () => {
  it("maps a created Agreement and its funded entries to the reporting contract", () => {
    const result = createAgreementCreatedReportingPublication(agreement);

    expect(result).toEqual({
      target: config.sns.reportingEventsTopicArn,
      segregationRef: "WMP123456789",
      event: {
        correlationId: "agreement-correlation-id",
        datetime: "2026-08-20T09:00:00.000Z",
        version: "1.0.0",
        application: "GAS",
        service: "grants",
        eventData: {
          eventType: AGREEMENT_CREATED,
          agreementId: "WMP123456789",
          agreementType: "woodland",
          agreementStatus: "offered",
          agreementStartDate: "2026-09-01",
          agreementEndDate: "2029-08-31",
          agreementValue: 1575,
          sbi: "200000001",
          options: [
            {
              parcelReference: "SD8545-9935",
              parcelSizeUnderAgreement: 15.75,
              optionCode: "WMP1",
              optionStartDate: "2026-10-01",
              optionEndDate: "2027-09-30",
              optionQuantity: 10.5,
              optionValue: 1050,
            },
            {
              parcelReference: "",
              optionCode: "TE4",
              optionStartDate: "2026-09-01",
              optionEndDate: "2029-08-31",
              optionQuantity: 2,
              optionValue: 525,
            },
          ],
        },
      },
    });
    expect(validateReportingEvent(result.event).valid).toBe(true);
  });

  it("omits incomplete funded entries rather than inventing required reporting values", () => {
    const result = createAgreementCreatedReportingPublication({
      ...agreement,
      startDate: undefined,
      endDate: undefined,
      totalAmountPence: undefined,
      actions: [
        {
          id: "action:1",
          code: "CMOR1",
          parcel: "SD8545-9935",
          quantity: 0.0321,
          unit: "ha",
        },
      ],
      items: [],
    });

    expect(result.event.eventData).toEqual({
      eventType: AGREEMENT_CREATED,
      agreementId: "WMP123456789",
      agreementType: "woodland",
      agreementStatus: "offered",
      sbi: "200000001",
      options: [],
    });
  });

  it("maps a status transition from the resulting Agreement", () => {
    const transitioned = {
      ...agreement,
      state: "accepted",
      updatedAt: "2026-09-02T10:00:00.000Z",
    };

    const result =
      createAgreementStatusChangedReportingPublication(transitioned);

    expect(result).toEqual({
      target: config.sns.reportingEventsTopicArn,
      segregationRef: "WMP123456789",
      event: {
        correlationId: "agreement-correlation-id",
        datetime: "2026-09-02T10:00:00.000Z",
        version: "1.0.0",
        application: "GAS",
        service: "grants",
        eventData: {
          eventType: AGREEMENT_STATUS_CHANGED,
          agreementId: "WMP123456789",
          agreementStatus: "accepted",
          statusDate: "2026-09-02T10:00:00.000Z",
          agreementStartDate: "2026-09-01",
          agreementEndDate: "2029-08-31",
          agreementValue: 1575,
        },
      },
    });
    expect(validateReportingEvent(result.event).valid).toBe(true);
  });

  it("rejects a created event when required Agreement identity is absent", () => {
    expect(() =>
      createAgreementCreatedReportingPublication({
        ...agreement,
        identifiers: {},
      }),
    ).toThrow('Invalid Agreement reporting event: "eventData.sbi" is required');
  });
});
