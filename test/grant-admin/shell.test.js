import { beforeEach, describe, expect, it } from "vitest";
import { shellResponseSchema } from "../../src/grant-admin/schemas/shell.schema.js";
import { aCwBucketEntry } from "../helpers/cw-buckets.js";
import { resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

const OTHER_SERVICE = "Bearer 22222222-2222-2222-2222-222222222222";

const idsOf = (shell) => shell.catalogue.buckets.map(({ id }) => id);

beforeEach(async () => {
  await resetCwStub();
  await setCwStub({
    buckets: { entries: [aCwBucketEntry("outbox"), aCwBucketEntry("inbox")] },
  });
});

describe("GET /grant-admin/shell", () => {
  it("answers both services' lists, in order, each service's events as one", async () => {
    const { payload, res } = await wreck.get("/grant-admin/shell");

    expect(res.headers["cache-control"]).toBe("no-store");
    expect(shellResponseSchema.validate(payload).error).toBeUndefined();
    expect(idsOf(payload.shell).slice(0, 2)).toEqual([
      "gas.events",
      "cw.events",
    ]);
    expect(idsOf(payload.shell)).not.toEqual(
      expect.arrayContaining(["gas.outbox"]),
    );
    expect(payload.shell.catalogue.sourceErrors).toEqual([]);
  });

  it("answers GAS's lists and names Caseworking when it is down", async () => {
    await setCwStub({ buckets: { mode: "down" } });

    const { payload } = await wreck.get("/grant-admin/shell");

    expect(idsOf(payload.shell).some((id) => id.startsWith("cw."))).toBe(false);
    expect(payload.shell.catalogue.sourceErrors).toEqual([{ hop: "CW-BE" }]);
  });

  it("is refused to another service's client", async () => {
    const error = await wreck
      .get("/grant-admin/shell", { headers: { authorization: OTHER_SERVICE } })
      .catch((e) => e);

    expect(error.output.statusCode).toBe(403);
    expect(error.data.payload.shell).toBeUndefined();
  });
});

describe("the shell on the admin's answers", () => {
  it("never comes with the catalogue route the last admin reads", async () => {
    const { payload } = await wreck.get("/grant-admin/buckets");

    expect(payload.shell).toBeUndefined();
  });
});
