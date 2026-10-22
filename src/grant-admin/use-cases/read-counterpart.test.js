import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { readCounterpart } from "./read-counterpart.js";

vi.mock("../../common/logger.js");

describe("readCounterpart", () => {
  it.each([true, false])("answers whether it exists (%s)", async (exists) => {
    expect(
      await readCounterpart("Test page: link", async () => exists),
    ).toEqual({ exists });
  });

  it("answers unknown, and says why, when the other side cannot say", async () => {
    const answer = await readCounterpart("Test page: link", async () => {
      throw Boom.badGateway("CW-BE answered something that cannot be read");
    });

    expect(answer).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "Test page: link unknown (HTTP 502)",
    );
  });
});
