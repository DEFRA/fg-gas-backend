import { describe, expect, it } from "vitest";
import {
  actorName,
  attemptsLabel,
  duration,
  hopLabel,
  latency,
  latencyTitle,
  serviceVocabulary,
  statusDisplay,
  statusVocabulary,
} from "./event-display.js";

describe("statusDisplay", () => {
  it("spells PUBLISHED as a quiet, settled state", () => {
    expect(statusDisplay("PUBLISHED")).toEqual({
      statusLabel: "Queued",
      statusRole: "neutral",
      statusRetrying: false,
    });
  });

  it("spells PROCESSING as in flight", () => {
    expect(statusDisplay("PROCESSING")).toEqual({
      statusLabel: "Processing",
      statusRole: "info",
      statusRetrying: false,
    });
  });

  it("spells FAILED as retrying", () => {
    expect(statusDisplay("FAILED")).toEqual({
      statusLabel: "Failed",
      statusRole: "warning",
      statusRetrying: true,
    });
  });

  it("spells RESUBMITTED as retrying too", () => {
    expect(statusDisplay("RESUBMITTED")).toEqual({
      statusLabel: "Resubmitted",
      statusRole: "warning",
      statusRetrying: true,
    });
  });

  it("spells COMPLETED as a success", () => {
    expect(statusDisplay("COMPLETED")).toEqual({
      statusLabel: "Completed",
      statusRole: "success",
      statusRetrying: false,
    });
  });

  it("spells DEAD_LETTER in two words and stops retrying", () => {
    expect(statusDisplay("DEAD_LETTER")).toEqual({
      statusLabel: "Dead letter",
      statusRole: "error",
      statusRetrying: false,
    });
  });

  it("spells PURGED neutrally, and never as an error", () => {
    expect(statusDisplay("PURGED")).toEqual({
      statusLabel: "Purged",
      statusRole: "neutral",
      statusRetrying: false,
    });
  });

  it("keeps a status nobody has seen in its own spelling, with a neutral badge", () => {
    expect(statusDisplay("QUARANTINED")).toEqual({
      statusLabel: "QUARANTINED",
      statusRole: "neutral",
      statusRetrying: false,
    });
  });
});

describe("statusVocabulary", () => {
  it("lists the seven states in the order a message travels them", () => {
    expect(statusVocabulary().map(({ value }) => value)).toEqual([
      "PUBLISHED",
      "PROCESSING",
      "FAILED",
      "RESUBMITTED",
      "COMPLETED",
      "DEAD_LETTER",
      "PURGED",
    ]);
  });

  it("spells each chip the way the badge beside it is spelled", () => {
    const labels = Object.fromEntries(
      statusVocabulary().map(({ value, label }) => [value, label]),
    );

    for (const [value, label] of Object.entries(labels)) {
      expect(statusDisplay(value).statusLabel).toBe(label);
    }
  });

  it("explains every state in a line", () => {
    for (const { explainer } of statusVocabulary()) {
      expect(explainer).toEqual(expect.any(String));
      expect(explainer).not.toBe("");
    }

    expect(
      statusVocabulary().find(({ value }) => value === "DEAD_LETTER").explainer,
    ).toBe("Failed all retry attempts; needs a redrive");
  });
});

describe("serviceVocabulary", () => {
  it("names both services in full, not in the codes the topics use", () => {
    expect(serviceVocabulary()).toEqual([
      { value: "gas", label: "GAS" },
      { value: "caseworking", label: "CW-BE" },
    ]);
  });
});

describe("actorName", () => {
  it("keeps a named operator verbatim", () => {
    expect(actorName("Ada Lovelace")).toBe("Ada Lovelace");
  });

  it.each([[null], [undefined], [""], ["   "]])(
    "names %p as the platform itself",
    (by) => {
      expect(actorName(by)).toBe("System");
    },
  );

  it("does not mistake an operator whose name contains spaces", () => {
    expect(actorName(" Ada ")).toBe(" Ada ");
  });
});

describe("hopLabel", () => {
  it.each([
    [{ service: "gas", box: "inbox" }, "GAS Inbox"],
    [{ service: "gas", box: "outbox" }, "GAS Outbox"],
    [{ service: "caseworking", box: "inbox" }, "CW-BE Inbox"],
    [{ service: "caseworking", box: "outbox" }, "CW-BE Outbox"],
  ])("names %o as %s", (hop, label) => {
    expect(hopLabel(hop)).toBe(label);
  });

  it("falls back to the raw service and box it was given", () => {
    expect(hopLabel({ service: "payments", box: "deadletter" })).toBe(
      "payments deadletter",
    );
  });
});

describe("duration", () => {
  it("reports under a second in whole milliseconds", () => {
    expect(duration(0)).toBe("0ms");
    expect(duration(940)).toBe("940ms");
    expect(duration(999)).toBe("999ms");
  });

  it("reports seconds to a tenth", () => {
    expect(duration(1000)).toBe("1.0s");
    expect(duration(1250)).toBe("1.3s");
    expect(duration(59_000)).toBe("59.0s");
  });

  it("carries 59.97 seconds up into a minute", () => {
    expect(duration(59_970)).toBe("1m 0s");
  });

  it("reports minutes and seconds past a minute", () => {
    expect(duration(60_000)).toBe("1m 0s");
    expect(duration(90_000)).toBe("1m 30s");
  });

  it("reports hours and minutes past an hour", () => {
    expect(duration(3_600_000)).toBe("1h 0m");
    expect(duration(20_040_000)).toBe("5h 34m");
  });
});

describe("latency", () => {
  it("measures the gap between two instants", () => {
    expect(
      latency("2026-06-16T10:00:00.000Z", "2026-06-16T10:00:01.500Z"),
    ).toBe("1.5s");
  });

  it("is null where either instant is missing", () => {
    expect(latency(null, "2026-06-16T10:00:01.500Z")).toBeNull();
    expect(latency("2026-06-16T10:00:00.000Z", null)).toBeNull();
    expect(latency("2026-06-16T10:00:00.000Z", undefined)).toBeNull();
  });

  it("is null where either instant cannot be read", () => {
    expect(latency("not a date", "2026-06-16T10:00:01.500Z")).toBeNull();
    expect(latency("2026-06-16T10:00:00.000Z", "not a date")).toBeNull();
  });

  it("floors a completion recorded before its start at zero", () => {
    expect(
      latency("2026-06-16T10:00:01.000Z", "2026-06-16T10:00:00.000Z"),
    ).toBe("0ms");
  });
});

describe("latencyTitle", () => {
  it("says what the two ends of the figure are, per box", () => {
    expect(latencyTitle("inbox")).toBe("Received to completed");
    expect(latencyTitle("outbox")).toBe("Queued to delivered to SNS");
  });
});

describe("attemptsLabel", () => {
  it("reads as attempts made over attempts allowed", () => {
    expect(attemptsLabel(5, 5)).toBe("5/5");
  });

  it("states a zero count rather than hiding it", () => {
    expect(attemptsLabel(0, 5)).toBe("0/5");
  });

  it("is a dash where nothing recorded a count", () => {
    expect(attemptsLabel(null, 5)).toBe("-");
    expect(attemptsLabel(undefined, 5)).toBe("-");
  });

  it("still states the count where nothing recorded a ceiling", () => {
    expect(attemptsLabel(3, null)).toBe("3/?");
  });
});
