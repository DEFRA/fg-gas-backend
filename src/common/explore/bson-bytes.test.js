import {
  BSON,
  Binary,
  Code,
  Int32,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
} from "mongodb";
import { describe, expect, it } from "vitest";
import {
  copyOf,
  elementsOf,
  isBsonDocument,
  valueKeyOf,
  valuesOf,
} from "./bson-bytes.js";

const MOST = 16 * 1024 * 1024;

const bytesOf = (doc) => Buffer.from(BSON.serialize(doc));

// A document of one element, written by hand: its type, name and value.
const oneElement = (type, value) => {
  const body = Buffer.concat([
    Buffer.from([type]),
    Buffer.from("x\0"),
    value,
    Buffer.from([0]),
  ]);
  const length = Buffer.alloc(4);

  length.writeInt32LE(body.length + 4);

  return Buffer.concat([length, body]);
};

const nested = (depth) => {
  let doc = { v: 1 };

  for (let n = 0; n < depth; n += 1) {
    doc = { a: doc };
  }

  return doc;
};

describe("isBsonDocument", () => {
  it("takes a document of every type, nested", () => {
    const doc = bytesOf({
      s: "text",
      n: new Int32(5),
      d: 1.5,
      t: new Date(0),
      o: new ObjectId(),
      b: true,
      z: null,
      bin: new Binary(Buffer.from("ab"), 4),
      ts: new Timestamp({ t: 1, i: 2 }),
      re: /a.b/im,
      min: new MinKey(),
      max: new MaxKey(),
      list: [1, [2, { x: 3 }]],
    });

    expect(isBsonDocument(doc, MOST)).toBe(true);
  });

  it.each([
    ["truncated", (doc) => doc.subarray(0, doc.length - 3)],
    [
      "a length longer than the bytes",
      (doc) => {
        const copy = Buffer.from(doc);

        copy.writeInt32LE(doc.length + 10);

        return copy;
      },
    ],
    [
      "a length shorter than the bytes",
      (doc) => {
        const copy = Buffer.from(doc);

        copy.writeInt32LE(doc.length - 1);

        return copy;
      },
    ],
    [
      "no closing nul",
      (doc) => {
        const copy = Buffer.from(doc);

        copy[copy.length - 1] = 1;

        return copy;
      },
    ],
  ])("refuses %s", (_, broken) => {
    expect(isBsonDocument(broken(bytesOf({ a: "x", b: { c: 1 } })), MOST)).toBe(
      false,
    );
  });

  it("refuses a type BSON has no such", () => {
    expect(isBsonDocument(oneElement(0x20, Buffer.alloc(0)), MOST)).toBe(false);
  });

  it("refuses a boolean that is neither 0 nor 1", () => {
    expect(isBsonDocument(oneElement(0x08, Buffer.from([1])), MOST)).toBe(true);
    expect(isBsonDocument(oneElement(0x08, Buffer.from([2])), MOST)).toBe(
      false,
    );
  });

  it("refuses a string without its closing nul", () => {
    const value = Buffer.alloc(6);

    value.writeInt32LE(2);
    value.write("ab", 4);

    expect(isBsonDocument(oneElement(0x02, value), MOST)).toBe(false);
  });

  it("refuses a document nested deeper than mongod nests one", () => {
    expect(isBsonDocument(bytesOf(nested(150)), MOST)).toBe(true);
    expect(isBsonDocument(bytesOf(nested(250)), MOST)).toBe(false);
  });

  it("refuses more bytes than allowed, and anything but a buffer", () => {
    const doc = bytesOf({ a: "x".repeat(100) });

    expect(isBsonDocument(doc, doc.length)).toBe(true);
    expect(isBsonDocument(doc, doc.length - 1)).toBe(false);
    expect(isBsonDocument("not bytes", MOST)).toBe(false);
  });
});

describe("elementsOf, copyOf and valueKeyOf", () => {
  it("reads each element's type, name and value bytes", () => {
    const doc = bytesOf({ a: new Int32(7), b: "hi" });
    const [a, b] = elementsOf(doc);

    expect([a.type, a.name, b.type, b.name]).toEqual([0x10, "a", 0x02, "b"]);
    expect(doc.readInt32LE(a.start)).toBe(7);
    expect(b.end - b.start).toBe(4 + 3);
  });

  it("copies a value out of its buffer", () => {
    const doc = bytesOf({ d: { x: 1 } });
    const [element] = elementsOf(doc);
    const copy = copyOf(doc, element);

    doc.fill(0);

    expect(BSON.deserialize(copy)).toEqual({ x: 1 });
  });

  it("keys two values alike only when their type and bytes are", () => {
    const keyOf = (doc) => {
      const buf = bytesOf(doc);

      return valueKeyOf(buf, elementsOf(buf)[0]);
    };
    const id = new ObjectId();

    expect(keyOf({ _id: id })).toBe(keyOf({ other: id }));
    expect(keyOf({ _id: id })).not.toBe(keyOf({ _id: id.toHexString() }));
    expect(keyOf({ _id: new Int32(5) })).not.toBe(keyOf({ _id: 5.5 }));
  });
});

describe("code with scope", () => {
  const withScope = bytesOf({ c: new Code("x", { a: 1, b: [1, 2] }) });
  const scopeAt = withScope.indexOf(Buffer.from([0x0f])) + 3 + 4;

  it("reads code with its scope", () => {
    expect(isBsonDocument(withScope, MOST)).toBe(true);
  });

  it("refuses one shorter than a real one can be", () => {
    const short = Buffer.from(withScope);

    short.writeInt32LE(5, scopeAt - 4);

    expect(isBsonDocument(short, MOST)).toBe(false);
  });

  it("refuses one whose scope isn't a document that ends where it does", () => {
    const bad = Buffer.from(withScope);
    const codeLength = bad.readInt32LE(scopeAt);

    bad[scopeAt + 4 + codeLength + 4] = 0x7a;

    expect(isBsonDocument(bad, MOST)).toBe(false);
  });
});

describe("valuesOf", () => {
  it("counts every element at every depth, a document or list beside what it holds", () => {
    expect(valuesOf(bytesOf({}))).toBe(0);
    expect(valuesOf(bytesOf({ a: 1, b: "x" }))).toBe(2);
    expect(valuesOf(bytesOf({ a: { b: [1, 2, { c: null }] } }))).toBe(6);
    expect(valuesOf(bytesOf({ c: new Code("x", { a: 1, b: 2 }) }))).toBe(3);
  });
});
