import { describe, expect, it, vi } from "vitest";
import { agreements } from "../agreements/index.js";
import { grantAdmin } from "../grant-admin/index.js";
import { grants } from "../grants/index.js";
import { health } from "../health/index.js";
import { payments } from "../payments/index.js";
import { testEndpoints } from "../test-endpoints/index.js";
import { INBOX, OUTBOX, eventTypeNames } from "./event-types.js";
import { events } from "./index.js";

vi.mock("../common/mongo-client.js");

// Only what main.js registers is imported, so a declaration nothing reaches
// from the running service is missing here too.
describe("declared event types", () => {
  it("loads with the plugins main.js registers", () => {
    expect(
      [health, grants, agreements, grantAdmin, testEndpoints, events, payments]
        .map((plugin) => plugin.name)
        .every(Boolean),
    ).toBe(true);
  });

  it("lists every type the outbox sends", () => {
    expect(eventTypeNames(OUTBOX)).toEqual([
      "AgreementCreatedReport",
      "AgreementPaymentRequested",
      "AgreementStatusChangedReport",
      "AgreementStatusUpdated",
      "ApplicationCreated",
      "ApplicationStatusUpdated",
      "Audit",
      "ClaimPaymentRequested",
      "ClaimSubmitted",
      "CreateAgreement",
      "CreateAgreementPayment",
      "CreateCase",
      "UpdateAgreementStatus",
      "UpdateCaseStatus",
      "Unrecognised",
    ]);
  });

  it("lists every type the inbox receives", () => {
    expect(eventTypeNames(INBOX)).toEqual([
      "AgreementStatusUpdated",
      "CaseStatusUpdated",
      "ConfigVersionUpdated",
      "Unrecognised",
    ]);
  });

  // The same list is in fg-cw-backend's test of this name: an event carries
  // one name in the sender's outbox and the receiver's inbox.
  it("names the events that cross to and from Caseworking as Caseworking does", () => {
    const sent = ["ClaimSubmitted", "CreateCase", "UpdateCaseStatus"];
    const received = ["CaseStatusUpdated", "ConfigVersionUpdated"];

    expect(eventTypeNames(OUTBOX)).toEqual(expect.arrayContaining(sent));
    expect(eventTypeNames(INBOX)).toEqual(expect.arrayContaining(received));
  });

  it("names every type in the words the Event column shows, with no dots", () => {
    for (const name of [...eventTypeNames(OUTBOX), ...eventTypeNames(INBOX)]) {
      expect(name).toMatch(/^([A-Z][a-z]+)+$/);
    }
  });
});
