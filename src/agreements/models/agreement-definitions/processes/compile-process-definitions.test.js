import Joi from "joi";
import { describe, expect, it, vi } from "vitest";
import {
  compileProcessDefinitions,
  findProcessHandler,
} from "./compile-process-definitions.js";

const endpointDefinition = {
  type: "endpoint",
  endpoint: { method: "POST", path: "/calculate", service: "CALCULATOR" },
  request: { body: { quantity: "$.application.quantity" } },
  output: { totalAmountPence: "$.response.totalAmountPence" },
};

const handler = (execute = vi.fn()) => ({
  inputSchema: Joi.object({ amount: Joi.number().required() }),
  execute,
});

const commitOperation = () => ({ commit: vi.fn() });

describe("findProcessHandler", () => {
  it("returns a registered own-property handler", () => {
    const registered = handler();

    expect(findProcessHandler("calculate", { calculate: registered })).toBe(
      registered,
    );
  });

  it.each(["missing", "toString", "constructor", "__proto__"])(
    'rejects unregistered handler "%s"',
    (processKey) => {
      expect(() => findProcessHandler(processKey, {})).toThrow(
        `Agreement Process handler "${processKey}" has no registered handler`,
      );
    },
  );
});

describe("compileProcessDefinitions", () => {
  it("compiles an endpoint that maps its request and typed output", async () => {
    const callEndpoint = vi.fn().mockResolvedValue({
      totalAmountPence: 32000,
      ignored: true,
    });
    const processes = compileProcessDefinitions(
      { calculate: endpointDefinition },
      { callEndpoint, handlers: {} },
    );

    await expect(
      processes.calculate({ application: { quantity: 5 } }),
    ).resolves.toEqual({
      commitOperations: [],
      output: { totalAmountPence: 32000 },
    });
    expect(callEndpoint).toHaveBeenCalledWith(
      { code: "calculate", ...endpointDefinition.endpoint },
      { BODY: { quantity: 5 } },
    );
  });

  it("compiles a handler that maps input and stages its commit operations", async () => {
    const staged = commitOperation();
    const execute = vi.fn().mockReturnValue({ commitOperations: [staged] });
    const processes = compileProcessDefinitions(
      {
        record: {
          type: "handler",
          input: { amount: "$.agreement.totalAmountPence" },
        },
      },
      { handlers: { record: handler(execute) } },
    );
    const context = {
      agreement: { totalAmountPence: 32000 },
      execution: { executionId: "execution-1" },
    };

    await expect(processes.record(context)).resolves.toEqual({
      commitOperations: [staged],
      output: {},
    });
    expect(execute).toHaveBeenCalledWith({
      agreement: context.agreement,
      execution: context.execution,
      input: { amount: 32000 },
    });
  });

  it("treats an undefined handler result as no commit operations", async () => {
    const processes = compileProcessDefinitions(
      { record: { type: "handler", input: { amount: 1 } } },
      { handlers: { record: handler() } },
    );

    await expect(
      processes.record({ agreement: {}, execution: {} }),
    ).resolves.toEqual({ commitOperations: [], output: {} });
  });

  it.each([
    [
      "invalid mappings",
      { ...endpointDefinition, request: { body: "jsonata:(" } },
      /request\.body has an invalid mapping/,
    ],
    [
      "unknown endpoint outputs",
      { ...endpointDefinition, output: { unknown: "$.response.unknown" } },
      /declares unknown output "unknown"/,
    ],
    [
      "invalid output dependencies",
      {
        ...endpointDefinition,
        request: {
          body: { value: "jsonata:$lookup($.outputs, $.execution.target)" },
        },
      },
      /has an invalid output dependency/,
    ],
  ])("rejects %s during compilation", (_name, definition, expected) => {
    expect(() =>
      compileProcessDefinitions(
        { calculate: definition },
        { callEndpoint: vi.fn(), handlers: {} },
      ),
    ).toThrow(expected);
  });

  it("redacts endpoint failures", async () => {
    const processes = compileProcessDefinitions(
      { calculate: endpointDefinition },
      {
        callEndpoint: vi.fn().mockRejectedValue(new Error("secret response")),
        handlers: {},
      },
    );

    await expect(
      processes.calculate({ application: { quantity: 5 } }),
    ).rejects.toThrow('Agreement Process "calculate" endpoint call failed');
  });

  it.each([
    ["a non-array", { commitOperations: { commit: vi.fn() } }],
    ["an operation that cannot be committed", { commitOperations: [{}] }],
    ["a result with no commit operations", { staged: [] }],
  ])("rejects handler results carrying %s", async (_label, result) => {
    const processes = compileProcessDefinitions(
      { record: { type: "handler", input: { amount: 1 } } },
      { handlers: { record: handler(() => result) } },
    );

    await expect(
      processes.record({ agreement: {}, execution: {} }),
    ).rejects.toThrow(/returned malformed commit operations/);
  });

  it("passes a staged commit operation through without cloning it", async () => {
    const staged = commitOperation();
    const processes = compileProcessDefinitions(
      { record: { type: "handler", input: { amount: 1 } } },
      { handlers: { record: handler(() => ({ commitOperations: [staged] })) } },
    );

    const { commitOperations } = await processes.record({
      agreement: {},
      execution: {},
    });

    expect(commitOperations[0]).toBe(staged);
  });
});
