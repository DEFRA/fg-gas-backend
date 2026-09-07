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
  commitOperationsSchema: Joi.object({
    commitOperations: Joi.array().items(Joi.object()).required(),
  }),
  execute,
});

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

  it("compiles a handler that maps input and returns validated commit operations", async () => {
    const execute = vi.fn().mockReturnValue({
      commitOperations: [{ type: "record" }],
    });
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
      commitOperations: [{ type: "record" }],
      output: {},
    });
    expect(execute).toHaveBeenCalledWith({
      agreement: context.agreement,
      execution: context.execution,
      input: { amount: 32000 },
    });
  });

  it("defaults omitted handler input to an empty object", async () => {
    const execute = vi.fn();
    const processes = compileProcessDefinitions(
      { record: { type: "handler" } },
      { handlers: { record: { inputSchema: Joi.object({}), execute } } },
    );
    const context = { agreement: {}, execution: {} };

    await expect(processes.record(context)).resolves.toEqual({
      commitOperations: [],
      output: {},
    });
    expect(execute).toHaveBeenCalledWith({ ...context, input: {} });
  });

  it("rejects omitted handler input when the schema requires fields", async () => {
    const processes = compileProcessDefinitions(
      { record: { type: "handler" } },
      { handlers: { record: handler() } },
    );

    await expect(
      processes.record({ agreement: {}, execution: {} }),
    ).rejects.toThrow(/Agreement Process "record" input failed validation/);
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

  it("rejects unsupported handler results", async () => {
    const registered = handler(() => ({ commitOperations: [] }));
    delete registered.commitOperationsSchema;
    const processes = compileProcessDefinitions(
      { record: { type: "handler", input: { amount: 1 } } },
      { handlers: { record: registered } },
    );

    await expect(
      processes.record({ agreement: {}, execution: {} }),
    ).rejects.toThrow(/returned unsupported commit operations/);
  });
});
