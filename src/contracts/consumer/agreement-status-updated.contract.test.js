import { Matchers, MessageConsumerPact } from "@pact-foundation/pact";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { agreementStatusUpdatedSubscriber } from "../../grants/subscribers/agreement-status-updated.subscriber.js";
import { acceptAgreementUseCase } from "../../grants/use-cases/accept-agreement.use-case.js";
import { addAgreementUseCase } from "../../grants/use-cases/add-agreement.use-case.js";
import { withdrawAgreementUseCase } from "../../grants/use-cases/withdraw-agreement.use-case.js";

vi.mock("../../grants/use-cases/add-agreement.use-case.js");
vi.mock("../../grants/use-cases/accept-agreement.use-case.js");
vi.mock("../../grants/use-cases/withdraw-agreement.use-case.js");

describe("receiving agreement status updated events from farming-grants-agreements-api", () => {
  const messagePact = new MessageConsumerPact({
    consumer: "fg-gas-backend",
    provider: "farming-grants-agreements-api",
    dir: path.resolve("src", "contracts", "consumer", "pacts"),
    pactfileWriteMode: "update",
  });

  it("should handle agreement offered (created) status update", () => {
    addAgreementUseCase.mockResolvedValue(undefined);

    return messagePact
      .given("agreement created")
      .expectsToReceive("an agreement created message")
      .withContent({
        id: Matchers.string("12-34-56-78-90"),
        source: Matchers.like("farming-grants-agreements-api"),
        specversion: "1.0",
        type: Matchers.like(
          "cloud.defra.test.farming-grants-agreements-api.agreement.status.update",
        ),
        datacontenttype: "application/json",
        time: Matchers.datetime(
          "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
          "2025-10-06T16:41:59.497Z",
        ),
        data: {
          clientRef: Matchers.string("ref-1234"),
          code: Matchers.string("frps-private-beta"),
          agreementNumber: Matchers.string("SFI123456789"),
          status: "offered",
          date: Matchers.datetime(
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "2025-10-06T16:40:21.951Z",
          ),
          correlationId: Matchers.string("mockCorrelationId"),
        },
      })
      .verify(async (message) => {
        const { data } = message.contents;

        await agreementStatusUpdatedSubscriber.onMessage({ data });

        expect(addAgreementUseCase).toHaveBeenCalledWith({
          clientRef: data.clientRef,
          code: data.code,
          agreementRef: data.agreementNumber,
          date: data.date,
        });
      });
  });

  it("should handle agreement accepted status update", () => {
    acceptAgreementUseCase.mockResolvedValue(undefined);

    return messagePact
      .given("agreement accepted")
      .expectsToReceive("an agreement accepted message")
      .withContent({
        id: Matchers.string("12-34-56-78-90"),
        source: Matchers.like("farming-grants-agreements-api"),
        specversion: "1.0",
        type: Matchers.like(
          "cloud.defra.test.farming-grants-agreements-api.agreement.status.update",
        ),
        datacontenttype: "application/json",
        time: Matchers.datetime(
          "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
          "2025-10-06T16:41:59.497Z",
        ),
        data: {
          clientRef: Matchers.string("ref-1234"),
          code: Matchers.string("frps-private-beta"),
          agreementNumber: Matchers.string("SFI123456789"),
          status: "accepted",
          date: Matchers.datetime(
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "2025-10-06T16:40:21.951Z",
          ),
        },
      })
      .verify(async (message) => {
        const { data } = message.contents;

        await agreementStatusUpdatedSubscriber.onMessage({ data });

        expect(acceptAgreementUseCase).toHaveBeenCalledWith({
          clientRef: data.clientRef,
          code: data.code,
          agreementRef: data.agreementNumber,
          date: data.date,
        });
      });
  });

  it("should handle agreement withdrawn status update", () => {
    withdrawAgreementUseCase.mockResolvedValue(undefined);

    return messagePact
      .given("agreement withdrawn")
      .expectsToReceive("an agreement withdrawn message")
      .withContent({
        id: Matchers.string("12-34-56-78-90"),
        source: Matchers.like("farming-grants-agreements-api"),
        specversion: "1.0",
        type: Matchers.like(
          "cloud.defra.test.farming-grants-agreements-api.agreement.status.update",
        ),
        datacontenttype: "application/json",
        time: Matchers.datetime(
          "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
          "2025-10-06T16:41:59.497Z",
        ),
        data: {
          clientRef: Matchers.string("ref-1234"),
          code: Matchers.string("frps-private-beta"),
          agreementNumber: Matchers.string("SFI123456789"),
          status: "withdrawn",
          date: Matchers.datetime(
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "2025-10-06T16:40:21.951Z",
          ),
        },
      })
      .verify(async (message) => {
        const { data } = message.contents;

        await agreementStatusUpdatedSubscriber.onMessage({ data });

        expect(withdrawAgreementUseCase).toHaveBeenCalledWith({
          clientRef: data.clientRef,
          code: data.code,
          agreementRef: data.agreementNumber,
          date: data.date,
        });
      });
  });
});
