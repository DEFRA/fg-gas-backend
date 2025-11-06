import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApplication } from "../../../test/helpers/applications.js";
import { withTransaction } from "../../common/with-transaction.js";
import { Agreement } from "../models/agreement.js";
import { Application } from "../models/application.js";
import { update } from "../repositories/application.repository.js";
import { applyExternalStateChange } from "../services/apply-event-status-change.service.js";
import { addAgreementUseCase } from "./add-agreement.use-case.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

vi.mock("../services/apply-event-status-change.service.js");
vi.mock("./find-application-by-client-ref-and-code.use-case.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/outbox.repository.js");

describe("addAgreementUseCase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T10:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    const mockSession = {};
    withTransaction.mockImplementation(async (cb) => cb(mockSession));

    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(
      createTestApplication({
        clientRef: "test-client-ref",
        code: "test-code",
      }),
    );

    applyExternalStateChange.mockResolvedValue(true);

    await addAgreementUseCase(
      {
        application: {
          clientRef: "test-client-ref",
          code: "test-code",
          currentStatus: "",
          currentPhase: "",
          currentStage: "",
        },
        eventData: {
          agreementNumber: "agreement-123",
          date: "2024-01-01T12:00:00Z",
        },
      },
      {},
    );
  });

  it("updates the application with the new agreement", () => {
    const application = update.mock.calls[0][0];
    expect(application).toBeInstanceOf(Application);
    expect(application.agreements["agreement-123"]).toBeInstanceOf(Agreement);
  });
});
