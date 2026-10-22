import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { saveEvents } from "../../events/index.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";
import {
  Agreement,
  AgreementHistoryEntry,
  AgreementServiceStatus,
  AgreementStatus,
} from "../models/agreement.js";
import {
  Application,
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../models/application.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { acceptAgreementUseCase } from "./accept-agreement.use-case.js";
import { addAgreementUseCase } from "./add-agreement.use-case.js";
import { applyAgreementTerminationUseCase } from "./apply-agreement-termination.use-case.js";
import { cancelAgreementUseCase } from "./cancel-agreement.use-case.js";
import { createAgreementCommandUseCase } from "./create-agreement-command.use-case.js";
import { requestAgreementCancellationUseCase } from "./request-agreement-cancellation.use-case.js";
import { requestAgreementTerminationUseCase } from "./request-agreement-termination.use-case.js";
import {
  isGrantProcess,
  processEffectsOf,
} from "./transition-application.use-case.js";
import { withdrawAgreementUseCase } from "./withdraw-agreement.use-case.js";
import { withdrawApplicationUseCase } from "./withdraw-application.use-case.js";

vi.mock("../../events/index.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../repositories/application.repository.js");

const AGREEMENT = "AGR-1";

const anApplication = (agreementStatus) =>
  new Application({
    currentPhase: ApplicationPhase.PreAward,
    currentStage: ApplicationStage.Assessment,
    currentStatus: ApplicationStatus.Review,
    clientRef: "client-ref",
    code: "woodland",
    phases: [],
    agreements: agreementStatus
      ? {
          [AGREEMENT]: new Agreement({
            agreementRef: AGREEMENT,
            date: "2026-01-01T12:00:00Z",
            latestStatus: agreementStatus,
            history: [
              new AgreementHistoryEntry({
                agreementStatus,
                createdAt: "2026-01-01T12:00:00Z",
              }),
            ],
          }),
        }
      : {},
  });

const command = {
  clientRef: "client-ref",
  code: "woodland",
  source: "AS",
  eventData: {
    agreementNumber: AGREEMENT,
    date: "2026-02-01T12:00:00Z",
    startDate: "2026-03-01",
    endDate: "2027-03-01",
  },
  requestedStatus: AgreementServiceStatus.Accepted,
};

// CW hears of an application's status only through this command.
const tellsCaseworking = () =>
  saveEvents.mock.calls.some(([publications]) =>
    publications.some(
      ({ event, target }) =>
        event instanceof UpdateCaseStatusCommand &&
        target === config.sns.updateCaseStatusTopicArn,
    ),
  );

describe("what each grant process declares it does", () => {
  beforeEach(() => {
    saveEvents.mockResolvedValue(undefined);
  });

  it.each([
    ["GENERATE_OFFER", createAgreementCommandUseCase, null],
    ["STORE_AGREEMENT_CASE", addAgreementUseCase, null],
    ["ACCEPT_AGREEMENT", acceptAgreementUseCase, AgreementStatus.Offered],
    ["CANCEL_AGREEMENT", cancelAgreementUseCase, AgreementStatus.Offered],
    [
      "REQUEST_AGREEMENT_CANCELLATION",
      requestAgreementCancellationUseCase,
      AgreementStatus.Offered,
    ],
    ["WITHDRAW_AGREEMENT", withdrawAgreementUseCase, AgreementStatus.Offered],
    [
      "REQUEST_AGREEMENT_TERMINATION",
      requestAgreementTerminationUseCase,
      AgreementStatus.Accepted,
    ],
    [
      "APPLY_AGREEMENT_TERMINATION",
      applyAgreementTerminationUseCase,
      AgreementStatus.Accepted,
    ],
  ])(
    "%s tells CW only if it declares so, and sets no status itself",
    async (process, handle, agreementStatus) => {
      const application = anApplication(agreementStatus);
      findByClientRefAndCode.mockResolvedValue(application);

      await handle(command, {});

      expect(tellsCaseworking()).toBe(processEffectsOf(process).tellsCw);
      expect(processEffectsOf(process).setsStatus).toBeNull();
      expect(application.currentStatus).toBe(ApplicationStatus.Review);
    },
  );

  it("REQUEST_APPLICATION_WITHDRAWAL sets and tells CW the status it declares when no agreement is on offer", async () => {
    const application = anApplication(null);
    findByClientRefAndCode.mockResolvedValue(application);

    await withdrawApplicationUseCase(command, {});

    expect(processEffectsOf("REQUEST_APPLICATION_WITHDRAWAL")).toEqual({
      process: "REQUEST_APPLICATION_WITHDRAWAL",
      setsStatus: application.currentStatus,
      tellsCw: tellsCaseworking(),
      onlyWhen: "no agreement is on offer",
    });
    expect(application.currentStatus).toBe(ApplicationStatus.Withdrawn);
  });

  it("REQUEST_APPLICATION_WITHDRAWAL does neither while an agreement is on offer", async () => {
    const application = anApplication(AgreementStatus.Offered);
    findByClientRefAndCode.mockResolvedValue(application);

    await withdrawApplicationUseCase(command, {});

    expect(tellsCaseworking()).toBe(false);
    expect(application.currentStatus).toBe(ApplicationStatus.Review);
  });

  it("has no effects for a process with no handler", () => {
    expect(isGrantProcess("SEND_POSTCARD")).toBe(false);
    expect(processEffectsOf("SEND_POSTCARD")).toBeNull();
  });
});
