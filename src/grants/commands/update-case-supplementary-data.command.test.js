import { expect, it } from "vitest";
import { UpdateCaseSupplementaryDataCommand } from "./update-case-supplementary-data.command.js";

it("carries an opaque supplementary update without changing case status", () => {
  const data = {
    caseRef: "case-1",
    workflowCode: "example",
    supplementaryData: {
      targetNode: "results",
      dataType: "ARRAY",
      key: "id",
      data: { id: "one", arbitrary: [0, false, { nested: true }] },
    },
  };
  const command = new UpdateCaseSupplementaryDataCommand(data);
  expect(command.type).toBe(
    "cloud.defra.local.fg-gas-backend.case.update.supplementary.data",
  );
  expect(command.messageGroupId).toBe("case-1-example");
  expect(command.data).toEqual(data);
  expect(command.data).not.toHaveProperty("newStatus");
});
