import { caseUpdateSupplementaryData } from "../grants/commands/update-case-supplementary-data.command.js";
import {
  AGREEMENT_CREATED,
  AGREEMENT_STATUS_CHANGED,
} from "@defra/grants-reporting-publisher";
import { describe, expect, it, vi } from "vitest";
// Every plugin main.js registers is loaded, so the boxes list every type the
// running service declares.
import "../agreements/index.js";
import "../grants/index.js";
import "../payments/index.js";
import "./index.js";
import { toRefs } from "../common/buckets/refs.js";
import { agreementPaymentRequested } from "../agreements/events/agreement-payment-requested.event.js";
import {
  reportingAgreementCreated,
  reportingAgreementStatusChanged,
} from "../agreements/events/agreement-reporting.event.js";
import { agreementStatusUpdated } from "../agreements/events/agreement-status-updated.event.js";
import { caseCreate } from "../grants/commands/create-new-case.command.js";
import { caseUpdateStatus } from "../grants/commands/update-case-status.command.js";
import { applicationCreated } from "../grants/events/application-created.event.js";
import { applicationStatusUpdated } from "../grants/events/application-status-updated.event.js";
import { claimPaymentRequested } from "../grants/events/claim-payment-requested.event.js";
import { agreementCreate } from "../grants/events/create-agreement.command.js";
import {
  caseStatusUpdated,
  configVersionUpdated,
} from "../grants/events/inbound-event-types.js";
import { agreementStatusUpdate } from "../grants/events/update-agreement-status.command.js";
import { agreementCreatePayment } from "../payments/events/create-payment.event.js";
import {
  INBOX,
  OUTBOX,
  UNRECOGNISED,
  eventTypeNames,
  findEventType,
} from "./event-types.js";

vi.mock("../common/mongo-client.js");

const GAS = "cloud.defra.local.fg-gas-backend.";

const declared = [
  {
    eventType: caseUpdateSupplementaryData,
    sentAs: `${GAS}case.update.supplementary.data`,
    boxes: [OUTBOX],
    event: { data: { workflowCode: "woodland", caseRef: "abc-123" } },
    refs: [
      ["ref", "abc-123"],
      ["case", "woodland:abc-123"],
      ["ref", "abc-123"],
      ["application", "woodland:abc-123"],
    ],
  },

  {
    eventType: applicationCreated,
    sentAs: `${GAS}application.created`,
    boxes: [OUTBOX],
    event: { data: { code: "example-grant", clientRef: "abc-123" } },
    refs: [
      ["ref", "abc-123"],
      ["application", "example-grant:abc-123"],
    ],
  },
  {
    eventType: applicationStatusUpdated,
    sentAs: `${GAS}application.status.updated`,
    boxes: [OUTBOX],
    event: { data: { grantCode: "example-grant", clientRef: "abc-123" } },
    refs: [
      ["ref", "abc-123"],
      ["application", "example-grant:abc-123"],
    ],
  },
  {
    eventType: caseCreate,
    sentAs: `${GAS}case.create`,
    boxes: [OUTBOX],
    event: {
      data: {
        workflowCode: "example-grant",
        caseRef: "abc-124",
        previousCaseRef: "abc-123",
      },
    },
    refs: [
      ["ref", "abc-124"],
      ["case", "example-grant:abc-124"],
      ["ref", "abc-123"],
      ["case", "example-grant:abc-123"],
      ["ref", "abc-124"],
      ["application", "example-grant:abc-124"],
      ["ref", "abc-123"],
      ["application", "example-grant:abc-123"],
    ],
  },
  {
    eventType: caseUpdateStatus,
    sentAs: `${GAS}case.update.status`,
    boxes: [OUTBOX],
    event: { data: { workflowCode: "example-grant", caseRef: "abc-123" } },
    refs: [
      ["ref", "abc-123"],
      ["case", "example-grant:abc-123"],
      ["ref", "abc-123"],
      ["application", "example-grant:abc-123"],
    ],
  },
  {
    eventType: agreementCreate,
    sentAs: `${GAS}agreement.create`,
    boxes: [OUTBOX],
    event: { data: { code: "example-grant", clientRef: "abc-123" } },
    refs: [
      ["ref", "abc-123"],
      ["application", "example-grant:abc-123"],
    ],
  },
  {
    eventType: agreementStatusUpdate,
    sentAs: `${GAS}agreement.status.update`,
    boxes: [OUTBOX],
    event: {
      data: {
        code: "example-grant",
        clientRef: "abc-123",
        agreementNumber: "FPTT000000001",
      },
    },
    refs: [
      ["ref", "abc-123"],
      ["application", "example-grant:abc-123"],
    ],
  },
  {
    eventType: agreementPaymentRequested,
    sentAs: `${GAS}agreement.payment.requested`,
    boxes: [OUTBOX],
    event: {
      data: {
        code: "example-grant",
        source: { agreementNumber: "FPTT000000001" },
      },
    },
    refs: [],
  },
  {
    eventType: claimPaymentRequested,
    sentAs: `${GAS}claim.payment.requested`,
    boxes: [OUTBOX],
    event: {
      data: {
        source: {
          code: "example-grant",
          clientRef: "abc-123",
          clientClaimRef: "claim-1",
        },
        agreement: { agreementNumber: "FPTT000000001" },
      },
    },
    refs: [
      ["ref", "abc-123"],
      ["application", "example-grant:abc-123"],
    ],
  },
  {
    eventType: agreementStatusUpdated,
    sentAs: "io.onsite.agreement.status.updated",
    boxes: [OUTBOX, INBOX],
    event: {
      data: {
        code: "example-grant",
        clientRef: "abc-123",
        agreementNumber: "FPTT000000001",
        sbi: "900000001",
      },
    },
    refs: [
      ["ref", "abc-123"],
      ["application", "example-grant:abc-123"],
    ],
  },
  {
    eventType: agreementCreatePayment,
    sentAs: "io.onsite.agreement.create-payment",
    boxes: [OUTBOX],
    event: {
      data: {
        sbi: "900000001",
        frn: "1000000001",
        grants: [{ agreementNumber: "FPTT000000001" }],
      },
    },
    row: { segregationRef: "FPTT000000001" },
    refs: [["ref", null]],
  },
  {
    eventType: reportingAgreementCreated,
    sentAs: undefined,
    boxes: [OUTBOX],
    event: {
      eventData: {
        eventType: AGREEMENT_CREATED,
        agreementType: "example-grant",
        agreementId: "FPTT000000001",
        sbi: "900000001",
      },
    },
    refs: [],
  },
  {
    eventType: reportingAgreementStatusChanged,
    sentAs: undefined,
    boxes: [OUTBOX],
    event: {
      eventData: {
        eventType: AGREEMENT_STATUS_CHANGED,
        agreementId: "FPTT000000001",
      },
    },
    refs: [],
  },
  {
    eventType: caseStatusUpdated,
    sentAs: "cloud.defra.local.fg-cw-backend.case.status.updated",
    boxes: [INBOX],
    event: { data: { workflowCode: "example-grant", caseRef: "abc-123" } },
    refs: [
      ["ref", "abc-123"],
      ["case", "example-grant:abc-123"],
      ["ref", "abc-123"],
      ["application", "example-grant:abc-123"],
    ],
  },
  {
    eventType: configVersionUpdated,
    sentAs: "config-version.updated",
    boxes: [INBOX],
    event: { data: { grantCode: "example-grant", version: "1.2.3" } },
    refs: [
      ["ref", "example-grant"],
      ["config", "example-grant@1~2e.2~2e.3"],
    ],
  },
];

describe.each(declared)(
  "$eventType.name",
  ({ eventType, sentAs, boxes, event, row = {}, refs }) => {
    it("is sent as its envelope type, to its boxes", () => {
      expect(eventType.sentAs).toBe(sentAs);
      expect(eventType.boxes).toEqual(boxes);
    });

    it("is found from its envelope", () => {
      expect(findEventType({ type: sentAs, ...event })).toBe(eventType);
    });

    it("reads its refs from the envelope", () => {
      expect(eventType.refs(event, row)).toEqual(refs);
    });

    it("never throws for an envelope that holds nothing", () => {
      expect(() => eventType.refs({}, {})).not.toThrow();
      expect(() => eventType.refs({ data: null }, {})).not.toThrow();
    });
  },
);

describe("agreement.create-payment", () => {
  it("takes a claim's client reference from the row's ordering key", () => {
    const refs = agreementCreatePayment.refs(
      { data: { grants: [{ agreementNumber: "FPTT000000001" }] } },
      { segregationRef: "abc-123" },
    );

    expect(refs).toContainEqual(["ref", "abc-123"]);
  });
});

// Every type a box lists concerns an application unless it says why not here.
const notApplicationEvents = {
  Audit: "written by its own writer, found by its trace",
  AgreementPaymentRequested: "an agreement's, with no client reference",
  AgreementCreatedReport: "an agreement's, with no client reference",
  AgreementStatusChangedReport: "an agreement's, with no client reference",
  ConfigVersionUpdated: "a grant's, not an application's",
  CreateAgreementPayment: "linked by its publication, from the Payment",
};

const isApplicationLink = ([kind, value]) =>
  kind === "application" && value !== null;

const isLinked = (name) =>
  declared.some(
    ({ eventType, refs }) =>
      eventType.name === name && refs.some(isApplicationLink),
  );

describe("every type a box lists", () => {
  const listed = [
    ...new Set([...eventTypeNames(OUTBOX), ...eventTypeNames(INBOX)]),
  ].filter((name) => name !== UNRECOGNISED);

  it.each(listed)(
    "%s is linked to its application, or says why not",
    (name) => {
      expect(isLinked(name)).toBe(!Object.hasOwn(notApplicationEvents, name));
    },
  );
});

describe("config-version.updated", () => {
  it("keeps a mixed-case code's case in its link", () => {
    expect(
      configVersionUpdated.refs(
        { data: { grantCode: "Example_Grant", version: "1.0.0" } },
        {},
      ),
    ).toEqual([
      ["ref", "Example_Grant"],
      ["config", "~45.xample~5f.~47.rant@1~2e.0~2e.0"],
    ]);
  });

  it("is found by its code alone when it names no version", () => {
    expect(
      toRefs(
        configVersionUpdated.refs({ data: { grantCode: "woodland" } }, {}),
      ),
    ).toEqual(["ref:woodland"]);
  });

  it("is found by no reference when it names no grant", () => {
    expect(
      toRefs(
        configVersionUpdated.refs(
          { data: { version: "1.0.0" } },
          { segregationRef: "unknown-grant" },
        ),
      ),
    ).toEqual([]);
  });
});
