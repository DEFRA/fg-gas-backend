import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeBucket } from "../../common/buckets/catalogue.js";
import { listBuckets } from "../../common/buckets/registry.js";
import { logger } from "../../common/logger.js";
import {
  clearListGroups,
  registerListGroup,
} from "../../common/list-groups/registry.js";
import { eventListGroups } from "../../events/lists/event-list-groups.js";
import { findCwBuckets } from "../repositories/cw-actuators.repository.js";
import { eventEntries } from "../services/list-groups/test-groups.js";
import { listBucketsUseCase } from "./list-buckets.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("../../common/buckets/catalogue.js");
vi.mock("../../common/buckets/registry.js");
vi.mock("../repositories/cw-actuators.repository.js", async (original) => ({
  ...(await original()),
  findCwBuckets: vi.fn(),
}));

const entry = (id, order) => ({ id, order });

describe("listBucketsUseCase", () => {
  beforeEach(() => {
    listBuckets.mockReturnValue([{ id: "gas.one" }, { id: "gas.two" }]);
    describeBucket.mockImplementation(async ({ id }) =>
      entry(id, id === "gas.one" ? 10 : 50),
    );
    findCwBuckets.mockResolvedValue([entry("cw.one", 30), entry("cw.two", 60)]);
  });

  it("answers its own entries and Caseworking's, sorted by order", async () => {
    expect(await listBucketsUseCase()).toEqual({
      buckets: [
        entry("gas.one", 10),
        entry("cw.one", 30),
        entry("gas.two", 50),
        entry("cw.two", 60),
      ],
      sourceErrors: [],
    });
    expect(describeBucket).toHaveBeenCalledTimes(2);
  });

  it("answers its own entries and names Caseworking when it cannot be read", async () => {
    const error = Boom.badGateway("unavailable");
    error.data = { payload: "SECRET-CW-BODY" };
    findCwBuckets.mockRejectedValue(error);

    expect(await listBucketsUseCase()).toEqual({
      buckets: [entry("gas.one", 10), entry("gas.two", 50)],
      sourceErrors: [{ hop: "CW-BE" }],
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "List buckets: caseworking unavailable (HTTP 502)",
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("SECRET");
  });

  it("lists each group in place of its boxes, and never a box on its own", async () => {
    clearListGroups();
    eventListGroups().forEach(registerListGroup);
    const [gas, cw] = [
      eventEntries().filter(({ id }) => id.startsWith("gas.")),
      eventEntries().filter(({ id }) => id.startsWith("cw.")),
    ];
    listBuckets.mockReturnValue(gas);
    describeBucket.mockImplementation(async (bucket) => bucket);
    findCwBuckets.mockResolvedValue(cw.slice(0, 1));

    const { buckets } = await listBucketsUseCase();

    expect(buckets.map(({ id }) => id)).toEqual(["gas.events"]);
    clearListGroups();
  });

  it("fails when one of its own buckets cannot be described", async () => {
    const failure = new Error("read failed");
    describeBucket.mockRejectedValue(failure);

    await expect(listBucketsUseCase()).rejects.toBe(failure);
  });
});
