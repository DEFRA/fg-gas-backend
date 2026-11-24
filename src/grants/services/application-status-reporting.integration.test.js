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
let saveGrant;
let claimEvents;
let submitApplicationUseCase;
let seedConfigVersion;
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
  ({ save: saveGrant } = await import("../repositories/grant.repository.js"));
  ({ claimEvents } =
    await import("../../events/repositories/outbox.repository.js"));
  ({ submitApplicationUseCase } =
    await import("../use-cases/submit-application.use-case.js"));
  ({ createTestApplication, seedConfigVersion } =
    await import("../../../test/helpers/applications.js"));
  ({ createTestGrant } = await import("../../../test/helpers/grants.js"));

  await client.connect();
  await db.createCollection("applications");
  await db.createCollection("application_series");
  await db.createCollection("outbox");
}, 120_000);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
  vi.unstubAllEnvs();
}, 120_000);

const initialStatus = "STATUS_APPLICATION_RECEIVED";

const scenario = async (code, statuses, { submit = false } = {}) => {
  const clientRef = "application-1";
  const grant = createTestGrant({
    code,
    phases: [
      {
        code: "PRE_AWARD",
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
        stages: [
          {
            code: "ASSESSMENT",
            statuses: [{ code: initialStatus }, ...statuses],
          },
        ],
      },
    ],
  });
  const application = createTestApplication({
    code,
    clientRef,
    currentStatus: initialStatus,
  });
  if (submit) {
    await saveGrant(grant);
    await seedConfigVersion(db, code, grant.version, {
      withAgreementDefinition: false,
    });
    await submitApplicationUseCase(code, {
      metadata: {
        clientRef,
        configVersion: grant.version,
        ...application.identifiers,
      },
      answers: {},
    });
  } else {
    await save(application);
  }
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
  it("queues the receipt before the initial status, then reports a later withdrawal", async () => {
    const code = "reporting-initial";
    const application = await scenario(
      code,
      [{ code: "APPLICATION_WITHDRAWN" }],
      { submit: true },
    );
    const stored = await application.stored();
    const segregationRef = `${stored.clientRef}-${code}`;

    // The two publications can be inserted in the same millisecond.
    await db.collection("outbox").updateMany(
      { segregationRef },
      {
        $set: { publicationDate: new Date(stored.createdAt) },
      },
    );
    const queued = [
      ...(await claimEvents("reporting-test", segregationRef)),
      ...(await claimEvents("reporting-test", segregationRef)),
    ];
    const reportingEvents = queued
      .map(({ event }) => event.eventData)
      .filter(Boolean);

    expect(reportingEvents.map(({ eventType }) => eventType)).toEqual([
      "APPLICATION_CREATED",
      "APPLICATION_STATUS_CHANGED",
    ]);
    expect(reportingEvents[1]).toMatchObject({
      applicationId: reportingEvents[0].applicationId,
      applicationType: code,
      applicationStatus: initialStatus,
      statusDate: stored.createdAt,
    });
    expect(reportingEvents[1]).not.toHaveProperty("previousApplicationStatus");

    await application.move("APPLICATION_WITHDRAWN");

    const events = await application.events();
    expect(events).toHaveLength(2);
    expect(events[1].event.eventData).toMatchObject({
      previousApplicationStatus: initialStatus,
      applicationStatus: "APPLICATION_WITHDRAWN",
    });
  });

  it("reports each committed status, including reversals, once", async () => {
    const code = "reporting-all";
    const application = await scenario(code, [
      { code: "INTERNAL_REVIEW" },
      { code: "DECISION_MADE" },
    ]);

    await Promise.all([
      application.move("INTERNAL_REVIEW"),
      application.move("INTERNAL_REVIEW"),
    ]);
    await application.move("DECISION_MADE");
    await application.move("INTERNAL_REVIEW");

    const events = await application.events();
    expect(
      events.map(({ event }) => [
        event.eventData.previousApplicationStatus,
        event.eventData.applicationStatus,
      ]),
    ).toEqual([
      [initialStatus, "INTERNAL_REVIEW"],
      ["INTERNAL_REVIEW", "DECISION_MADE"],
      ["DECISION_MADE", "INTERNAL_REVIEW"],
    ]);
    const saved = await application.stored();
    expect(events.at(-1).event.eventData).toMatchObject({
      eventType: "APPLICATION_STATUS_CHANGED",
      applicationId: saved.clientRef,
      applicationType: code,
      sbi: saved.identifiers.sbi,
      statusDate: saved.updatedAt,
      userId: "operator-1",
    });
  });

  it("reports the final withdrawal rather than the intermediate request", async () => {
    const application = await scenario("reporting-withdrawal", [
      {
        code: "WITHDRAWAL_REQUESTED",
        processes: ["REQUEST_APPLICATION_WITHDRAWAL"],
      },
      { code: "APPLICATION_WITHDRAWN" },
    ]);

    await application.move("WITHDRAWAL_REQUESTED");

    const events = await application.events();
    expect(events).toHaveLength(1);
    expect(events[0].event.eventData).toMatchObject({
      previousApplicationStatus: initialStatus,
      applicationStatus: "APPLICATION_WITHDRAWN",
    });
    expect(await application.stored()).toMatchObject({
      currentStatus: "APPLICATION_WITHDRAWN",
    });
  });

  it("rolls the status and reporting event back together", async () => {
    const application = await scenario("reporting-rollback", [
      { code: "DECISION_MADE" },
    ]);

    await expect(
      application.move("DECISION_MADE", () => {
        throw new Error("abort status change");
      }),
    ).rejects.toThrow("abort status change");

    expect(await application.stored()).toMatchObject({
      currentStatus: initialStatus,
    });
    expect(await application.events()).toEqual([]);
  });
});
