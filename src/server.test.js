import hapi from "@hapi/hapi";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "./server.js";

vi.mock("@hapi/hapi");

describe("server", () => {
  it("registers server", async () => {
    const on = vi.fn();
    const register = vi.fn();
    vi.spyOn(hapi, "server").mockImplementation(() => ({
      events: {
        on,
      },
      register,
    }));

    await createServer();
    expect(on).toHaveBeenCalledTimes(2);
    expect(register).toHaveBeenCalledTimes(2);
  });
});
