import { beforeEach, describe, expect, it, vi } from "vitest";
import { FetchStatus } from "../fetch-status.js";
import { fetchConfigFile, S3FetchError } from "../s3-client.js";
import {
  findConfigDefinition,
  findLatestUsableDefinition,
  updateDefinitionFetchStatus,
} from "./config-catalog.repository.js";
import { createDefinitionLoader } from "./definition-loader.js";

vi.mock("./config-catalog.repository.js");
vi.mock("../s3-client.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchConfigFile: vi.fn(),
}));
vi.mock("../logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

const target = {
  grantCode: "pigs-might-fly",
  version: "1.2.3",
  s3Bucket: "bucket",
  s3Key: "pigs-might-fly/1.2.3/gas/thing.json",
  fetchStatus: FetchStatus.Pending,
};

const raw = { code: "pigs-might-fly", value: 1 };

const build = (options = {}) =>
  createDefinitionLoader({
    definitionType: "thing",
    label: "Thing",
    compile: (rawDefinition, identity) => ({ ...rawDefinition, ...identity }),
    ...options,
  });

const load = (loader, options = {}) =>
  loader.load({
    code: "pigs-might-fly",
    configVersion: "1.2.3",
    resolution: "exact",
    ...options,
  });

describe("createDefinitionLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findConfigDefinition.mockResolvedValue(target);
    fetchConfigFile.mockResolvedValue(raw);
    updateDefinitionFetchStatus.mockResolvedValue({ modifiedCount: 1 });
  });

  it("fetches the target, compiles it with its identity, and records it fetched", async () => {
    await expect(load(build())).resolves.toEqual({
      ...raw,
      code: "pigs-might-fly",
      configVersion: "1.2.3",
    });
    expect(findConfigDefinition).toHaveBeenCalledWith({
      grantCode: "pigs-might-fly",
      version: "1.2.3",
      definitionType: "thing",
    });
    expect(fetchConfigFile).toHaveBeenCalledWith("bucket", target.s3Key);
    expect(updateDefinitionFetchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        definitionType: "thing",
        fetchStatus: FetchStatus.Fetched,
      }),
    );
  });

  it("compiles each version once", async () => {
    const loader = build();

    await load(loader);
    await load(loader);

    expect(fetchConfigFile).toHaveBeenCalledTimes(1);
  });

  it("shares a load already in flight for the same version", async () => {
    const loader = build();

    await Promise.all([load(loader), load(loader)]);

    expect(fetchConfigFile).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the caches are cleared", async () => {
    const loader = build();

    await load(loader);
    loader.clearCaches();
    await load(loader);

    expect(fetchConfigFile).toHaveBeenCalledTimes(2);
  });

  it("reports an unresolvable target using the caller's label", async () => {
    findConfigDefinition.mockResolvedValue(null);

    await expect(load(build())).rejects.toThrow(
      'Thing definition "pigs-might-fly" version "1.2.3" is unavailable',
    );
  });

  it("refuses a target already latched as permanently broken", async () => {
    findConfigDefinition.mockResolvedValue({
      ...target,
      fetchStatus: FetchStatus.PermanentError,
    });

    await expect(load(build())).rejects.toThrow("is unavailable");
    expect(fetchConfigFile).not.toHaveBeenCalled();
  });

  it("rejects an unknown resolution strategy", async () => {
    await expect(load(build(), { resolution: "sideways" })).rejects.toThrow(
      'Unknown Thing definition resolution "sideways"',
    );
  });

  describe("failure classification", () => {
    it("latches a compile failure as permanent", async () => {
      const loader = build({
        compile: () => {
          throw Object.assign(new Error("bad definition"), { isBoom: true });
        },
      });

      await expect(load(loader)).rejects.toThrow("bad definition");
      expect(updateDefinitionFetchStatus).toHaveBeenCalledWith(
        expect.objectContaining({ fetchStatus: FetchStatus.PermanentError }),
      );
    });

    it("records a service failure as transient", async () => {
      fetchConfigFile.mockRejectedValue(new Error("S3 unavailable"));

      await expect(load(build())).rejects.toThrow("S3 unavailable");
      expect(updateDefinitionFetchStatus).toHaveBeenCalledWith(
        expect.objectContaining({ fetchStatus: FetchStatus.TransientError }),
      );
    });

    it("latches a permanent S3 failure", async () => {
      fetchConfigFile.mockRejectedValue(
        new S3FetchError("gone", { statusCode: 404 }),
      );

      await expect(load(build())).rejects.toThrow("gone");
      expect(updateDefinitionFetchStatus).toHaveBeenCalledWith(
        expect.objectContaining({ fetchStatus: FetchStatus.PermanentError }),
      );
    });

    it("lets a caller suppress recording for a local fault", async () => {
      fetchConfigFile.mockRejectedValue(new Error("no service URL"));
      const loader = build({
        classifyFailure: () => ({
          status: FetchStatus.TransientError,
          record: false,
        }),
      });

      await expect(load(loader)).rejects.toThrow("no service URL");
      expect(updateDefinitionFetchStatus).not.toHaveBeenCalled();
    });
  });

  describe("stored definitions", () => {
    it("compiles a stored definition without fetching", async () => {
      const loader = build({ readStored: async () => raw });

      await load(loader);

      expect(fetchConfigFile).not.toHaveBeenCalled();
    });

    it("writes back a definition that came from S3", async () => {
      const writeStored = vi.fn();
      const loader = build({ readStored: async () => undefined, writeStored });

      await load(loader);

      expect(writeStored).toHaveBeenCalledWith(target, raw);
    });

    it("does not write back a definition that came from the store", async () => {
      const writeStored = vi.fn();
      const loader = build({ readStored: async () => raw, writeStored });

      await load(loader);

      expect(writeStored).not.toHaveBeenCalled();
    });
  });

  describe("fallback", () => {
    it("falls back to an older usable version when the newest is invalid", async () => {
      const older = {
        ...target,
        version: "1.1.0",
        s3Key: "pigs-might-fly/1.1.0/gas/thing.json",
      };
      // The catalog reflects the latch on the retry, as it would in Mongo.
      findConfigDefinition
        .mockResolvedValueOnce({ ...target, status: "active" })
        .mockResolvedValue({
          ...target,
          status: "active",
          fetchStatus: FetchStatus.PermanentError,
        });
      findLatestUsableDefinition.mockResolvedValue(older);
      fetchConfigFile.mockImplementation((_bucket, key) =>
        key === target.s3Key
          ? Promise.reject(
              Object.assign(new Error("invalid"), { isBoom: true }),
            )
          : Promise.resolve(raw),
      );

      await expect(
        load(build(), { resolution: "creation" }),
      ).resolves.toMatchObject({ configVersion: "1.1.0" });
    });

    it("never falls back for an exact resolution", async () => {
      fetchConfigFile.mockRejectedValue(
        Object.assign(new Error("invalid"), { isBoom: true }),
      );

      await expect(load(build())).rejects.toThrow("invalid");
      expect(findLatestUsableDefinition).not.toHaveBeenCalled();
    });
  });
});
