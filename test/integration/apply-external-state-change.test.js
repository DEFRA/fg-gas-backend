import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Application } from "../../src/grants/models/application.js";
import { Grant } from "../../src/grants/models/grant.js";
import {
  findByClientRef,
  save as saveApplication,
} from "../../src/grants/repositories/application.repository.js";
import { save as saveGrant } from "../../src/grants/repositories/grant.repository.js";
import { applyExternalStateChange } from "../../src/grants/use-cases/apply-event-status-change.service.js";

let client;
let grants, applications;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  grants = client.db().collection("grants");
  applications = client.db().collection("applications");
});

afterAll(async () => {
  await client?.close();
});

describe("Integration Test: applyExternalStateChange", () => {
  beforeEach(async () => {
    // Clean up database
    await grants.deleteMany({});
    await applications.deleteMany({});
  });

  it("should successfully apply external state change with valid transition", async () => {
    // 1. Create a grant with externalStatusMap and validFrom rules
    const grant = new Grant({
      code: "test-grant-001",
      metadata: {
        description: "Test Grant",
        startDate: "2024-01-01T00:00:00.000Z",
      },
      actions: [],
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "REVIEW_APPLICATION",
              statuses: [
                { code: "RECEIVED" },
                {
                  code: "IN_PROGRESS",
                  validFrom: ["RECEIVED"],
                },
                {
                  code: "APPROVED",
                  validFrom: ["IN_PROGRESS"],
                  entryProcesses: ["GENERATE_AGREEMENT"],
                },
              ],
            },
          ],
        },
      ],
      externalStatusMap: {
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW_APPLICATION",
                statuses: [
                  {
                    code: "IN_PROGRESS",
                    source: "CW",
                    mappedTo: "::IN_PROGRESS",
                  },
                  {
                    code: "APPROVED",
                    source: "CW",
                    mappedTo: "::APPROVED",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    await saveGrant(grant);
    // 2. Create an application in RECEIVED status
    const application = Application.new({
      clientRef: "APP-12345",
      code: "test-grant-001",
      currentPhase: "PRE_AWARD",
      currentStage: "REVIEW_APPLICATION",
      currentStatus: "RECEIVED",
      submittedAt: new Date().toISOString(),
      identifiers: { userId: "user-123" },
      phases: [],
    });

    await saveApplication(application);

    // 3. Apply external state change from CW: RECEIVED -> IN_PROGRESS (valid)
    await applyExternalStateChange({
      sourceSystem: "CW",
      clientRef: "APP-12345",
      externalRequestedState: "IN_PROGRESS",
      eventData: { caseRef: "CASE-123", workflowCode: "test-grant-001" },
    });

    // 4. Verify the application status changed
    const updatedApp = await findByClientRef("APP-12345");
    expect(updatedApp.currentStatus).toBe("IN_PROGRESS");
    expect(updatedApp.getFullyQualifiedStatus()).toBe(
      "PRE_AWARD:REVIEW_APPLICATION:IN_PROGRESS",
    );
  });

  it("should reject invalid transition (not in validFrom)", async () => {
    // 1. Create grant
    const grant = new Grant({
      code: "test-grant-002",
      metadata: {
        description: "Test Grant",
        startDate: "2024-01-01T00:00:00.000Z",
      },
      actions: [],
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "REVIEW_APPLICATION",
              statuses: [
                { code: "RECEIVED" },
                {
                  code: "APPROVED",
                  validFrom: ["IN_PROGRESS"], // Can only approve from IN_PROGRESS
                },
              ],
            },
          ],
        },
      ],
      externalStatusMap: {
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW_APPLICATION",
                statuses: [
                  {
                    code: "APPROVED",
                    source: "CW",
                    mappedTo: "::APPROVED",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    await saveGrant(grant);

    // 2. Create application in RECEIVED status
    const application = Application.new({
      clientRef: "APP-67890",
      code: "test-grant-002",
      currentPhase: "PRE_AWARD",
      currentStage: "REVIEW_APPLICATION",
      currentStatus: "RECEIVED",
      submittedAt: new Date().toISOString(),
      identifiers: { userId: "user-456" },
      phases: [],
    });

    await saveApplication(application);

    // 3. Try to apply invalid transition: RECEIVED -> APPROVED (should be ignored)
    await applyExternalStateChange({
      sourceSystem: "CW",
      clientRef: "APP-67890",
      externalRequestedState: "APPROVED",
      eventData: {},
    });

    // 4. Verify the application status DID NOT change
    const unchangedApp = await findByClientRef("APP-67890");
    expect(unchangedApp.currentStatus).toBe("RECEIVED"); // Still RECEIVED
    expect(unchangedApp.getFullyQualifiedStatus()).toBe(
      "PRE_AWARD:REVIEW_APPLICATION:RECEIVED",
    );
  });

  it("should ignore unmapped external status", async () => {
    // 1. Create grant
    const grant = new Grant({
      code: "test-grant-003",
      metadata: {
        description: "Test Grant",
        startDate: "2024-01-01T00:00:00.000Z",
      },
      actions: [],
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "REVIEW_APPLICATION",
              statuses: [{ code: "RECEIVED" }, { code: "IN_PROGRESS" }],
            },
          ],
        },
      ],
      externalStatusMap: {
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW_APPLICATION",
                statuses: [
                  {
                    code: "IN_PROGRESS",
                    source: "CW",
                    mappedTo: "::IN_PROGRESS",
                  },
                  // APPROVED is NOT mapped
                ],
              },
            ],
          },
        ],
      },
    });

    await saveGrant(grant);

    // 2. Create application
    const application = Application.new({
      clientRef: "APP-99999",
      code: "test-grant-003",
      currentPhase: "PRE_AWARD",
      currentStage: "REVIEW_APPLICATION",
      currentStatus: "RECEIVED",
      submittedAt: new Date().toISOString(),
      identifiers: { userId: "user-789" },
      phases: [],
    });

    await saveApplication(application);

    // 3. Try to apply unmapped status
    await applyExternalStateChange({
      sourceSystem: "CW",
      clientRef: "APP-99999",
      externalRequestedState: "SOME_UNMAPPED_STATUS",
      eventData: {},
    });

    // 4. Verify status unchanged
    const unchangedApp = await findByClientRef("APP-99999");
    expect(unchangedApp.currentStatus).toBe("RECEIVED");
  });

  it("should handle phase transitions with fully qualified validFrom", async () => {
    // 1. Create grant with phase transition
    const grant = new Grant({
      code: "test-grant-004",
      metadata: {
        description: "Test Grant",
        startDate: "2024-01-01T00:00:00.000Z",
      },
      actions: [],
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "REVIEW_APPLICATION",
              statuses: [
                { code: "RECEIVED" },
                {
                  code: "APPROVED",
                  validFrom: ["RECEIVED"],
                },
              ],
            },
            {
              code: "REVIEW_OFFER",
              statuses: [
                {
                  code: "OFFERED",
                  validFrom: ["PRE_AWARD:REVIEW_APPLICATION:APPROVED"],
                },
              ],
            },
          ],
        },
      ],
      externalStatusMap: {
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW_APPLICATION",
                statuses: [
                  {
                    code: "APPROVED",
                    source: "CW",
                    mappedTo: "::APPROVED",
                  },
                  {
                    code: "offered",
                    source: "AS",
                    mappedTo: "PRE_AWARD:REVIEW_OFFER:OFFERED",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    await saveGrant(grant);

    // 2. Create application in APPROVED status
    const application = Application.new({
      clientRef: "APP-PHASE-001",
      code: "test-grant-004",
      currentPhase: "PRE_AWARD",
      currentStage: "REVIEW_APPLICATION",
      currentStatus: "APPROVED",
      submittedAt: new Date().toISOString(),
      identifiers: { userId: "user-phase" },
      phases: [],
    });

    await saveApplication(application);

    // 3. Apply external state change from AS: transitions to new stage
    await applyExternalStateChange({
      sourceSystem: "AS",
      clientRef: "APP-PHASE-001",
      externalRequestedState: "offered",
      eventData: { agreementRef: "AGR-123" },
    });

    // 4. Verify phase and stage transitioned
    const transitionedApp = await findByClientRef("APP-PHASE-001");
    expect(transitionedApp.currentPhase).toBe("PRE_AWARD");
    expect(transitionedApp.currentStage).toBe("REVIEW_OFFER");
    expect(transitionedApp.currentStatus).toBe("OFFERED");
    expect(transitionedApp.getFullyQualifiedStatus()).toBe(
      "PRE_AWARD:REVIEW_OFFER:OFFERED",
    );
  });
});
