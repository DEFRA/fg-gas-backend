import { beforeEach, describe, expect, it } from "vitest";
import { resetCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

// Another service's valid credential, seeded by test/auth-setup.js.
const OTHER_SERVICE = "Bearer 22222222-2222-2222-2222-222222222222";

// Never seeded, so it fails authentication rather than authorisation.
const NOT_A_TOKEN = "Bearer 11111111-1111-1111-1111-111111111111";

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const as = (authorization) => ({ headers: { authorization } });

const ROUTES = [
  ["the page", () => wreck.get("/grant-admin/events/page", as(OTHER_SERVICE))],
  [
    "an event",
    () => wreck.get(`/grant-admin/events/gas/inbox/${ID}`, as(OTHER_SERVICE)),
  ],
  [
    "a redrive",
    () =>
      wreck.post(
        `/grant-admin/events/gas/inbox/${ID}/redrive`,
        as(OTHER_SERVICE),
      ),
  ],
  [
    "a purge",
    () =>
      wreck.post(`/grant-admin/events/gas/inbox/${ID}/purge`, {
        ...as(OTHER_SERVICE),
        payload: { reasonCode: "BROKEN_PAYLOAD" },
      }),
  ],
  [
    "the claims read",
    () =>
      wreck.get(
        "/grant-admin/grants/wood/applications/REF-1/claims",
        as(OTHER_SERVICE),
      ),
  ],
];

beforeEach(async () => {
  await resetCwStub();
});

describe("the grant-admin surface answers one client", () => {
  it.each(ROUTES)("refuses another service on %s", async (_name, call) => {
    await expect(call()).rejects.toMatchObject({
      output: { statusCode: 403 },
    });
  });

  it("refuses before doing the work, whatever the id", async () => {
    await expect(
      wreck.post(
        "/grant-admin/events/gas/inbox/deadbeefdeadbeefdeadbeef/redrive",
        as(OTHER_SERVICE),
      ),
    ).rejects.toMatchObject({ output: { statusCode: 403 } });
  });

  it("still answers 401 to a credential it does not know", async () => {
    await expect(
      wreck.get("/grant-admin/events/page", as(NOT_A_TOKEN)),
    ).rejects.toMatchObject({ output: { statusCode: 401 } });
  });

  it("answers the grants platform admin", async () => {
    const { res } = await wreck.get("/grant-admin/events/page");

    expect(res.statusCode).toBe(200);
  });
});
