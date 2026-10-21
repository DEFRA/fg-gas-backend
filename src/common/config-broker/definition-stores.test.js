import { afterEach, expect, it, vi } from "vitest";
import {
  clearDefinitionStores,
  registerDefinitionStore,
  storedDefinitionVersions,
} from "./definition-stores.js";

afterEach(clearDefinitionStores);

it("refuses a type no context has registered a store for", async () => {
  await expect(
    storedDefinitionVersions("payment", "woodland", ["1.0.0"]),
  ).rejects.toThrow("No configuration definition store registered for payment");
});

it("answers the versions the registered store holds, as a set", async () => {
  const storedVersions = vi.fn().mockResolvedValue(["1.0.0"]);
  registerDefinitionStore("payment", { storedVersions });

  const stored = await storedDefinitionVersions("payment", "woodland", [
    "1.0.0",
    "2.0.0",
  ]);

  expect(stored).toEqual(new Set(["1.0.0"]));
  expect(storedVersions).toHaveBeenCalledWith("woodland", ["1.0.0", "2.0.0"]);
});
