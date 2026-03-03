import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationSeries } from "./application-series.js";

describe("ApplicationSeries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("throws a bad request error when props are invalid", () => {
      expect(() => new ApplicationSeries({})).toThrow(
        "Invalid ApplicationSeries:",
      );
    });

    it("sets all properties from props", () => {
      const series = new ApplicationSeries({
        _id: "abc123",
        clientRefs: ["ref-1", "ref-2"],
        code: "test-code",
        latestClientId: "client-id-1",
        latestClientRef: "ref-2",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T06:00:00.000Z",
      });

      expect(series._id).toBe("abc123");
      expect(series.latestClientId).toBe("client-id-1");
      expect(series.latestClientRef).toBe("ref-2");
      expect(series.createdAt).toBe("2024-01-01T00:00:00.000Z");
      expect(series.updatedAt).toBe("2024-01-01T06:00:00.000Z");
    });

    it("converts clientRefs array to a Set", () => {
      const series = new ApplicationSeries({
        clientRefs: ["ref-1", "ref-2", "ref-1"],
        latestClientRef: "ref-1",
        code: "test-code",
        latestClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      expect(series.clientRefs).toBeInstanceOf(Set);
      expect(series.clientRefs.size).toBe(2);
      expect(series.clientRefs.has("ref-1")).toBe(true);
      expect(series.clientRefs.has("ref-2")).toBe(true);
    });

    it("handles empty clientRefs array", () => {
      const series = new ApplicationSeries({
        clientRefs: [],
        code: "test-code",
        latestClientRef: "ref-3",
        latestClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      expect(series.clientRefs).toBeInstanceOf(Set);
      expect(series.clientRefs.size).toBe(0);
    });
  });

  describe("addClientRef", () => {
    it("adds a new clientRef to the set", () => {
      const series = new ApplicationSeries({
        clientRefs: ["ref-1"],
        code: "test-code",
        latestClientRef: "ref-1",
        latestClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      series.addClientRef("ref-2", "client-id-2");

      expect(series.clientRefs.has("ref-2")).toBe(true);
      expect(series.latestClientRef).toBe("ref-2");
      expect(series.clientRefs.size).toBe(2);
    });

    it("updates latestClientId", () => {
      const series = new ApplicationSeries({
        clientRefs: ["ref-1"],
        code: "test-code",
        latestClientRef: "ref-1",
        latestClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      series.addClientRef("ref-2", "client-id-2");

      expect(series.latestClientId).toBe("client-id-2");
    });

    it("throws when clientRef is missing", () => {
      const series = new ApplicationSeries({
        clientRefs: ["ref-1"],
        code: "test-code",
        latestClientRef: "ref-1",
        latestClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      expect(() => series.addClientRef(null, "client-id-2")).toThrow(
        "ApplicationSeries can not be updated, clientRef is missing.",
      );
    });

    it("throws when clientId is missing", () => {
      const series = new ApplicationSeries({
        clientRefs: ["ref-1"],
        code: "test-code",
        latestClientRef: "ref-1",
        latestClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      expect(() => series.addClientRef("ref-2", null)).toThrow(
        "ApplicationSeries can not be updated, clientId is missing.",
      );
    });

    it("updates updatedAt to current time", () => {
      const series = new ApplicationSeries({
        clientRefs: ["ref-1"],
        code: "test-code",
        latestClientId: "client-id-1",
        latestClientRef: "ref-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      series.addClientRef("ref-2", "client-id-2");

      expect(series.updatedAt).toBe("2024-01-01T12:00:00.000Z");
    });
  });

  describe("static new", () => {
    it("creates a new ApplicationSeries with timestamps set to now", () => {
      const series = ApplicationSeries.new({
        code: "test-code",
        latestClientRef: "ref-1",
        latestClientId: "client-id-1",
      });

      expect(series).toBeInstanceOf(ApplicationSeries);
      expect(series.createdAt).toBe("2024-01-01T12:00:00.000Z");
      expect(series.updatedAt).toBe("2024-01-01T12:00:00.000Z");
    });

    it("sets clientRefs as a Set", () => {
      const series = ApplicationSeries.new({
        code: "test-code",
        latestClientRef: "ref-2",
        latestClientId: "client-id-1",
      });

      expect(series.clientRefs).toBeInstanceOf(Set);
      expect(series.clientRefs.has("ref-2")).toBe(true);
    });

    it("sets latestClientId", () => {
      const series = ApplicationSeries.new({
        code: "test-code",
        latestClientRef: "ref-1",
        latestClientId: "client-id-42",
      });

      expect(series.latestClientId).toBe("client-id-42");
    });

    it("does not set _id", () => {
      const series = ApplicationSeries.new({
        code: "test-code",
        latestClientRef: "ref-1",
        latestClientId: "client-id-1",
      });

      expect(series._id).toBeUndefined();
    });
  });

  describe("static fromDocument", () => {
    it("returns an ApplicationSeries instance", () => {
      const series = ApplicationSeries.fromDocument({
        _id: "doc-id",
        clientRefs: ["ref-1"],
        latestClientRef: "ref-1",
        code: "test-code",
        latestClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      expect(series).toBeInstanceOf(ApplicationSeries);
    });

    it("maps all document properties correctly", () => {
      const series = ApplicationSeries.fromDocument({
        _id: "doc-id",
        clientRefs: ["ref-1", "ref-2"],
        code: "test-code",
        latestClientRef: "ref-2",
        latestClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T06:00:00.000Z",
      });

      expect(series._id).toBe("doc-id");
      expect(series.latestClientRef).toBe("ref-2");
      expect(series.latestClientId).toBe("client-id-1");
      expect(series.createdAt).toBe("2024-01-01T00:00:00.000Z");
      expect(series.updatedAt).toBe("2024-01-01T06:00:00.000Z");
    });

    it("converts clientRefs array to a Set", () => {
      const series = ApplicationSeries.fromDocument({
        _id: "doc-id",
        clientRefs: ["ref-1", "ref-2"],
        code: "test-code",
        latestClientRef: "ref-1",
        latestClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      expect(series.clientRefs).toBeInstanceOf(Set);
      expect(series.clientRefs.has("ref-1")).toBe(true);
      expect(series.clientRefs.has("ref-2")).toBe(true);
    });
  });

  describe("toDocument", () => {
    it("converts clientRefs Set to an Array", () => {
      const series = new ApplicationSeries({
        _id: "doc-id",
        clientRefs: ["ref-1", "ref-2"],
        code: "test-code",
        latestClientRef: "ref-2",
        latestClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      const doc = series.toDocument();

      expect(Array.isArray(doc.clientRefs)).toBe(true);
      expect(doc.clientRefs).toEqual(
        expect.arrayContaining(["ref-1", "ref-2"]),
      );
    });

    it("returns all properties as a plain object", () => {
      const series = new ApplicationSeries({
        _id: "doc-id",
        clientRefs: ["ref-1"],
        code: "test-code",
        latestClientRef: "ref-1",
        latestClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T06:00:00.000Z",
      });

      const doc = series.toDocument();

      expect(doc).toEqual({
        _id: "doc-id",
        clientRefs: ["ref-1"],
        code: "test-code",
        latestClientRef: "ref-1",
        latestClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T06:00:00.000Z",
      });
    });

    it("includes _id even when undefined", () => {
      const series = ApplicationSeries.new({
        code: "test-code",
        latestClientRef: "ref-1",
        latestClientId: "client-id-1",
      });

      const doc = series.toDocument();

      expect(Object.prototype.hasOwnProperty.call(doc, "_id")).toBe(true);
      expect(doc._id).toBeUndefined();
    });
  });
});
