import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
import { Application, ApplicationStatus } from "../models/application.js";
import { Outbox } from "../models/outbox.js";
import { update } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { approveApplicationUseCase } from "./approve-application.use-case.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

vi.mock("./find-application-by-client-ref-and-code.use-case.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/outbox.repository.js");

describe("approveApplicationUseCase", () => {
  let mockSession;

  beforeEach(() => {
    vi.resetAllMocks();
    mockSession = vi.fn();
  });

  it("finds an existing application", async () => {
    withTransaction.mockImplementation((cb) => cb(mockSession));
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(
      new Application({
        clientRef: "test-client-ref",
        code: "test-grant",
        phases: [],
        replacementAllowed: false,
      }),
    );

    await approveApplicationUseCase({
      clientRef: "test-client-ref",
      code: "test-grant",
    });

    expect(findApplicationByClientRefAndCodeUseCase).toHaveBeenCalledWith(
      "test-client-ref",
      "test-grant",
    );
  });

  it("approves and updates the application", async () => {
    withTransaction.mockImplementation(async (cb) => await cb(mockSession));
    const app = new Application({
      currentStatus: ApplicationStatus.Received,
      code: "12345-43423",
      clientRef: "0000000",
      identifiers: [],
      phases: [],
      replacementAllowed: false,
    });
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(app);

    await approveApplicationUseCase({
      clientRef: "test-client-ref",
      code: "test-grant",
    });

    expect(update.mock.calls[0][0]).toBeInstanceOf(Application);

    expect(update.mock.calls[0][0].currentStatus).toBe(
      ApplicationStatus.Approved,
    );
    expect(insertMany).toHaveBeenCalled();
    expect(insertMany.mock.calls[0][0][0]).toBeInstanceOf(Outbox);
    expect(insertMany.mock.calls[0][0][1]).toBeInstanceOf(Outbox);
  });

  it("does nothing when application has already been approved", async () => {
    withTransaction.mockImplementation(async (cb) => cb(mockSession));
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(
      new Application({
        clientRef: "test-client-ref",
        code: "test-grant",
        currentStatus: ApplicationStatus.Approved,
        updatedAt: "2024-01-01T00:00:00.000Z",
        phases: [],
        replacementAllowed: false,
      }),
    );

    await expect(() =>
      approveApplicationUseCase({
        clientRef: "test-client-ref",
        code: "test-grant",
      }),
    ).rejects.toThrowError(
      'Application with clientRef "test-client-ref" and code "test-grant" is already approved',
    );

    expect(update).not.toHaveBeenCalled();
  });
});
