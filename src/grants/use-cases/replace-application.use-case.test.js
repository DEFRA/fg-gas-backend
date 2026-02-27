import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
import {
  findByClientRef,
  update,
} from "../repositories/application-x-ref.repository.js";
import { createApplicationUseCase } from "./create-application.use-case.js";
import { findApplicationByClientRefUseCase } from "./find-application-by-client-ref.use-case.js";
import { replaceApplicationUseCase } from "./replace-application.use-case.js";

vi.mock("../../common/with-transaction.js");
vi.mock("./create-application.use-case.js");
vi.mock("./find-application-by-client-ref.use-case.js");
vi.mock("../repositories/application-x-ref.repository.js");

const testApplication = {
  metadata: {
    clientRef: "new-client-ref",
    previousClientRef: "previous-client-ref",
    sbi: "123456789",
    frn: "987654321",
    crn: "CRN123456",
    defraId: "DEFRA123456",
    submittedAt: "2000-01-01T12:00:00Z",
  },
  answers: {
    question1: "answer1",
  },
};

describe("replaceApplicationUseCase", () => {
  it("creates a new application and updates the xref when replacement is allowed", async () => {
    const mockSession = {};
    withTransaction.mockImplementation(async (cb) => cb(mockSession));
    findApplicationByClientRefUseCase.mockResolvedValue({
      replacementAllowed: true,
    });
    createApplicationUseCase.mockResolvedValue("new-application-id");

    const mockXref = { addClientRef: vi.fn() };
    findByClientRef.mockResolvedValue(mockXref);
    update.mockResolvedValue({});

    await replaceApplicationUseCase("test-grant", testApplication);

    expect(createApplicationUseCase).toHaveBeenCalledWith(
      "test-grant",
      testApplication,
      mockSession,
    );
    expect(findByClientRef).toHaveBeenCalledWith(
      "previous-client-ref",
      mockSession,
    );
    expect(mockXref.addClientRef).toHaveBeenCalledWith(
      "new-client-ref",
      "new-application-id",
    );
    expect(update).toHaveBeenCalledWith(mockXref, mockSession);
  });

  it("throws a conflict error when replacement is not allowed", async () => {
    const mockSession = {};
    withTransaction.mockImplementation(async (cb) => cb(mockSession));
    findApplicationByClientRefUseCase.mockResolvedValue({
      replacementAllowed: false,
    });

    await expect(
      replaceApplicationUseCase("test-grant", testApplication),
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 409 },
      message: expect.stringContaining("previous-client-ref"),
    });

    expect(createApplicationUseCase).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("throws when the previous application is not found", async () => {
    const mockSession = {};
    withTransaction.mockImplementation(async (cb) => cb(mockSession));
    findApplicationByClientRefUseCase.mockRejectedValue(
      Boom.notFound(
        'Application with clientRef "previous-client-ref" not found',
      ),
    );

    await expect(
      replaceApplicationUseCase("test-grant", testApplication),
    ).rejects.toThrow(
      'Application with clientRef "previous-client-ref" not found',
    );

    expect(createApplicationUseCase).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("throws when createApplicationUseCase fails", async () => {
    const mockSession = {};
    withTransaction.mockImplementation(async (cb) => cb(mockSession));
    findApplicationByClientRefUseCase.mockResolvedValue({
      replacementAllowed: true,
    });
    createApplicationUseCase.mockRejectedValue(
      new Error("Failed to create application"),
    );

    await expect(
      replaceApplicationUseCase("test-grant", testApplication),
    ).rejects.toThrow("Failed to create application");

    expect(update).not.toHaveBeenCalled();
  });
});
