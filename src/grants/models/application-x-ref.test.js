import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationXRef } from "./application-x-ref.js";

describe("ApplicationXRef", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("sets all properties from props", () => {
      const xref = new ApplicationXRef({
        _id: "abc123",
        clientRefs: ["ref-1", "ref-2"],
        currentClientId: "client-id-1",
        currentClientRef: "ref-2",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T06:00:00.000Z",
      });

      expect(xref._id).toBe("abc123");
      expect(xref.currentClientId).toBe("client-id-1");
      expect(xref.currentClientRef).toBe("ref-2");
      expect(xref.createdAt).toBe("2024-01-01T00:00:00.000Z");
      expect(xref.updatedAt).toBe("2024-01-01T06:00:00.000Z");
    });

    it("converts clientRefs array to a Set", () => {
      const xref = new ApplicationXRef({
        clientRefs: ["ref-1", "ref-2", "ref-1"],
        currentClientRef: "ref-1",
        currentClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      expect(xref.clientRefs).toBeInstanceOf(Set);
      expect(xref.clientRefs.size).toBe(2);
      expect(xref.clientRefs.has("ref-1")).toBe(true);
      expect(xref.clientRefs.has("ref-2")).toBe(true);
    });

    it("handles empty clientRefs array", () => {
      const xref = new ApplicationXRef({
        clientRefs: [],
        currentClientRef: "ref-3",
        currentClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      expect(xref.clientRefs).toBeInstanceOf(Set);
      expect(xref.clientRefs.size).toBe(0);
    });
  });

  describe("addClientRef", () => {
    it("adds a new clientRef to the set", () => {
      const xref = new ApplicationXRef({
        clientRefs: ["ref-1"],
        currentClientRef: "ref-1",
        currentClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      xref.addClientRef("ref-2", "client-id-2");

      expect(xref.clientRefs.has("ref-2")).toBe(true);
      expect(xref.currentClientRef).toBe("ref-2");
      expect(xref.clientRefs.size).toBe(2);
    });

    it("updates currentClientId", () => {
      const xref = new ApplicationXRef({
        clientRefs: ["ref-1"],
        currentClientRef: "ref-1",
        currentClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      xref.addClientRef("ref-2", "client-id-2");

      expect(xref.currentClientId).toBe("client-id-2");
    });

    it("updates updatedAt to current time", () => {
      const xref = new ApplicationXRef({
        clientRefs: ["ref-1"],
        currentClientId: "client-id-1",
        currentClientRef: "ref-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      xref.addClientRef("ref-2", "client-id-2");

      expect(xref.updatedAt).toBe("2024-01-01T12:00:00.000Z");
    });
  });

  describe("static new", () => {
    it("creates a new ApplicationXRef with timestamps set to now", () => {
      const xref = ApplicationXRef.new({
        currentClientRef: "ref-1",
        currentClientId: "client-id-1",
      });

      expect(xref).toBeInstanceOf(ApplicationXRef);
      expect(xref.createdAt).toBe("2024-01-01T12:00:00.000Z");
      expect(xref.updatedAt).toBe("2024-01-01T12:00:00.000Z");
    });

    it("sets clientRefs as a Set", () => {
      const xref = ApplicationXRef.new({
        currentClientRef: "ref-2",
        currentClientId: "client-id-1",
      });

      expect(xref.clientRefs).toBeInstanceOf(Set);
      expect(xref.clientRefs.has("ref-2")).toBe(true);
    });

    it("sets currentClientId", () => {
      const xref = ApplicationXRef.new({
        currentClientRef: "ref-1",
        currentClientId: "client-id-42",
      });

      expect(xref.currentClientId).toBe("client-id-42");
    });

    it("does not set _id", () => {
      const xref = ApplicationXRef.new({
        currentClientRef: "ref-1",
        currentClientId: "client-id-1",
      });

      expect(xref._id).toBeUndefined();
    });
  });

  describe("static fromDocument", () => {
    it("returns an ApplicationXRef instance", () => {
      const xref = ApplicationXRef.fromDocument({
        _id: "doc-id",
        clientRefs: ["ref-1"],
        currentClientRef: "ref-1",
        currentClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      expect(xref).toBeInstanceOf(ApplicationXRef);
    });

    it("maps all document properties correctly", () => {
      const xref = ApplicationXRef.fromDocument({
        _id: "doc-id",
        clientRefs: ["ref-1", "ref-2"],
        currentClientRef: "ref-2",
        currentClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T06:00:00.000Z",
      });

      expect(xref._id).toBe("doc-id");
      expect(xref.currentClientRef).toBe("ref-2");
      expect(xref.currentClientId).toBe("client-id-1");
      expect(xref.createdAt).toBe("2024-01-01T00:00:00.000Z");
      expect(xref.updatedAt).toBe("2024-01-01T06:00:00.000Z");
    });

    it("converts clientRefs array to a Set", () => {
      const xref = ApplicationXRef.fromDocument({
        _id: "doc-id",
        clientRefs: ["ref-1", "ref-2"],
        currentClientRef: "ref-1",
        currentClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      expect(xref.clientRefs).toBeInstanceOf(Set);
      expect(xref.clientRefs.has("ref-1")).toBe(true);
      expect(xref.clientRefs.has("ref-2")).toBe(true);
    });
  });

  describe("toDocument", () => {
    it("converts clientRefs Set to an Array", () => {
      const xref = new ApplicationXRef({
        _id: "doc-id",
        clientRefs: ["ref-1", "ref-2"],
        currentClientRef: "ref-2",
        currentClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      const doc = xref.toDocument();

      expect(Array.isArray(doc.clientRefs)).toBe(true);
      expect(doc.clientRefs).toEqual(
        expect.arrayContaining(["ref-1", "ref-2"]),
      );
    });

    it("returns all properties as a plain object", () => {
      const xref = new ApplicationXRef({
        _id: "doc-id",
        clientRefs: ["ref-1"],
        currentClientRef: "ref-1",
        currentClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T06:00:00.000Z",
      });

      const doc = xref.toDocument();

      expect(doc).toEqual({
        _id: "doc-id",
        clientRefs: ["ref-1"],
        currentClientRef: "ref-1",
        currentClientId: "client-id-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T06:00:00.000Z",
      });
    });

    it("includes _id even when undefined", () => {
      const xref = ApplicationXRef.new({
        currentClientRef: "ref-1",
        currentClientId: "client-id-1",
      });

      const doc = xref.toDocument();

      expect(Object.prototype.hasOwnProperty.call(doc, "_id")).toBe(true);
      expect(doc._id).toBeUndefined();
    });
  });
});
