import { describe, expect, it } from "vitest";
import { createTestGrant } from "../../../test/helpers/grants.js";

describe("Grant", () => {
  it("can create a Grant model", () => {
    const grant = createTestGrant({
      code: "test-grant",
      metadata: {
        description: "Test Grant Description",
        startDate: "2023-01-01T00:00:00Z",
      },
      actions: [
        { name: "action1", method: "POST", url: "http://example.com/action1" },
        { name: "action2", method: "GET", url: "http://example.com/action2" },
      ],
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "ASSESSMENT",
              statuses: [{ code: "RECEIVED" }],
            },
          ],
          questions: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
          },
        },
      ],
    });

    expect(grant).toEqual({
      code: "test-grant",
      metadata: {
        description: "Test Grant Description",
        startDate: "2023-01-01T00:00:00Z",
      },
      actions: [
        { name: "action1", method: "POST", url: "http://example.com/action1" },
        { name: "action2", method: "GET", url: "http://example.com/action2" },
      ],
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "ASSESSMENT",
              statuses: [{ code: "RECEIVED" }],
            },
          ],
          questions: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
          },
        },
      ],
    });
  });

  describe("hasPhases", () => {
    it("returns true when grant has phases", () => {
      const grant = createTestGrant();

      expect(grant.hasPhases).toBe(true);
    });

    it("returns false when grant has empty phases array", () => {
      const grant = createTestGrant({
        phases: [],
      });

      expect(grant.hasPhases).toBe(false);
    });

    it("returns false when grant has no phases", () => {
      const grant = createTestGrant({
        phases: undefined,
      });

      expect(grant.hasPhases).toBe(false);
    });
  });

  describe("getPhase", () => {
    const grant = createTestGrant({
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "ASSESSMENT",
              statuses: [{ code: "RECEIVED" }],
            },
          ],
        },
        {
          code: "POST_AWARD",
          stages: [
            {
              code: "DELIVERY",
              statuses: [{ code: "IN_PROGRESS" }],
            },
          ],
        },
      ],
    });

    it("returns the first phase when no phaseCode is provided", () => {
      const phase = grant.getPhase();

      expect(phase).toEqual({
        code: "PRE_AWARD",
        stages: [
          {
            code: "ASSESSMENT",
            statuses: [{ code: "RECEIVED" }],
          },
        ],
      });
    });

    it("returns the matching phase when phaseCode is provided", () => {
      const phase = grant.getPhase("POST_AWARD");

      expect(phase).toEqual({
        code: "POST_AWARD",
        stages: [
          {
            code: "DELIVERY",
            statuses: [{ code: "IN_PROGRESS" }],
          },
        ],
      });
    });

    it("returns undefined when phaseCode does not match any phase", () => {
      const phase = grant.getPhase("UNKNOWN");

      expect(phase).toBeUndefined();
    });
  });

  describe("getQuestions", () => {
    it("returns questions for the specified phase", () => {
      const grant = createTestGrant({
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "ASSESSMENT",
                statuses: [{ code: "RECEIVED" }],
              },
            ],
            questions: {
              type: "object",
              properties: { question1: { type: "string" } },
            },
          },
          {
            code: "POST_AWARD",
            stages: [
              {
                code: "DELIVERY",
                statuses: [{ code: "IN_PROGRESS" }],
              },
            ],
            questions: {
              type: "object",
              properties: { question2: { type: "string" } },
            },
          },
        ],
      });

      const questions = grant.getQuestions("POST_AWARD");

      expect(questions).toEqual({
        type: "object",
        properties: { question2: { type: "string" } },
      });
    });

    it("returns questions for the first phase when no phaseCode is provided", () => {
      const grant = createTestGrant({
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "ASSESSMENT",
                statuses: [{ code: "RECEIVED" }],
              },
            ],
            questions: {
              type: "object",
              properties: { question1: { type: "string" } },
            },
          },
        ],
      });

      const questions = grant.getQuestions();

      expect(questions).toEqual({
        type: "object",
        properties: { question1: { type: "string" } },
      });
    });

    it("returns empty object when phase has no questions", () => {
      const grant = createTestGrant({
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "ASSESSMENT",
                statuses: [{ code: "RECEIVED" }],
              },
            ],
          },
        ],
      });

      const questions = grant.getQuestions("PRE_AWARD");

      expect(questions).toEqual({});
    });

    it("returns empty object when grant has no phases", () => {
      const grant = createTestGrant({
        phases: [],
      });

      const questions = grant.getQuestions();

      expect(questions).toEqual({});
    });

    it("returns empty object when phase is not found", () => {
      const grant = createTestGrant({
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "ASSESSMENT",
                statuses: [{ code: "RECEIVED" }],
              },
            ],
            questions: {
              type: "object",
              properties: { question1: { type: "string" } },
            },
          },
        ],
      });

      const questions = grant.getQuestions("UNKNOWN");

      expect(questions).toEqual({});
    });
  });

  describe("getInitialState", () => {
    it("returns the initial state from the first phase, stage, and status", () => {
      const grant = createTestGrant({
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "ASSESSMENT",
                statuses: [{ code: "RECEIVED" }, { code: "REVIEW" }],
              },
            ],
          },
        ],
      });

      const initialState = grant.getInitialState();

      expect(initialState).toEqual({
        phase: {
          code: "PRE_AWARD",
          stages: [
            {
              code: "ASSESSMENT",
              statuses: [{ code: "RECEIVED" }, { code: "REVIEW" }],
            },
          ],
        },
        stage: {
          code: "ASSESSMENT",
          statuses: [{ code: "RECEIVED" }, { code: "REVIEW" }],
        },
        status: { code: "RECEIVED" },
      });
    });

    it("throws error when grant has no phases", () => {
      const grant = createTestGrant({
        phases: [],
      });

      expect(() => grant.getInitialState()).toThrow(
        'Grant "test-grant" has no phases defined',
      );
    });
  });
});
