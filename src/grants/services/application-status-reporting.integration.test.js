import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const position = (status) => ({
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status,
});

let replSet;
let client;
let db;
let save;
let findByClientRefAndCode;
let withTransaction;
let transitionApplicationUseCase;
let createTestApplication;
let createTestGrant;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "application-status-reporting-test");
  vi.resetModules();

  ({ mongoClient: client, db } = await import("../../common/mongo-client.js"));
  ({ withTransaction } = await import("../../common/with-transaction.js"));
  ({ save, findByClientRefAndCode } =
    await import("../repositories/application.repository.js"));
  ({ transitionApplicationUseCase } =
    await import("../use-cases/transition-application.use-case.js"));
  ({ createTestApplication } =
    await import("../../../test/helpers/applications.js"));
  ({ createTestGrant } = await import("../../../test/helpers/grants.js"));

  await client.connect();
  await db.createCollection("applications");
  await db.createCollection("outbox");
}, 120_000);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
  vi.unstubAllEnvs();
}, 120_000);

const reported = (code, status) => ({ code, reporting: { status } });

const scenario = async (code, statuses) => {
  const clientRef = "application-1";
  const grant = createTestGrant({
    code,
    phases: [
      {
        code: "PRE_AWARD",
        stages: [
          {
            code: "ASSESSMENT",
            statuses: [
              reported("APPLICATION_RECEIVED", "RECEIVED"),
              ...statuses,
            ],
          },
        ],
      },
    ],
  });
  const application = createTestApplication({ code, clientRef });
  await save(application);
  const ref = { code, clientRef };

  return {
    move: (status, afterMove = () => {}) =>
      withTransaction(async (session) => {
        const current = await findByClientRefAndCode(ref, session);
        await transitionApplicationUseCase(
          {
            application: current,
            grant,
            targetPosition: position(status),
            sideEffectContext: { ...ref, eventData: { userId: "operator-1" } },
          },
          session,
        );
        afterMove();
      }),
    stored: () => db.collection("applications").findOne(ref),
    events: () =>
      db
        .collection("outbox")
        .find({
          eventType: "ApplicationStatusChangedReport",
          segregationRef: `${clientRef}-${code}`,
        })
        .sort({ _id: 1 })
        .toArray(),
  };
};

describe("Application status reporting", () => {
  it("records mapped changes, skipping retries and unreportable moves", async () => {
    const first = await scenario("reporting-first", [
      reported("DECISION_MADE", "APPROVED"),
      reported("DECISION_RECORDED", "APPROVED"),
      { code: "INTERNAL_REVIEW" },
      reported("APPLICATION_WITHDRAWN", "WITHDRAWN"),
    ]);
    const second = await scenario("reporting-second", [
      { code: "DECISION_MADE" },
    ]);

    await Promise.all([
      first.move("DECISION_MADE"),
      first.move("DECISION_MADE"),
    ]);
    await second.move("DECISION_MADE");
    await first.move("DECISION_RECORDED");
    await first.move("INTERNAL_REVIEW");
    await first.move("APPLICATION_WITHDRAWN");
    await first.move("DECISION_MADE");

    const events = await first.events();
    expect(
      events.map(({ event }) => [
        event.eventData.previousApplicationStatus,
        event.eventData.applicationStatus,
      ]),
    ).toEqual([
      ["RECEIVED", "APPROVED"],
      ["APPROVED", "WITHDRAWN"],
      ["WITHDRAWN", "APPROVED"],
    ]);
    const saved = await first.stored();
    expect(events.at(-1).event.eventData).toMatchObject({
      eventType: "APPLICATION_STATUS_CHANGED",
      applicationId: saved.clientRef,
      applicationType: saved.code,
      sbi: saved.identifiers.sbi,
      statusDate: saved.updatedAt,
      userId: "operator-1",
    });
    expect(saved.lastReportedStatus).toBe("APPROVED");
    expect(await second.events()).toEqual([]);
  });

  it("reports the final withdrawal rather than the intermediate request", async () => {
    const application = await scenario("reporting-withdrawal", [
      {
        ...reported("WITHDRAWAL_REQUESTED", "PENDING_WITHDRAWAL"),
        processes: ["REQUEST_APPLICATION_WITHDRAWAL"],
      },
      reported("APPLICATION_WITHDRAWN", "WITHDRAWN"),
    ]);

    await application.move("WITHDRAWAL_REQUESTED");

    const events = await application.events();
    expect(events).toHaveLength(1);
    expect(events[0].event.eventData).toMatchObject({
      previousApplicationStatus: "RECEIVED",
      applicationStatus: "WITHDRAWN",
    });
    expect(await application.stored()).toMatchObject({
      currentStatus: "APPLICATION_WITHDRAWN",
      lastReportedStatus: "WITHDRAWN",
    });
  });

  it("rolls the status and reporting event back together", async () => {
    const application = await scenario("reporting-rollback", [
      reported("DECISION_MADE", "APPROVED"),
    ]);

    await expect(
      application.move("DECISION_MADE", () => {
        throw new Error("abort status change");
      }),
    ).rejects.toThrow("abort status change");

    expect(await application.stored()).toMatchObject({
      currentStatus: "APPLICATION_RECEIVED",
    });
    expect(await application.events()).toEqual([]);
  });
});
