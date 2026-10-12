import { describe, expect, it } from "vitest";
import { Position } from "../models/position.js";
import { UpdateCaseStatusCommand } from "./update-case-status.command.js";

const position = new Position({
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status: "IN_REVIEW",
});

describe("UpdateCaseStatusCommand", () => {
  describe("forPosition", () => {
    it("carries the position as plain strings", () => {
      const command = UpdateCaseStatusCommand.forPosition({
        caseRef: "case-1",
        workflowCode: "grant-1",
        configVersion: "1.0.0",
        position,
      });

      expect(command).toBeInstanceOf(UpdateCaseStatusCommand);
      expect(command.data).toStrictEqual({
        caseRef: "case-1",
        workflowCode: "grant-1",
        newStatus: "PRE_AWARD:ASSESSMENT:IN_REVIEW",
        supplementaryData: {
          currentConfigVersion: "1.0.0",
          phase: "PRE_AWARD",
          stage: "ASSESSMENT",
        },
      });
    });

    it("takes the phase and stage from the previous position", () => {
      const command = UpdateCaseStatusCommand.forPosition({
        caseRef: "case-1",
        workflowCode: "grant-1",
        position: new Position({
          phase: "POST_AWARD",
          stage: "AWARD",
          status: "OFFER_ACCEPTED",
        }),
        previousPosition: position,
      });

      expect(command.data).toStrictEqual({
        caseRef: "case-1",
        workflowCode: "grant-1",
        newStatus: "POST_AWARD:AWARD:OFFER_ACCEPTED",
        supplementaryData: {
          currentConfigVersion: null,
          phase: "PRE_AWARD",
          stage: "ASSESSMENT",
        },
      });
    });

    it("builds the same command as the constructor given the same values", () => {
      const supplementary = {
        targetNode: "agreements",
        dataType: "ARRAY",
        key: "agreementRef",
        data: { agreementRef: "agreement-1" },
      };

      const command = UpdateCaseStatusCommand.forPosition({
        caseRef: "case-1",
        workflowCode: "grant-1",
        configVersion: "1.0.0",
        position,
        ...supplementary,
      });
      const expected = new UpdateCaseStatusCommand({
        caseRef: "case-1",
        workflowCode: "grant-1",
        configVersion: "1.0.0",
        newStatus: "PRE_AWARD:ASSESSMENT:IN_REVIEW",
        phase: "PRE_AWARD",
        stage: "ASSESSMENT",
        ...supplementary,
      });

      expect(JSON.stringify(command.data)).toBe(JSON.stringify(expected.data));
      expect(command.messageGroupId).toBe(expected.messageGroupId);
      expect(command.type).toBe(expected.type);
    });
  });
});
