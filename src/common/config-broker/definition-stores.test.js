import { afterEach, expect, it, vi } from "vitest";
import {
  clearDefinitionStores,
  findStoredDefinition,
  registerDefinitionStore,
  storeDefinition,
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

it("finds a stored definition through the registered store's read", async () => {
  const found = { definition: {}, addresses: [], problem: null };
  const find = vi.fn().mockResolvedValue(found);
  registerDefinitionStore("agreement", { storedVersions: vi.fn(), find });

  const ref = { grantCode: "woodland", version: "1.0.0" };

  expect(await findStoredDefinition("agreement", ref, { maxBytes: 1024 })).toBe(
    found,
  );
  expect(find).toHaveBeenCalledWith(ref, { maxBytes: 1024 });
});

it("refuses to find a stored definition of a type no context has registered", async () => {
  await expect(
    findStoredDefinition("agreement", { grantCode: "woodland" }, {}),
  ).rejects.toThrow(
    "No configuration definition store registered for agreement",
  );
});

it("refuses to find a stored definition whose store offers no read of it", async () => {
  registerDefinitionStore("payment", { storedVersions: vi.fn() });

  await expect(
    findStoredDefinition("payment", { grantCode: "woodland" }, {}),
  ).rejects.toThrow(
    "The payment definition store cannot find a stored definition",
  );
});

it("refuses to store a type no context has registered a store for", async () => {
  await expect(
    storeDefinition("agreement", {
      grantCode: "woodland",
      version: "1.0.0",
      definition: {},
    }),
  ).rejects.toThrow(
    "No configuration definition store registered for agreement",
  );
});

it("hands the file to the registered store", async () => {
  const store = vi.fn().mockResolvedValue(undefined);
  registerDefinitionStore("agreement", { store });
  const file = {
    grantCode: "woodland",
    version: "1.0.0",
    definition: { code: "woodland" },
  };

  await storeDefinition("agreement", file);

  expect(store).toHaveBeenCalledWith(file);
});

it("lets the store's own refusal through", async () => {
  const refusal = new Error("not usable");
  registerDefinitionStore("agreement", {
    store: vi.fn().mockRejectedValue(refusal),
  });

  await expect(
    storeDefinition("agreement", {
      grantCode: "woodland",
      version: "1.0.0",
      definition: {},
    }),
  ).rejects.toBe(refusal);
});
