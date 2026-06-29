import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handlers,
  mergeEffectResult,
  runAgreementEffects,
} from "./agreement-effect-runner.js";

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
    const effect = { name: "createPaymentClaim", output: "paymentClaim" };
    const result = {
      output: { amount: 500 },
      context: { publication: { id: "pub-1" } },
    };

    const mergedEffectResult = {
      agreementId: "agr-123",
      publication: { id: "pub-1" },
      outputs: {
        snapshotId: "snap-1",
        paymentClaim: { amount: 500 },
      },
    };

    expect(mergeEffectResult(context, effect, result)).toEqual(
      mergedEffectResult,
    );
  });
});

describe("runAgreementEffects", () => {
  it("calls handlers in the same order as the configured effects", async () => {
    const callOrder = [];
    vi.spyOn(handlers, "snapshot").mockImplementation(async () => {
      callOrder.push("snapshot");
    });
    vi.spyOn(handlers, "callEndpoint").mockImplementation(async () => {
      callOrder.push("callEndpoint");
    });

    await runAgreementEffects(
      [{ name: "snapshot" }, { name: "callEndpoint" }],
      {},
    );

    expect(callOrder).toEqual(["snapshot", "callEndpoint"]);
  });

  it("passes the context returned by each handler to the next", async () => {
    let contextReceivedBySecond;
    vi.spyOn(handlers, "snapshot").mockResolvedValue({
      context: { snapshotId: "snap-1" },
    });
    vi.spyOn(handlers, "callEndpoint").mockImplementation(async (context) => {
      contextReceivedBySecond = context;
    });

    await runAgreementEffects(
      [{ name: "snapshot" }, { name: "callEndpoint" }],
      {},
    );

    expect(contextReceivedBySecond).toMatchObject({ snapshotId: "snap-1" });
  });

  it("stores handler output at context.outputs[effect.output] when effect.output is set", async () => {
    vi.spyOn(handlers, "createPaymentClaim").mockResolvedValue({
      output: { amount: 500 },
    });

    const result = await runAgreementEffects(
      [{ name: "createPaymentClaim", output: "fundingCalculation" }],
      {},
    );

    expect(result.outputs.fundingCalculation).toEqual({ amount: 500 });
  });

  it("keeps existing outputs intact when adding a new named output", async () => {
    vi.spyOn(handlers, "snapshot").mockResolvedValue({ output: "snap-data" });
    vi.spyOn(handlers, "createPaymentClaim").mockResolvedValue({
      output: { amount: 500 },
    });

    const result = await runAgreementEffects(
      [
        { name: "snapshot", output: "snapshotResult" },
        { name: "createPaymentClaim", output: "fundingCalculation" },
      ],
      {},
    );

    expect(result.outputs.snapshotResult).toBe("snap-data");
    expect(result.outputs.fundingCalculation).toEqual({ amount: 500 });
  });

  it("merges context patch without adding an output key when effect.output is not set", async () => {
    vi.spyOn(handlers, "snapshot").mockResolvedValue({
      output: "snap-data",
      context: { publication: { id: "pub-1" } },
    });

    const result = await runAgreementEffects([{ name: "snapshot" }], {});

    expect(result.publication).toEqual({ id: "pub-1" });
    expect(Object.keys(result.outputs)).toHaveLength(0);
  });

  it("throws an actionable error and stops execution when an effect name has no handler", async () => {
    const snapshotSpy = vi.spyOn(handlers, "snapshot");

    await expect(
      runAgreementEffects(
        [{ name: "unknownEffect" }, { name: "snapshot" }],
        {},
      ),
    ).rejects.toThrow(/Unsupported agreement effect.*"unknownEffect"/);

    expect(snapshotSpy).not.toHaveBeenCalled();
  });
});
