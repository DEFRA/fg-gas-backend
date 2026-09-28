import { expect, it } from "vitest";
import { findPaymentBySource } from "./payment.repository.js";

it("rejects an unsupported Payment source instead of querying with a partial identity", async () => {
  await expect(findPaymentBySource({ type: "unsupported" })).rejects.toThrow(
    "Unsupported Payment source type: unsupported",
  );
});
