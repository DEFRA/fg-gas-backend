import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wreck } from "../../common/wreck.js";
import {
  describeError,
  findCwInboxPage,
  findCwOutboxPage,
  isCwConfigured,
  notConfiguredMessage,
} from "./cw-actuators.repository.js";

const { cwBackend } = vi.hoisted(() => ({
  cwBackend: { url: undefined, token: undefined },
}));

vi.mock("../../common/config.js", () => ({ config: { cwBackend } }));
vi.mock("../../common/wreck.js", () => ({ wreck: { get: vi.fn() } }));

const URL_BASE = "http://cw.test";
const TOKEN = "cw-token";

const envelope = (overrides = {}) => ({
  payload: {
    data: [{ _id: "665f1c2e9a1b2c3d4e5f6a7b" }],
    pagination: {
      startCursor: "a",
      endCursor: "b",
      hasNextPage: false,
      hasPreviousPage: false,
    },
    ...overrides,
  },
});

const calledUrl = () => new URL(wreck.get.mock.calls[0][0]);

beforeEach(() => {
  cwBackend.url = URL_BASE;
  cwBackend.token = TOKEN;
});

describe("findCwInboxPage / findCwOutboxPage", () => {
  it("calls /actuators/inbox with pageSize 20, direction and the bearer token", async () => {
    wreck.get.mockResolvedValue(envelope());

    await findCwInboxPage({ direction: "forward", pageSize: 20 });

    const url = calledUrl();

    expect(url.pathname).toEqual("/actuators/inbox");
    expect(url.searchParams.get("pageSize")).toEqual("20");
    expect(url.searchParams.get("direction")).toEqual("forward");
    expect(wreck.get.mock.calls[0][1]).toEqual({
      json: true,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  });

  it("calls /actuators/outbox for the outbox source", async () => {
    wreck.get.mockResolvedValue(envelope());

    await findCwOutboxPage({ direction: "backward", pageSize: 20 });

    expect(calledUrl().pathname).toEqual("/actuators/outbox");
    expect(calledUrl().searchParams.get("direction")).toEqual("backward");
  });

  it("omits cursor and status from the query string when not supplied", async () => {
    wreck.get.mockResolvedValue(envelope());

    await findCwInboxPage({ direction: "forward", pageSize: 20 });

    expect(calledUrl().searchParams.has("cursor")).toBe(false);
    expect(calledUrl().searchParams.has("status")).toBe(false);
  });

  it("passes cursor and status through verbatim", async () => {
    wreck.get.mockResolvedValue(envelope());

    await findCwInboxPage({
      cursor: "eyJldmVudFRpbWUiOm51bGx9",
      status: "DEAD_LETTER",
      direction: "forward",
      pageSize: 20,
    });

    expect(calledUrl().searchParams.get("cursor")).toEqual(
      "eyJldmVudFRpbWUiOm51bGx9",
    );
    expect(calledUrl().searchParams.get("status")).toEqual("DEAD_LETTER");
  });

  it("returns data and pagination from the response envelope", async () => {
    wreck.get.mockResolvedValue(envelope());

    const page = await findCwInboxPage({ direction: "forward", pageSize: 20 });

    expect(page.data).toEqual([{ _id: "665f1c2e9a1b2c3d4e5f6a7b" }]);
    expect(page.pagination.hasNextPage).toBe(false);
  });

  it("returns empty data when the envelope has none", async () => {
    wreck.get.mockResolvedValue({ payload: {} });

    const page = await findCwInboxPage({ direction: "forward", pageSize: 20 });

    expect(page).toEqual({ data: [], pagination: {} });
  });

  it("returns empty data when there is no payload at all", async () => {
    wreck.get.mockResolvedValue({ payload: null });

    const page = await findCwInboxPage({ direction: "forward", pageSize: 20 });

    expect(page).toEqual({ data: [], pagination: {} });
  });

  it("tolerates an envelope with no totalCount", async () => {
    wreck.get.mockResolvedValue(envelope());

    const page = await findCwOutboxPage({ direction: "forward", pageSize: 20 });

    expect(page.pagination).not.toHaveProperty("totalCount");
  });

  it("propagates the wreck rejection unchanged", async () => {
    const error = Boom.unauthorized("nope");
    wreck.get.mockRejectedValue(error);

    await expect(
      findCwInboxPage({ direction: "forward", pageSize: 20 }),
    ).rejects.toBe(error);
  });
});

describe("isCwConfigured", () => {
  it("is true when both the url and the token are set", () => {
    expect(isCwConfigured()).toBe(true);
  });

  it("is false when the url is unset", () => {
    cwBackend.url = undefined;

    expect(isCwConfigured()).toBe(false);
  });

  it("is false when the token is unset", () => {
    cwBackend.token = undefined;

    expect(isCwConfigured()).toBe(false);
  });
});

describe("notConfiguredMessage", () => {
  it("is the fixed one-liner the use case reports for an unset CW backend", () => {
    expect(notConfiguredMessage()).toEqual("not configured");
  });
});

describe("describeError", () => {
  it("maps a 504 gateway timeout to timeout", () => {
    expect(
      describeError(Boom.gatewayTimeout("Client request timeout")),
    ).toEqual("timeout");
  });

  it("maps a 408 client timeout to timeout", () => {
    expect(describeError(Boom.clientTimeout())).toEqual("timeout");
  });

  it("maps a Boom 401 to HTTP 401", () => {
    expect(describeError(Boom.unauthorized("nope"))).toEqual("HTTP 401");
  });

  it("maps a transport error arriving as a Boom 502 to HTTP 502", () => {
    expect(describeError(Boom.badGateway("Client request error"))).toEqual(
      "HTTP 502",
    );
  });

  it("maps a plain Error to read failed", () => {
    expect(describeError(new Error("boom"))).toEqual("read failed");
  });

  it("maps an undefined error to read failed", () => {
    expect(describeError(undefined)).toEqual("read failed");
  });

  it("never returns anything drawn from error.data.payload", () => {
    const error = Boom.unauthorized("Unauthorized");
    error.data = {
      payload: { message: "caseworker jane.doe@defra.gov.uk token expired" },
    };

    const described = describeError(error);

    expect(described).toEqual("HTTP 401");
    expect(described).not.toContain("jane.doe");
    expect(described).not.toContain("token");
  });
});
