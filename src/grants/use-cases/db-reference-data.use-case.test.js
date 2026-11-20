import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { withTransaction } from "../../common/with-transaction.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import { DbReferenceData } from "../models/db-reference-data.js";
import {
  findByGrantCodeAndName,
  replace,
} from "../repositories/reference-data.repository.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";
import {
  addDbReferenceDataItemUseCase,
  changeDbReferenceDataItemUseCase,
  removeDbReferenceDataItemUseCase,
} from "./db-reference-data.use-case.js";
import { resolveGrantAdministration } from "./resolve-grant-administration.use-case.js";

vi.mock("../../common/with-transaction.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../repositories/reference-data.repository.js");
vi.mock("../services/resolve-config-version.service.js");
vi.mock("./resolve-grant-administration.use-case.js");

const session = { id: "active-session" };
const grant = createTestGrant({
  code: "pigs-might-fly",
  referenceData: [
    { name: "fly-db", source: { type: "db" } },
    {
      name: "fly-inline",
      source: {
        type: "inline",
        items: [{ code: "WINGS", description: "Wings" }],
      },
    },
  ],
});
const args = {
  grantCode: "pigs-might-fly",
  name: "fly-db",
  caller: "fg-grants-platform-admin",
};
const held = () =>
  DbReferenceData.fromDocument({
    grantCode: "pigs-might-fly",
    name: "fly-db",
    items: [{ code: "WINGS", description: "Wings" }],
    updatedAt: null,
  });

describe("DB Reference Data use cases", () => {
  beforeEach(() => {
    withTransaction.mockImplementation((callback) => callback(session));
    resolveGrantAdministration.mockResolvedValue();
    resolveAndFetchGrant.mockResolvedValue({ grant });
    findByGrantCodeAndName.mockResolvedValue(held());
    replace.mockResolvedValue();
    writeAuditEvent.mockResolvedValue();
  });

  it("adds an item and audits it in the same transaction", async () => {
    const result = await addDbReferenceDataItemUseCase({
      ...args,
      item: { code: "GLIDERS", description: "Gliders" },
    });

    expect(result.items.map(({ code }) => code)).toEqual(["WINGS", "GLIDERS"]);
    expect(replace).toHaveBeenCalledWith(expect.any(DbReferenceData), session);
    expect(writeAuditEvent.mock.calls[0][0]).toMatchObject({
      status: "success",
      details: {
        name: "fly-db",
        change: "add",
        oldItem: null,
        newItem: { code: "GLIDERS", description: "Gliders" },
      },
    });
  });

  it("changes an item's description", async () => {
    const result = await changeDbReferenceDataItemUseCase({
      ...args,
      itemCode: "WINGS",
      item: { description: "Feathered wings" },
    });

    expect(result.items).toEqual([
      { code: "WINGS", description: "Feathered wings" },
    ]);
    expect(writeAuditEvent.mock.calls[0][0]).toMatchObject({
      details: { oldItem: { code: "WINGS", description: "Wings" } },
    });
  });

  it("removes an item", async () => {
    const result = await removeDbReferenceDataItemUseCase({
      ...args,
      itemCode: "WINGS",
    });

    expect(result.items).toEqual([]);
  });

  it("refuses to change a set that is not held in the db", async () => {
    await expect(
      addDbReferenceDataItemUseCase({
        ...args,
        name: "fly-inline",
        item: { code: "GLIDERS", description: "Gliders" },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });
    expect(replace).not.toHaveBeenCalled();
  });

  it("changes nothing when grant administration is denied", async () => {
    resolveGrantAdministration.mockRejectedValue(Boom.forbidden());

    await expect(
      removeDbReferenceDataItemUseCase({ ...args, itemCode: "WINGS" }),
    ).rejects.toMatchObject({ output: { statusCode: 403 } });
    expect(findByGrantCodeAndName).not.toHaveBeenCalled();
  });

  it("audits a refused change", async () => {
    await expect(
      addDbReferenceDataItemUseCase({
        ...args,
        item: { code: "WINGS", description: "More wings" },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });
    expect(writeAuditEvent.mock.calls[0][0]).toMatchObject({
      status: "failure",
      details: { errorCode: 409 },
    });
  });
});
