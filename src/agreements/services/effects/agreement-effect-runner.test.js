import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agreementEffectHandlers,
  mergeEffectResult,
  runAgreementEffects,
} from "./agreement-effect-runner.js";
import { callAgreementEndpoint } from "./call-agreement-endpoint.js";

vi.mock("./call-agreement-endpoint.js");

describe("agreementEffectHandlers", () => {
  describe("snapshot", () => {
    it("resolves effect.params as an item-shaped patch", async () => {
      const result = await agreementEffectHandlers.snapshot(
        {
          item: { agreementItemId: "item-1" },
          outputs: { fundingCalculation: { amount: 42 } },
        },
        {
          params: {
            supplementaryData: {
              fundingCalculation: "$.outputs.fundingCalculation",
            },
          },
        },
      );

      expect(result).toEqual({
        context: {
          item: {
            agreementItemId: "item-1",
            supplementaryData: { fundingCalculation: { amount: 42 } },
          },
        },
      });
    });

    it("defaults params to an empty object", async () => {
      const result = await agreementEffectHandlers.snapshot(
        { item: { agreementItemId: "item-1" }, outputs: {} },
        {},
      );

      expect(result).toEqual({
        context: { item: { agreementItemId: "item-1" } },
      });
    });
  });

  describe("callEndpoint", () => {
    const context = {
      answers: { whitePigsCount: 5 },
      outputs: {},
      endpoints: [
        {
          code: "calculate-funding",
          method: "POST",
          path: "/grantFundingCalculator",
          service: "GRANT_FUNDING_CALCULATOR",
        },
      ],
    };

    const effect = {
      params: {
        endpoint: {
          code: "calculate-funding",
          endpointParams: {
            BODY: { quantity: "$.answers.whitePigsCount ?? 0" },
          },
        },
      },
    };

    it("finds the endpoint by code, resolves params, and returns the call's output", async () => {
      const fundingCalculation = {
        items: [{ description: "Large White", total: 320 }],
      };
      callAgreementEndpoint.mockResolvedValue(fundingCalculation);

      const result = await agreementEffectHandlers.callEndpoint(
        context,
        effect,
      );

      expect(callAgreementEndpoint).toHaveBeenCalledWith(context.endpoints[0], {
        BODY: { quantity: 5 },
      });
      expect(result).toEqual({ output: fundingCalculation });
    });

    it("throws when the endpoint code isn't in context.endpoints", async () => {
      await expect(
        agreementEffectHandlers.callEndpoint(
          { ...context, endpoints: [] },
          effect,
        ),
      ).rejects.toThrow(/No endpoint configured for code "calculate-funding"/);

      expect(callAgreementEndpoint).not.toHaveBeenCalled();
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mergeEffectResult", () => {
  it("spreads result.context fields into the returned context", () => {
    const result = mergeEffectResult(
      { existing: true, outputs: {} },
      {},
      { context: { snapshotId: "snap-1" } },
    );

    expect(result.snapshotId).toBe("snap-1");
    expect(result.existing).toBe(true);
  });

  it("stores result.output at context.outputs[effect.output] when effect.output is set", () => {
    const result = mergeEffectResult(
      { outputs: {} },
      { output: "fundingCalculation" },
      { output: { amount: 500 } },
    );

    expect(result.outputs.fundingCalculation).toEqual({ amount: 500 });
  });

  it("preserves existing outputs when adding a new named output", () => {
    const result = mergeEffectResult(
      { outputs: { existingKey: "existingValue" } },
      { output: "newKey" },
      { output: "newValue" },
    );

    expect(result.outputs.existingKey).toBe("existingValue");
    expect(result.outputs.newKey).toBe("newValue");
  });

  it("does not add any output key when effect.output is not set", () => {
    const result = mergeEffectResult(
      { outputs: {} },
      {},
      { output: "ignored" },
    );

    expect(Object.keys(result.outputs)).toHaveLength(0);
  });

  it("does not spread context when result has no context field", () => {
    const result = mergeEffectResult(
      { existing: true, outputs: {} },
      {},
      { output: "something" },
    );

    expect(result.existing).toBe(true);
    expect(Object.keys(result)).toEqual(["existing", "outputs"]);
  });

  it("defaults result to an empty object when the handler returns nothing", () => {
    const result = mergeEffectResult({ outputs: {} }, {});

    expect(result.outputs).toEqual({});
  });

  it("returns the full merged context shape", () => {
    const context = {
      agreementId: "agr-123",
      outputs: { snapshotId: "snap-1" },
    };
    const effect = { name: "callEndpoint", output: "fundingCalculation" };
    const result = {
      output: { amount: 500 },
      context: { publication: { id: "pub-1" } },
    };

    const mergedEffectResult = {
      agreementId: "agr-123",
      publication: { id: "pub-1" },
      outputs: {
        snapshotId: "snap-1",
        fundingCalculation: { amount: 500 },
      },
    };

    expect(mergeEffectResult(context, effect, result)).toEqual(
      mergedEffectResult,
    );
  });

  it("merges a plain-object context value key-by-key instead of replacing it wholesale, so sequential effects accumulate", () => {
    const afterFirst = mergeEffectResult(
      { outputs: {} },
      {},
      { context: { snapshot: { a: 1 } } },
    );

    const afterSecond = mergeEffectResult(
      afterFirst,
      {},
      { context: { snapshot: { b: 2 } } },
    );

    expect(afterSecond.snapshot).toEqual({ a: 1, b: 2 });
  });

  it("replaces a non-object context value outright rather than attempting to merge it", () => {
    const result = mergeEffectResult(
      { count: 1, outputs: {} },
      {},
      { context: { count: 2 } },
    );

    expect(result.count).toBe(2);
  });

  it("replaces an array context value instead of merging its indexes", () => {
    const result = mergeEffectResult(
      { scheduledPayments: ["old", "also-old"], outputs: {} },
      {},
      { context: { scheduledPayments: ["replacement"] } },
    );

    expect(result.scheduledPayments).toEqual(["replacement"]);
  });
});

describe("runAgreementEffects", () => {
  it("snapshots configured fields onto the item", async () => {
    const result = await runAgreementEffects(
      [
        {
          name: "snapshot",
          params: { acceptedAt: "$.executedAt" },
        },
      ],
      {
        executedAt: "2026-07-17T11:30:00.000Z",
        item: { agreementItemId: "item-1", state: "offered" },
      },
    );

    expect(result.item).toEqual({
      agreementItemId: "item-1",
      state: "offered",
      acceptedAt: "2026-07-17T11:30:00.000Z",
    });
  });

  it("snapshots configured fields into supplementary data", async () => {
    const result = await runAgreementEffects(
      [
        {
          name: "snapshot",
          params: {
            supplementaryData: {
              paymentSchedule: [{ amount: 300 }],
              assessment: { score: 8 },
              note: null,
            },
          },
        },
      ],
      {
        item: {
          agreementItemId: "item-1",
          supplementaryData: {
            paymentSchedule: [{ amount: 100 }, { amount: 200 }],
            assessment: { score: 4, reason: "original" },
            note: "clear me",
            preserved: true,
          },
        },
      },
    );

    expect(result.item.supplementaryData).toEqual({
      paymentSchedule: [{ amount: 300 }],
      assessment: { score: 8 },
      note: null,
      preserved: true,
    });
  });

  it("creates a legacy-compatible Agreement status event", async () => {
    const result = await runAgreementEffects(
      [
        {
          name: "publish",
          params: { event: "agreementStatusUpdated" },
        },
      ],
      {
        agreement: { agreementNumber: "PMF823153884" },
        item: {
          agreementCode: "pigs-might-fly",
          acceptedAt: "2026-07-17T11:29:00.000Z",
          clientRef: "xnp-rr3-nfb",
        },
        version: 2,
        target: "accepted",
        executedAt: "2026-07-17T11:30:00.000Z",
      },
    );

    expect(result.outboundEvents).toHaveLength(1);
    expect(result.outboundEvents[0]).toMatchObject({
      target:
        "arn:aws:sns:eu-west-2:000000000000:agreement_status_updated_fifo.fifo",
      event: {
        type: "io.onsite.agreement.status.updated",
        data: {
          agreementNumber: "PMF823153884",
          agreementUrl: "http://localhost:3000/agreement/PMF823153884",
          clientRef: "xnp-rr3-nfb",
          code: "pigs-might-fly",
          version: 2,
          status: "accepted",
          date: "2026-07-17T11:29:00.000Z",
        },
      },
    });
  });

  it("calls agreement effect handlers in configured order", async () => {
    const callOrder = [];
    vi.spyOn(agreementEffectHandlers, "snapshot").mockImplementation(
      async () => {
        callOrder.push("snapshot");
      },
    );
    vi.spyOn(agreementEffectHandlers, "callEndpoint").mockImplementation(
      async () => {
        callOrder.push("callEndpoint");
      },
    );

    await runAgreementEffects(
      [{ name: "snapshot" }, { name: "callEndpoint" }],
      {},
    );

    expect(callOrder).toEqual(["snapshot", "callEndpoint"]);
  });

  it("passes the context returned by each handler to the next", async () => {
    let contextReceivedBySecond;
    vi.spyOn(agreementEffectHandlers, "snapshot").mockResolvedValue({
      context: { snapshotId: "snap-1" },
    });
    vi.spyOn(agreementEffectHandlers, "callEndpoint").mockImplementation(
      async (context) => {
        contextReceivedBySecond = context;
      },
    );

    await runAgreementEffects(
      [{ name: "snapshot" }, { name: "callEndpoint" }],
      {},
    );

    expect(contextReceivedBySecond).toMatchObject({ snapshotId: "snap-1" });
  });

  it("stores handler output at context.outputs[effect.output] when effect.output is set", async () => {
    vi.spyOn(agreementEffectHandlers, "callEndpoint").mockResolvedValue({
      output: { amount: 500 },
    });

    const result = await runAgreementEffects(
      [{ name: "callEndpoint", output: "fundingCalculation" }],
      {},
    );

    expect(result.outputs.fundingCalculation).toEqual({ amount: 500 });
  });

  it("keeps existing outputs intact when adding a new named output", async () => {
    vi.spyOn(agreementEffectHandlers, "snapshot").mockResolvedValue({
      output: "snap-data",
    });
    vi.spyOn(agreementEffectHandlers, "callEndpoint").mockResolvedValue({
      output: { amount: 500 },
    });

    const result = await runAgreementEffects(
      [
        { name: "snapshot", output: "snapshotResult" },
        { name: "callEndpoint", output: "fundingCalculation" },
      ],
      {},
    );

    expect(result.outputs.snapshotResult).toBe("snap-data");
    expect(result.outputs.fundingCalculation).toEqual({ amount: 500 });
  });

  it("merges context patch without adding an output key when effect.output is not set", async () => {
    vi.spyOn(agreementEffectHandlers, "snapshot").mockResolvedValue({
      output: "snap-data",
      context: { publication: { id: "pub-1" } },
    });

    const result = await runAgreementEffects([{ name: "snapshot" }], {});

    expect(result.publication).toEqual({ id: "pub-1" });
    expect(Object.keys(result.outputs)).toHaveLength(0);
  });

  it("passes a frozen outputs object to each handler", async () => {
    let outputsSeenByHandler;
    vi.spyOn(agreementEffectHandlers, "snapshot").mockImplementation(
      async (context) => {
        outputsSeenByHandler = context.outputs;
      },
    );

    await runAgreementEffects([{ name: "snapshot" }], {});

    expect(Object.isFrozen(outputsSeenByHandler)).toBe(true);
  });

  it("throws a TypeError when a handler writes directly to context.outputs", async () => {
    vi.spyOn(agreementEffectHandlers, "snapshot").mockImplementation(
      async (context) => {
        context.outputs.injected = "malicious";
      },
    );

    await expect(
      runAgreementEffects([{ name: "snapshot" }], {}),
    ).rejects.toThrow(TypeError);
  });

  it("does not carry nested mutations to existing output values into the next effect", async () => {
    vi.spyOn(agreementEffectHandlers, "snapshot").mockResolvedValue({
      output: { count: 1 },
    });
    vi.spyOn(agreementEffectHandlers, "callEndpoint").mockImplementation(
      async (context) => {
        context.outputs.snapshotResult.count = 999;
      },
    );

    const result = await runAgreementEffects(
      [
        { name: "snapshot", output: "snapshotResult" },
        { name: "callEndpoint" },
      ],
      {},
    );

    expect(result.outputs.snapshotResult.count).toBe(1);
  });

  it("does not carry mutations to non-outputs context fields into the next effect", async () => {
    let contextReceivedBySecond;
    vi.spyOn(agreementEffectHandlers, "snapshot").mockImplementation(
      async (context) => {
        context.agreement.state = "mutated";
      },
    );
    vi.spyOn(agreementEffectHandlers, "callEndpoint").mockImplementation(
      async (context) => {
        contextReceivedBySecond = context;
      },
    );

    await runAgreementEffects(
      [{ name: "snapshot" }, { name: "callEndpoint" }],
      { agreement: { state: "original" } },
    );

    expect(contextReceivedBySecond.agreement.state).toBe("original");
  });

  it("throws an actionable error and stops execution when an effect name has no handler", async () => {
    const snapshotSpy = vi.spyOn(agreementEffectHandlers, "snapshot");

    await expect(
      runAgreementEffects(
        [{ name: "unknownEffect" }, { name: "snapshot" }],
        {},
      ),
    ).rejects.toThrow(/Unsupported agreement effect.*"unknownEffect"/);

    expect(snapshotSpy).not.toHaveBeenCalled();
  });
});
