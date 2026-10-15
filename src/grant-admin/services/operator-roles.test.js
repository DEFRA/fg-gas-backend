import { describe, expect, it, vi } from "vitest";
import { withRequestContext } from "../../common/get-request-context.js";
import { logger } from "../../common/logger.js";
import { findCwUserRoles } from "../repositories/cw-users.repository.js";
import {
  CASEWORKING_ROLES_UNAVAILABLE,
  findOperatorRoles,
  prefetchOperatorRoles,
} from "./operator-roles.js";

vi.mock("../../common/logger.js");
vi.mock("../repositories/cw-users.repository.js");

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const FAILURE = "Caseworking answered an unreadable body";

const asOperator = (call) => withRequestContext({ user: OID }, call);

describe("findOperatorRoles", () => {
  it("asks Caseworking for the roles of the operator on the request", async () => {
    findCwUserRoles.mockResolvedValue({ roles: ["ROLE_A"] });

    expect(await asOperator(() => findOperatorRoles())).toEqual(["ROLE_A"]);
    expect(findCwUserRoles).toHaveBeenCalledWith(OID);
  });

  it("answers 503 with an errorCode, and warns why, when Caseworking cannot say", async () => {
    findCwUserRoles.mockResolvedValue({ roles: null, failure: FAILURE });

    const error = await asOperator(() => findOperatorRoles()).catch((e) => e);

    expect(error.output.statusCode).toBe(503);
    expect(error.output.payload).toMatchObject({
      message: "Caseworking roles could not be determined",
      errorCode: CASEWORKING_ROLES_UNAVAILABLE,
    });
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      `Operator roles could not be determined: ${FAILURE}`,
    );
  });

  it.each([
    ["a request naming no operator", {}],
    ["no request at all", null],
  ])(
    "answers no roles, without asking Caseworking, for %s",
    async (_, context) => {
      const roles = context
        ? await withRequestContext(context, () => findOperatorRoles())
        : await findOperatorRoles();

      expect(roles).toEqual([]);
      expect(findCwUserRoles).not.toHaveBeenCalled();
    },
  );
});

describe("prefetchOperatorRoles", () => {
  it("asks Caseworking at once, before the roles are asked for", () => {
    findCwUserRoles.mockResolvedValue({ roles: ["ROLE_A"] });

    asOperator(() => prefetchOperatorRoles());

    expect(findCwUserRoles).toHaveBeenCalledWith(OID);
  });

  it("answers the roles it fetched, asking Caseworking only once", async () => {
    findCwUserRoles.mockResolvedValue({ roles: ["ROLE_A"] });

    const findHeldRoles = asOperator(() => prefetchOperatorRoles());

    expect(await findHeldRoles()).toEqual(["ROLE_A"]);
    expect(await findHeldRoles()).toEqual(["ROLE_A"]);
    expect(findCwUserRoles).toHaveBeenCalledTimes(1);
  });

  it("neither warns nor fails when the roles are never asked for", async () => {
    findCwUserRoles.mockResolvedValue({ roles: null, failure: FAILURE });

    asOperator(() => prefetchOperatorRoles());
    await vi.waitFor(() => expect(findCwUserRoles).toHaveBeenCalled());

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("answers 503 and warns once when the roles are asked for but unknown", async () => {
    findCwUserRoles.mockResolvedValue({ roles: null, failure: FAILURE });

    const findHeldRoles = asOperator(() => prefetchOperatorRoles());

    await expect(findHeldRoles()).rejects.toMatchObject({
      output: { statusCode: 503 },
    });
    await expect(findHeldRoles()).rejects.toMatchObject({
      output: { statusCode: 503 },
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
