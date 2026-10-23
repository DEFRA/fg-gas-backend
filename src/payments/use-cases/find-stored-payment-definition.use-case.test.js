import { expect, it, vi } from "vitest";
import {
  findPaymentDefinition,
  findStoredPaymentDefinition,
  insertPaymentDefinition,
} from "../repositories/payment-definition.repository.js";
import { findStoredPaymentDefinitionUseCase } from "./find-stored-payment-definition.use-case.js";
import { loadPaymentDefinition } from "./load-payment-definition.js";

vi.mock("../repositories/payment-definition.repository.js");
vi.mock("./load-payment-definition.js");

it("answers the stored definition read under the caller's cap, never fetching or writing", async () => {
  const found = { storedBytes: 512, definition: { code: "pigs-might-fly" } };
  findStoredPaymentDefinition.mockResolvedValue(found);

  await expect(
    findStoredPaymentDefinitionUseCase(
      { code: "pigs-might-fly", version: "1.0.0" },
      { maxBytes: 1024 },
    ),
  ).resolves.toBe(found);
  expect(findStoredPaymentDefinition).toHaveBeenCalledWith(
    { code: "pigs-might-fly", version: "1.0.0" },
    { maxBytes: 1024 },
  );
  expect(loadPaymentDefinition).not.toHaveBeenCalled();
  expect(findPaymentDefinition).not.toHaveBeenCalled();
  expect(insertPaymentDefinition).not.toHaveBeenCalled();
});

it("answers neither a definition nor a size when nothing is stored", async () => {
  findStoredPaymentDefinition.mockResolvedValue(null);

  await expect(
    findStoredPaymentDefinitionUseCase(
      { code: "pigs-might-fly", version: "1.0.0" },
      { maxBytes: 1024 },
    ),
  ).resolves.toEqual({ definition: null, storedBytes: null });
});
