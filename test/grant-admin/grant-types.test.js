import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { holdCwRoles, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import {
  publishGrantAlias,
  putGrantDefinition,
  seedAdministeredGrant,
} from "../helpers/grants.js";
import { wreck } from "../helpers/wreck.js";

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OPERATOR = { "x-actor": "Jo Operator", "x-actor-id": OID };

let client;
let db;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
});

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  await resetCwStub();
});

const seedGrant = (code, options) => seedAdministeredGrant(db, code, options);

const holdRoles = (roles) => holdCwRoles(OID, roles);

const listGrantTypes = async () => {
  const { payload } = await wreck.get("/grant-admin/grants", {
    headers: OPERATOR,
    json: true,
  });

  return payload;
};

describe("GET /grant-admin/grants", () => {
  it("lists only the current grants whose admin role the operator holds, by code", async () => {
    await seedGrant("woodland-it", {
      role: "ROLE_WOODLAND_ADMIN",
      description: "Woodland Management Plan",
    });
    await seedGrant("fptt-it", {
      role: "ROLE_FPTT_ADMIN",
      description: "Farming Payments",
    });
    await seedGrant("other-it", {
      role: "ROLE_OTHER_ADMIN",
      description: "Not administered",
    });
    await seedGrant("unconfigured-it", { description: "No admin role" });
    await holdRoles(["ROLE_WOODLAND_ADMIN", "ROLE_FPTT_ADMIN"]);

    expect(await listGrantTypes()).toEqual({
      grantTypes: [
        { code: "fptt-it", name: "Farming Payments" },
        { code: "woodland-it", name: "Woodland Management Plan" },
      ],
    });
  });

  it("names a grant type from its latest active version", async () => {
    await seedGrant("woodland-it", {
      role: "ROLE_WOODLAND_ADMIN",
      description: "Old name",
    });
    await seedGrant("woodland-it", {
      role: "ROLE_WOODLAND_ADMIN",
      description: "Woodland Management Plan",
      version: "1.1.0",
    });
    await holdRoles(["ROLE_WOODLAND_ADMIN"]);

    expect(await listGrantTypes()).toEqual({
      grantTypes: [{ code: "woodland-it", name: "Woodland Management Plan" }],
    });
  });

  it("lists none for an operator holding no grant's admin role", async () => {
    await seedGrant("woodland-it", {
      role: "ROLE_WOODLAND_ADMIN",
      description: "Woodland Management Plan",
    });

    expect(await listGrantTypes()).toEqual({ grantTypes: [] });
  });

  it("leaves out a version published under an alias of a grant, and stops fetching it", async () => {
    await seedGrant("frps-it", {
      role: "ROLE_FRPS_ADMIN",
      description: "Farm payments",
    });
    const { s3Key, definition } = await publishGrantAlias(
      db,
      "farm-it",
      "frps-it",
    );
    await holdRoles(["ROLE_FRPS_ADMIN"]);

    const listed = { grantTypes: [{ code: "frps-it", name: "Farm payments" }] };
    expect(await listGrantTypes()).toEqual(listed);
    const alias = await db
      .collection("config_versions")
      .findOne({ grantCode: "farm-it" });
    expect(alias.definitions.grant).toMatchObject({
      fetchStatus: "permanent_error",
      fetchError: 'Definition is for "frps-it", not "farm-it"',
    });

    // A definition GAS would store and list, were it to fetch the alias again.
    await putGrantDefinition(s3Key, { ...definition, code: "farm-it" });
    expect(await listGrantTypes()).toEqual(listed);
  });

  it("answers 503 naming the roles lookup when Caseworking cannot say", async () => {
    await seedGrant("woodland-it", {
      role: "ROLE_WOODLAND_ADMIN",
      description: "Woodland Management Plan",
    });
    await setCwStub({ users: { mode: "error" } });

    const error = await listGrantTypes().catch((e) => e);

    expect(error.output.statusCode).toBe(503);
    expect(error.data.payload).toMatchObject({
      errorCode: "CASEWORKING_ROLES_UNAVAILABLE",
    });
  });
});
