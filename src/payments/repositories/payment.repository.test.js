import { beforeEach, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import {
  findClaimPaymentClientClaimRefs,
  findPaymentBySource,
} from "./payment.repository.js";

vi.mock("../../common/mongo-client.js");

// The db is mocked for the reads below; this keeps the collection usable so a
// guard that runs before any query still fails on its own terms.
beforeEach(() => {
  db.collection.mockReturnValue({ findOne: vi.fn(), find: vi.fn() });
});

it("rejects an unsupported Payment source instead of querying with a partial identity", async () => {
  await expect(findPaymentBySource({ type: "unsupported" })).rejects.toThrow(
    "Unsupported Payment source type: unsupported",
  );
});

it("answers which of an application's claims raised a Payment", async () => {
  const session = {};
  const toArray = vi
    .fn()
    .mockResolvedValue([
      { source: { clientClaimRef: "WMP-6HB-J8E-C0001" } },
      { source: { clientClaimRef: "WMP-6HB-J8E-C0002" } },
    ]);
  const find = vi.fn().mockReturnValue({ toArray });
  db.collection.mockReturnValue({ find });

  const result = await findClaimPaymentClientClaimRefs(
    { code: "woodland", clientRef: "wmp-6hb-j8e" },
    session,
  );

  expect(find).toHaveBeenCalledWith(
    {
      "source.type": "claim",
      "source.code": "woodland",
      "source.clientRef": "wmp-6hb-j8e",
    },
    { session, projection: { "source.clientClaimRef": 1 } },
  );
  expect(result).toEqual(new Set(["WMP-6HB-J8E-C0001", "WMP-6HB-J8E-C0002"]));
});
