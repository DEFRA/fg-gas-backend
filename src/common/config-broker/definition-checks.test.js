import { afterEach, expect, it, vi } from "vitest";
import {
  assertDefinitionCheckRegistered,
  checkDefinition,
  clearDefinitionChecks,
  registerDefinitionCheck,
} from "./definition-checks.js";

afterEach(clearDefinitionChecks);

it("fails startup assertions for a missing definition check", () => {
  expect(() => assertDefinitionCheckRegistered("payment")).toThrow(
    "No configuration definition check registered for payment",
  );
});

it("asserts and runs a registered definition check", () => {
  const check = vi.fn();
  const context = { definition: {} };
  registerDefinitionCheck("payment", check);

  expect(() => assertDefinitionCheckRegistered("payment")).not.toThrow();
  checkDefinition("payment", context);

  expect(check).toHaveBeenCalledWith(context);
});
