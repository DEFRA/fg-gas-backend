import { beforeEach, describe, expect, it } from "vitest";
import { resetCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

// A valid, persisted credential belonging to a different service - seeded by
// test/auth-setup.js alongside the suite's own. GAS issues tokens to several
// services and its auth accepts any of them, so this is the caller the
// grant-admin guard exists to turn away: authenticated, and not welcome.
const OTHER_SERVICE = "Bearer 22222222-2222-2222-2222-222222222222";

// Never seeded, so it fails authentication rather than authorisation.
const NOT_A_TOKEN = "Bearer 11111111-1111-1111-1111-111111111111";

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const as = (authorization) => ({ headers: { authorization } });

// Every shape of the surface: the composites, a single event, and the one
// route that changes something.
const ROUTES = [
  ["the list", () => wreck.get("/grant-admin/events", as(OTHER_SERVICE))],
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
    "the claims read",
    () =>
      wreck.get(
        "/grant-admin/grants/wood/applications/REF-1/claims",
        as(OTHER_SERVICE),
      ),
  ],
];

// The one test here that reaches a handler reads the Caseworking stub, so
// this file leaves it as it found it - the suite shares one stub process.
beforeEach(async () => {
  await resetCwStub();
});

describe("the grant-admin surface answers one client", () => {
  // 403 and not 401: the credential is valid. A 401 would send the caller off
  // to fix something that is not broken.
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

  // Authentication still comes first: an unknown token never reaches the
  // client check.
  it("still answers 401 to a credential it does not know", async () => {
    await expect(
      wreck.get("/grant-admin/events", as(NOT_A_TOKEN)),
    ).rejects.toMatchObject({ output: { statusCode: 401 } });
  });

  // The suite's own credential IS the admin client, exactly as a deployed one
  // is - every other test in this directory is the positive case, and this
  // says so once explicitly.
  it("answers the grants platform admin", async () => {
    const { res } = await wreck.get("/grant-admin/events");

    expect(res.statusCode).toBe(200);
  });
});
