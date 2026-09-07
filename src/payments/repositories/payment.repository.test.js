import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import {
  countPayments,
  countPrimaryPayments,
  paymentsCollection,
} from "./payment.repository.js";

vi.mock("../../common/mongo-client.js");

const session = {};

describe("Payment repository", () => {
  it("counts all payments on the caller's session", async () => {
    const countDocuments = vi.fn().mockResolvedValue(3);
    db.collection.mockReturnValue({ countDocuments });

    await expect(countPayments(session)).resolves.toBe(3);

    expect(db.collection).toHaveBeenCalledWith(paymentsCollection);
    expect(countDocuments).toHaveBeenCalledWith({}, { session });
  });

  it("counts all payments explicitly on the primary", async () => {
    const countDocuments = vi.fn().mockResolvedValue(0);
    db.collection.mockReturnValue({ countDocuments });

    await expect(countPrimaryPayments()).resolves.toBe(0);

    expect(db.collection).toHaveBeenCalledWith(paymentsCollection);
    expect(countDocuments).toHaveBeenCalledWith(
      {},
      { readPreference: "primary" },
    );
  });
});
