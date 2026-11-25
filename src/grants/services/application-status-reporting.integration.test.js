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
let findNextMessage;
let purgeById;
let redriveById;
let editPayloadById;
let OutboxSubscriber;
let saveEvents;
let submitApplicationUseCase;
let seedConfigVersion;
let findByClientRefAndCode;
let withTransaction;
let transitionApplicationUseCase;
let applyExternalStateChange;
let grantResolution;
let createTestApplication;
let createTestGrant;

beforeAll(async () => {
  // A stale rollout override must not pause reporting after the upgrade.
  vi.stubEnv("OUTBOX_SEQUENCED_DELIVERY_ENABLED", "false");
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
  ({ applyExternalStateChange } =
    await import("./apply-event-status-change.service.js"));
  grantResolution =
    await import("../use-cases/resolve-current-grant.use-case.js");
  ({ save: saveGrant } = await import("../repositories/grant.repository.js"));
  ({ saveEvents } = await import("../../events/save-events.js"));
  ({ findNextMessage, purgeById, redriveById, editPayloadById } =
    await import("../../events/repositories/outbox.repository.js"));
  ({ OutboxSubscriber } =
    await import("../../events/subscribers/outbox.subscriber.js"));
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

const scenario = async (
  code,
  statuses,
  { submit = false, externalStatusMap } = {},
) => {
  const clientRef = "application-1";
  const grant = createTestGrant({
    code,
    externalStatusMap,
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
    grant,
    ref,
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
  it("publishes the receipt, initial status and withdrawal in order across retries", async () => {
    const code = "reporting-initial";
    const application = await scenario(
      code,
      [{ code: "APPLICATION_WITHDRAWN" }],
      { submit: true },
    );
    const stored = await application.stored();
    const segregationRef = `${stored.clientRef}-${code}`;

    // A later writer's clock can put the withdrawal before both submission
    // reports. Delivery still follows the sequence assigned by the producer.
    await application.move("APPLICATION_WITHDRAWN");
    const reports = await db
      .collection("outbox")
      .find({ segregationRef, deliverySequence: { $exists: true } })
      .sort({ deliverySequence: 1 })
      .toArray();
    expect(reports.map(({ status }) => status)).toEqual([
      "PUBLISHED",
      "PUBLISHED",
      "PUBLISHED",
    ]);
    await db
      .collection("outbox")
      .updateOne(
        { segregationRef, deliverySequence: -1 },
        { $set: { publicationDate: new Date(1) } },
      );
    await db
      .collection("outbox")
      .updateOne(
        { segregationRef, deliverySequence: 1 },
        { $set: { publicationDate: new Date(0) } },
      );

    const subscriber = new OutboxSubscriber();
    const deliver = vi
      .spyOn(subscriber, "deliver")
      .mockRejectedValueOnce(new Error("temporary publishing failure"))
      .mockResolvedValue(undefined);
    const process = () =>
      subscriber.processWithLock("reporting-test", segregationRef);
    const otherGroups = await db
      .collection("outbox")
      .distinct("segregationRef", {
        segregationRef: { $ne: segregationRef },
      });
    const next = () => findNextMessage(otherGroups);

    const first = await db
      .collection("outbox")
      .findOne({ _id: (await next())._id });
    expect(first.event.eventData.eventType).toBe("APPLICATION_CREATED");
    await process();
    expect(deliver).toHaveBeenCalledTimes(1);
    await process();
    const deliveredReports = () =>
      deliver.mock.calls.flatMap(([, { eventData }]) =>
        eventData ? [eventData] : [],
      );
    expect(deliveredReports()).toHaveLength(1);
    const candidate = await next();
    if (candidate) {
      const row = await db.collection("outbox").findOne({ _id: candidate._id });
      expect(row.event.eventData).toBeUndefined();
    }
    await subscriber.processFailedEvents();
    await process();
    expect(deliveredReports()).toHaveLength(1);
    await subscriber.processResubmittedEvents();

    await process();
    await process();
    await process();
    const unfinished = await db.collection("outbox").countDocuments({
      segregationRef,
      "event.eventData.eventType": {
        $in: ["APPLICATION_CREATED", "APPLICATION_STATUS_CHANGED"],
      },
      status: { $ne: "COMPLETED" },
    });
    expect(unfinished).toBe(0);

    const [failedReceipt, ...published] = deliveredReports();
    expect(failedReceipt).toEqual(published[0]);
    const [receipt, initial, withdrawal] = published;
    const reportingEvents = [receipt, initial];
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

    expect(await application.events()).toHaveLength(2);
    expect(published).toHaveLength(3);
    expect(withdrawal.applicationStatus).toBe("APPLICATION_WITHDRAWN");
    expect(withdrawal).not.toHaveProperty("previousApplicationStatus");
  });

  it("holds a dead-lettered stream while other events proceed and releases it on purge", async () => {
    const heldCode = "reporting-dead-letter";
    const readyCode = "reporting-independent";
    await scenario(heldCode, [], { submit: true });
    await scenario(readyCode, [], { submit: true });
    const heldRef = `application-1-${heldCode}`;
    const readyRef = `application-1-${readyCode}`;
    const outbox = db.collection("outbox");
    const receiptFilter = { deliverySequence: -1 };
    const dead = await outbox.findOneAndUpdate(
      { ...receiptFilter, segregationRef: heldRef },
      { $set: { status: "DEAD_LETTER" } },
    );
    await outbox.updateOne(
      { segregationRef: heldRef, deliverySequence: 0 },
      { $set: { publicationDate: new Date(0) } },
    );
    const ready = await outbox.findOneAndUpdate(
      { ...receiptFilter, segregationRef: readyRef },
      { $set: { publicationDate: new Date(1) } },
      { returnDocument: "after" },
    );
    const excluded = await outbox.distinct("segregationRef", {
      segregationRef: { $nin: [heldRef, readyRef] },
    });
    expect((await findNextMessage(excluded))._id).toEqual(ready._id);

    const subscriber = new OutboxSubscriber();
    const deliver = vi
      .spyOn(subscriber, "deliver")
      .mockResolvedValue(undefined);
    await subscriber.processWithLock("held-test", heldRef);
    expect(deliver).toHaveBeenCalled();
    expect(
      deliver.mock.calls.every(([, event]) => event.eventData === undefined),
    ).toBe(true);
    deliver.mockClear();

    await subscriber.processWithLock("ready-test", readyRef);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(
      ready.target,
      expect.objectContaining({
        eventData: expect.objectContaining({
          eventType: "APPLICATION_CREATED",
        }),
      }),
      readyRef,
    );
    deliver.mockClear();

    expect(await purgeById(dead._id.toHexString())).toBe(true);
    await subscriber.processWithLock("purged-test", heldRef);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(
      dead.target,
      expect.objectContaining({
        eventData: expect.objectContaining({
          eventType: "APPLICATION_STATUS_CHANGED",
        }),
      }),
      heldRef,
    );
    expect(await redriveById(dead._id.toHexString())).toBe(false);
    expect(
      await editPayloadById(dead._id.toHexString(), {
        revision: 1,
        event: { id: "edited" },
      }),
    ).toBe(false);
  });

  it("releases the staged rollout backlog before a published successor", async () => {
    const code = "reporting-staged-rollout";
    const application = await scenario(
      code,
      [{ code: "APPLICATION_WITHDRAWN" }],
      { submit: true },
    );
    const { clientRef } = await application.stored();
    const segregationRef = `${clientRef}-${code}`;
    // Recreate receipt and initial status held by the previous rollout gate.
    const { modifiedCount } = await db
      .collection("outbox")
      .updateMany(
        { segregationRef, deliverySequence: { $in: [-1, 0] } },
        { $set: { status: "STAGED" } },
      );
    expect(modifiedCount).toBe(2);
    await application.move("APPLICATION_WITHDRAWN");

    const subscriber = new OutboxSubscriber();
    const deliver = vi
      .spyOn(subscriber, "deliver")
      .mockResolvedValue(undefined);
    const process = () =>
      subscriber.processWithLock("rollout-test", segregationRef);

    await process();
    expect(deliver.mock.calls.filter(([, event]) => event.eventData)).toEqual(
      [],
    );

    await subscriber.processResubmittedEvents();
    await process();
    await process();
    await process();
    expect(
      deliver.mock.calls.flatMap(([, event]) =>
        event.eventData
          ? [[event.eventData.eventType, event.eventData.applicationStatus]]
          : [],
      ),
    ).toEqual([
      ["APPLICATION_CREATED", undefined],
      ["APPLICATION_STATUS_CHANGED", initialStatus],
      ["APPLICATION_STATUS_CHANGED", "APPLICATION_WITHDRAWN"],
    ]);
    expect(
      await db.collection("outbox").countDocuments({
        segregationRef,
        deliverySequence: { $exists: true },
        status: { $ne: "COMPLETED" },
      }),
    ).toBe(0);
  });

  it("orders by publication metadata regardless of the event payload", async () => {
    const segregationRef = "metadata-only-ordering";
    const target = "test-topic";
    const { defineEventType, OUTBOX } =
      await import("../../events/event-types.js");
    const type = "test.ordered-delivery";
    defineEventType({
      name: "TestOrderedDelivery",
      sentAs: type,
      boxes: [OUTBOX],
    });
    await saveEvents([
      {
        segregationRef,
        target,
        deliverySequence: 2,
        event: { type, id: "second" },
      },
      {
        segregationRef,
        target,
        deliverySequence: 1,
        event: { type, id: "first" },
      },
      {
        segregationRef,
        target,
        event: {
          id: "unordered",
          eventData: { eventType: "APPLICATION_STATUS_CHANGED" },
        },
      },
    ]);

    const subscriber = new OutboxSubscriber();
    const deliver = vi
      .spyOn(subscriber, "deliver")
      .mockRejectedValueOnce(new Error("temporary publishing failure"))
      .mockResolvedValue(undefined);
    const process = () =>
      subscriber.processWithLock("metadata-test", segregationRef);
    const deliveredIds = () => deliver.mock.calls.map(([, event]) => event.id);

    await process();
    await process();
    expect(deliveredIds()).toEqual(["first", "unordered"]);
    await subscriber.processFailedEvents();
    await subscriber.processResubmittedEvents();
    await process();
    await process();
    expect(deliveredIds()).toEqual(["first", "unordered", "first", "second"]);
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
      events.map(({ event }) => event.eventData.applicationStatus),
    ).toEqual(["INTERNAL_REVIEW", "DECISION_MADE", "INTERNAL_REVIEW"]);
    const saved = await application.stored();
    expect(events.at(-1).event.eventData).toEqual({
      eventType: "APPLICATION_STATUS_CHANGED",
      applicationId: saved.clientRef,
      applicationType: code,
      applicationStatus: saved.currentStatus,
      statusDate: saved.updatedAt,
      userId: "operator-1",
    });
  });

  it("does not report a duplicate when another transaction commits the same status during grant resolution", async () => {
    const target = "INTERNAL_REVIEW";
    const application = await scenario(
      "reporting-concurrent-sources",
      [{ code: target }],
      {
        externalStatusMap: {
          phases: [
            {
              code: "PRE_AWARD",
              stages: [
                {
                  code: "ASSESSMENT",
                  statuses: [{ code: target, source: "CW", mappedTo: target }],
                },
              ],
            },
          ],
        },
      },
    );
    const resolving = Promise.withResolvers();
    const resume = Promise.withResolvers();
    const resolution = {
      grant: application.grant,
      resolvedVersion: "1.0.1",
    };
    const resolveGrant = vi
      .spyOn(grantResolution, "resolveGrantForApplication")
      .mockImplementationOnce(async () => {
        resolving.resolve();
        await resume.promise;
        return resolution;
      })
      .mockResolvedValue(resolution);

    const externalChange = applyExternalStateChange({
      ...application.ref,
      sourceSystem: "CW",
      externalRequestedState: target,
    });
    try {
      await resolving.promise;
      await application.move(target);
    } finally {
      resume.resolve();
      await externalChange.finally(() => resolveGrant.mockRestore());
    }

    expect(await application.events()).toHaveLength(1);
    expect(await application.stored()).toMatchObject({
      currentStatus: target,
      currentConfigVersion: resolution.resolvedVersion,
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
