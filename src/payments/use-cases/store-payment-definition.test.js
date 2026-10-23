import { MongoServerError } from "mongodb";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertPaymentDefinition } from "../repositories/payment-definition.repository.js";
import { storePaymentDefinition } from "./store-payment-definition.js";

vi.mock("../../common/logger.js");
vi.mock("../repositories/payment-definition.repository.js");

const CODE = "pigs-might-fly";

const definition = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "../../../compose/seed/pigs-might-fly/1.0.0/gas/payment.json",
        import.meta.url,
      ),
    ),
  );

beforeEach(() => {
  vi.resetAllMocks();
});

describe("storePaymentDefinition", () => {
  it("stores the definition as published, under the grant and version", async () => {
    const published = definition();
    const session = { id: "transaction" };

    await storePaymentDefinition(
      { grantCode: CODE, version: "1.2.0", definition: published },
      session,
    );

    expect(insertPaymentDefinition).toHaveBeenCalledWith(
      { code: CODE, version: "1.2.0", definition: published },
      session,
    );
  });

  it("refuses a definition arrival would refuse and stores nothing", async () => {
    await expect(
      storePaymentDefinition({
        grantCode: CODE,
        version: "1.2.0",
        definition: { code: CODE },
      }),
    ).rejects.toMatchObject({ isBoom: true });

    expect(insertPaymentDefinition).not.toHaveBeenCalled();
  });

  it("lets any other Mongo failure through", async () => {
    const failure = new MongoServerError({ message: "down", code: 6 });
    insertPaymentDefinition.mockRejectedValue(failure);

    await expect(
      storePaymentDefinition({
        grantCode: CODE,
        version: "1.2.0",
        definition: definition(),
      }),
    ).rejects.toBe(failure);
  });
});
