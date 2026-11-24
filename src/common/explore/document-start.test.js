import {
  BSON,
  BSONRegExp,
  Binary,
  Code,
  Decimal128,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
} from "mongodb";
import { describe, expect, it } from "vitest";
import { elementBytesAt, isBsonDocument } from "./bson-bytes.js";
import { START_BYTES, START_PRINTED, startOf } from "./document-start.js";

const bytesOf = (doc) => Buffer.from(BSON.serialize(doc));

// ── BSON written by hand, for bytes the driver won't write ──

const int32 = (n) => {
  const buf = Buffer.alloc(4);

  buf.writeInt32LE(n);

  return buf;
};

const NUL = Buffer.alloc(1);

const documentOf = (elements) => {
  const body = Buffer.concat(
    elements.map(([type, key, value]) =>
      Buffer.concat([Buffer.of(type), Buffer.from(key), NUL, value]),
    ),
  );

  return Buffer.concat([int32(body.length + 5), body, NUL]);
};

const stringValue = (bytes) =>
  Buffer.concat([int32(bytes.length + 1), Buffer.from(bytes), NUL]);

// ── What a start must be ──

const elementsIn = (buf, at) => {
  const last = at + buf.readInt32LE(at) - 1;
  const elements = [];

  for (let next = at + 4; next < last; next = elements.at(-1).end) {
    elements.push(elementBytesAt(buf, next, last));
  }

  return elements;
};

const keyBytes = (buf, element) =>
  buf.subarray(element.nameStart, element.start - 1);

const isPrefix = (a, b) => b.subarray(0, a.length).equals(a);

const textBytes = (buf, at) =>
  buf.subarray(at + 4, at + 4 + buf.readInt32LE(at) - 1);

const cstrings = (buf, at) => {
  const first = buf.indexOf(0, at);

  return [
    buf.subarray(at, first),
    buf.subarray(first + 1, buf.indexOf(0, first + 1)),
  ];
};

const binaryPrinted = (buf, at) => {
  const length = buf.readInt32LE(at);
  const skip = buf[at + 4] === 2 && length >= 4 ? 4 : 0;

  return buf.subarray(at + 5 + skip, at + 5 + length);
};

// Whether the start's value at `s` is a cut of the stored one at `r`: each
// byte it keeps is the stored one.
const valueIsCutOf = (start, s, record, r) => {
  const PREFIXES = {
    0x02: () => isPrefix(textBytes(start, s.start), textBytes(record, r.start)),
    0x0d: () => isPrefix(textBytes(start, s.start), textBytes(record, r.start)),
    0x0e: () => isPrefix(textBytes(start, s.start), textBytes(record, r.start)),
    0x05: () =>
      start[s.start + 4] === record[r.start + 4] &&
      isPrefix(binaryPrinted(start, s.start), binaryPrinted(record, r.start)),
    0x0b: () => {
      const [sp, sf] = cstrings(start, s.start);
      const [rp, rf] = cstrings(record, r.start);

      return (
        isPrefix(sp, rp) &&
        isPrefix(sf, rf) &&
        (sf.length === 0 || sp.equals(rp))
      );
    },
    0x03: () => isCutOf(start, s.start, record, r.start),
    0x04: () => isCutOf(start, s.start, record, r.start, true),
    0x0f: () => true,
  };

  return (
    s.type === r.type &&
    (PREFIXES[s.type]?.() ??
      start.subarray(s.start, s.end).equals(record.subarray(r.start, r.end)))
  );
};

// A list key past what a start holds of them is kept to its first 8 bytes.
const isKeptKey = (start, element, record, whole, list) =>
  keyBytes(start, element).equals(keyBytes(record, whole)) ||
  (list &&
    keyBytes(start, element).length === 8 &&
    isPrefix(keyBytes(start, element), keyBytes(record, whole)));

const CONTAINERS = { 0x03: false, 0x04: true };

// Whether the start's element at `s` is the stored one at `r` whole, but
// for list keys kept short.
const isWholeOf = (start, s, record, r, list) => {
  if (s.type !== r.type || !isKeptKey(start, s, record, r, list)) {
    return false;
  }

  if (!Object.hasOwn(CONTAINERS, s.type)) {
    return start
      .subarray(s.start, s.end)
      .equals(record.subarray(r.start, r.end));
  }

  return isEachWholeOf(start, s.start, record, r.start, CONTAINERS[s.type]);
};

const isEachWholeOf = (start, at, record, recordAt, list = false) => {
  const kept = elementsIn(start, at);
  const stored = elementsIn(record, recordAt);

  return (
    kept.length === stored.length &&
    kept.every((element, n) =>
      isWholeOf(start, element, record, stored[n], list),
    )
  );
};

const isCutOf = (start, at, record, recordAt, list = false) => {
  const kept = elementsIn(start, at);
  const stored = elementsIn(record, recordAt);

  return kept.every((element, n) => {
    const whole = stored[n];

    if (n < kept.length - 1) {
      return isWholeOf(start, element, record, whole, list);
    }

    if (isKeptKey(start, element, record, whole, list)) {
      return valueIsCutOf(start, element, record, whole);
    }

    return (
      isPrefix(keyBytes(start, element), keyBytes(record, whole)) &&
      element.type === whole.type
    );
  });
};

const checkStart = (record) => {
  const start = startOf(record);

  expect(isBsonDocument(start.doc, START_BYTES)).toBe(true);
  expect(start.doc.length).toBeLessThanOrEqual(START_BYTES);
  expect(isCutOf(start.doc, 0, record, 0)).toBe(true);

  if (!start.cut) {
    expect(isEachWholeOf(start.doc, 0, record, 0)).toBe(true);
  }

  return start;
};

// ── Generated documents ──

const randomOf = (seed) => {
  let state = seed;

  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;

    return state / 2_147_483_648;
  };
};

const TEXTS = ["a", "é", "€", "𝄞", "'", "\\", "\n", " ", "z"];

const textOf = (random, most) =>
  Array.from(
    { length: Math.floor(random() * most) },
    () => TEXTS[Math.floor(random() * TEXTS.length)],
  ).join("");

const valueOf = (random, depth) => {
  const kinds = [
    () => textOf(random, 400),
    () => new Int32(Math.floor(random() * 100)),
    () => Long.fromNumber(Math.floor(random() * 1e12)),
    () => random() * 1000,
    () => Decimal128.fromString("1.5"),
    () => new ObjectId(),
    () => new Date(Math.floor(random() * 1e12)),
    () => random() > 0.5,
    () => null,
    () => new Timestamp({ t: 1, i: 2 }),
    () => new MinKey(),
    () => new MaxKey(),
    () =>
      new Binary(
        Buffer.alloc(Math.floor(random() * 300), 9),
        [0, 2, 4, 5][Math.floor(random() * 4)],
      ),
    () => new BSONRegExp(textOf(random, 200), "imsux"),
    () => new Code(textOf(random, 100)),
    () => new Code(textOf(random, 30), { s: textOf(random, 300) }),
    () => new BSON.BSONSymbol(textOf(random, 300)),
    () =>
      depth < 4
        ? Array.from({ length: Math.floor(random() * 60) }, () =>
            valueOf(random, depth + 1),
          )
        : 1,
    () => (depth < 4 ? documentFrom(random, depth + 1) : 2),
  ];

  return kinds[Math.floor(random() * kinds.length)]();
};

const documentFrom = (random, depth = 0) =>
  Object.fromEntries(
    Array.from({ length: 1 + Math.floor(random() * 12) }, (_, n) => [
      `${textOf(random, 8) || "k"}${n}`,
      valueOf(random, depth),
    ]),
  );

describe("startOf", () => {
  it("keeps a short record whole, as its own bytes copied", () => {
    const record = bytesOf({ _id: new ObjectId(), a: 1, b: "two" });
    const start = checkStart(record);

    expect(start).toEqual({ doc: record, cut: false });
    expect(start.doc).not.toBe(record);
  });

  it("cuts generated documents of every type into valid starts of their stored bytes", () => {
    const random = randomOf(7);

    for (let n = 0; n < 600; n += 1) {
      checkStart(bytesOf(documentFrom(random)));
    }
  });

  it("cuts a long text between code points, never inside one", () => {
    const record = bytesOf({ s: "𝄞é".repeat(500) });
    const start = checkStart(record);
    const kept = BSON.deserialize(start.doc).s;

    expect(start.cut).toBe(true);
    expect("𝄞é".repeat(500).startsWith(kept)).toBe(true);
    expect([...kept].length).toBe(START_PRINTED - 2 - 2 - 1 - 2);
  });

  it("counts a long list of short items without their keys", () => {
    const start = checkStart(
      bytesOf({ l: Array.from({ length: 1000 }, (_, n) => n) }),
    );
    const kept = BSON.deserialize(start.doc).l;

    expect(start.cut).toBe(true);
    expect(kept).toEqual(Array.from({ length: kept.length }, (_, n) => n));
    expect(kept.length).toBeGreaterThan(60);
  });

  it("cuts nested lists and objects at the bound, keeping what came before", () => {
    const record = bytesOf({
      a: { b: [1, 2, { c: "x".repeat(500) }], d: 1 },
      e: 2,
    });
    const start = checkStart(record);
    const { a, e } = BSON.deserialize(start.doc);

    expect(start.cut).toBe(true);
    expect(e).toBeUndefined();
    expect(a.d).toBeUndefined();
    expect(a.b.slice(0, 2)).toEqual([1, 2]);
  });

  it("keeps duplicate keys as stored", () => {
    const record = documentOf([
      [0x10, "a", int32(1)],
      [0x10, "a", int32(2)],
      [0x02, "a", stringValue("y".repeat(400))],
    ]);
    const start = checkStart(record);

    expect(start.cut).toBe(true);
    expect(start.doc.subarray(0, 4 + 14).subarray(4)).toEqual(
      record.subarray(4, 4 + 14),
    );
  });

  it("keeps list keys as stored, counting none of them", () => {
    const record = documentOf([
      [
        0x04,
        "l",
        documentOf(
          Array.from({ length: 300 }, (_, n) => [
            0x10,
            n === 0 ? "k".repeat(1500) : `x${n}`,
            int32(n),
          ]),
        ),
      ],
    ]);
    const start = checkStart(record);

    expect(start.cut).toBe(true);
    expect(start.doc.includes(Buffer.from("k".repeat(1500)))).toBe(true);
  });

  describe("text that isn't valid UTF-8", () => {
    const invalid = (bytes) =>
      documentOf([[0x02, "s", stringValue(Buffer.from(bytes))]]);

    it("counts each lone continuation byte as one, keeping them as stored", () => {
      const record = invalid(Array(400).fill(0x80));
      const start = checkStart(record);

      expect(start.cut).toBe(true);
      expect(textBytes(start.doc, 4 + 3).length).toBe(
        START_PRINTED - 2 - 3 - 2,
      );
    });

    it("counts a truncated sequence as one, and never splits it", () => {
      const run = [];

      for (let n = 0; n < 150; n += 1) {
        run.push(0xe2, 0x82);
      }

      const record = invalid(run);
      const start = checkStart(record);

      expect(textBytes(start.doc, 4 + 3).length % 2).toBe(0);
    });

    it("cuts a key that isn't valid UTF-8 between the decoder's outputs", () => {
      const record = documentOf([
        [0x10, Buffer.from(Array(500).fill(0xff)), int32(1)],
      ]);

      checkStart(record);
    });
  });

  describe("Binary", () => {
    it.each([0, 2, 4, 5, 0x80])(
      "cuts a long Binary of subtype %i to a whole number of 3 bytes",
      (subtype) => {
        const payload = Buffer.from(
          Array.from({ length: 3000 }, (_, n) => n % 256),
        );
        const start = checkStart(bytesOf({ b: new Binary(payload, subtype) }));
        const kept = BSON.deserialize(start.doc).b;

        expect(start.cut).toBe(true);
        expect(kept.sub_type).toBe(subtype);
        expect(kept.buffer.length % 3).toBe(0);
        expect(payload.subarray(0, kept.buffer.length)).toEqual(
          Buffer.from(kept.buffer),
        );
      },
    );

    it("keeps a 16-byte UUID at the cut whole", () => {
      const uuid = new Binary(Buffer.alloc(16, 0xab), 4);
      const start = checkStart(bytesOf({ s: "a".repeat(185), u: uuid }));

      expect(BSON.deserialize(start.doc).u.buffer).toEqual(uuid.buffer);
    });

    it("never keeps more of a Binary than it holds, at the cut or made again", () => {
      const payload = Buffer.alloc(17, 0xcd);
      const atCut = checkStart(
        bytesOf({ s: "x".repeat(164), b: new Binary(payload) }),
      );
      const madeAgain = checkStart(
        documentOf([
          [
            0x04,
            "a",
            documentOf([
              [
                0x05,
                "k".repeat(7200),
                Buffer.concat([int32(17), Buffer.of(0), payload]),
              ],
            ]),
          ],
          [0x10, "after", int32(2)],
        ]),
      );

      expect(atCut.cut).toBe(true);
      expect(BSON.deserialize(atCut.doc).b.buffer).toEqual(payload);
      expect(madeAgain.cut).toBe(false);
      expect(BSON.deserialize(madeAgain.doc).a[0].buffer).toEqual(payload);
    });
  });

  it("cuts a regex's pattern, then its flags", () => {
    const long = checkStart(
      bytesOf({ r: new BSONRegExp("p".repeat(300), "i") }),
    );
    const flags = checkStart(
      documentOf([
        [0x0b, "r", Buffer.from(`${"p".repeat(100)}\0${"i".repeat(300)}\0`)],
      ]),
    );

    expect(cstrings(long.doc, 7)[1].length).toBe(0);
    expect(cstrings(flags.doc, 7)[0].length).toBe(100);
    expect(cstrings(flags.doc, 7)[1].length).toBeGreaterThan(0);
  });

  it("keeps a short code whole and cuts its large scope", () => {
    const start = checkStart(
      bytesOf({ c: new Code("f()", { big: "q".repeat(5000) }) }),
    );
    const kept = BSON.deserialize(start.doc).c;

    expect(kept.code).toBe("f()");
    expect(kept.scope.big.length).toBeLessThan(START_PRINTED);
  });

  it("never reads past the bound: a 16 MiB record of tiny elements", () => {
    const head = documentOf(
      Array.from({ length: 200 }, (_, n) => [0x10, `k${n}`, int32(n)]),
    );
    const record = Buffer.alloc(16 * 1024 * 1024, 0xff);

    head.copy(record, 0, 0, head.length - 1);
    record.writeInt32LE(record.length, 0);
    record[record.length - 1] = 0;

    const start = startOf(record);

    expect(start.cut).toBe(true);
    expect(isBsonDocument(start.doc, START_BYTES)).toBe(true);
  });

  describe("an object key crossing the bound", () => {
    it("is cut like text, its value kept in its smallest form", () => {
      const record = bytesOf({ ["k".repeat(1025)]: "value", after: 1 });
      const start = checkStart(record);
      const [[key, value], ...rest] = Object.entries(
        BSON.deserialize(start.doc),
      );

      expect(start.cut).toBe(true);
      expect(start.quotedKey).toBeUndefined();
      expect(key).toBe("k".repeat(START_PRINTED - 2 - 2));
      expect(value).toBe("");
      expect(rest).toEqual([]);
    });

    it.each([
      ["an empty object", { a: 1 }, {}],
      ["an empty list", [1, 2], []],
      ["a number as stored", new Int32(7), 7],
    ])("keeps %s", (_, stored, kept) => {
      const start = checkStart(bytesOf({ ["k".repeat(1025)]: stored }));

      expect(Object.values(BSON.deserialize(start.doc))).toEqual([kept]);
    });

    it("says the key is quoted only whole when its kept part is a word", () => {
      const quoted = checkStart(bytesOf({ [`${"k".repeat(1024)} x`]: 1 }));
      const both = checkStart(bytesOf({ [`k-${"k".repeat(1024)}`]: 1 }));
      const word = checkStart(bytesOf({ [`k$${"k".repeat(1024)}`]: 1 }));

      expect(quoted.quotedKey).toBe(true);
      expect(both.quotedKey).toBeUndefined();
      expect(word.quotedKey).toBeUndefined();
    });

    it("cuts a nested key the same way", () => {
      const start = checkStart(
        bytesOf({ a: { [`${"k".repeat(1500)}.`]: { deep: 1 } } }),
      );

      expect(start.quotedKey).toBe(true);
      expect(Object.values(BSON.deserialize(start.doc).a)).toEqual([{}]);
    });

    it("keeps a list key past what a start holds to its first 8 bytes, the record printed whole", () => {
      const record = documentOf([
        [0x04, "a", documentOf([[0x10, "k".repeat(7200), int32(1)]])],
        [0x02, "b", stringValue("after")],
      ]);
      const start = checkStart(record);
      const [list] = elementsIn(start.doc, 0);

      expect(start.cut).toBe(false);
      expect(keyBytes(start.doc, elementsIn(start.doc, list.start)[0])).toEqual(
        Buffer.from("k".repeat(8)),
      );
      expect(BSON.deserialize(start.doc)).toEqual({ a: [1], b: "after" });
    });

    it("keeps list keys as stored up to 4 KiB of them, and past that each to 8 bytes", () => {
      const record = documentOf([
        [
          0x04,
          "l",
          documentOf(
            Array.from({ length: 6 }, (_, n) => [
              0x10,
              String(n).repeat(1500),
              int32(n),
            ]),
          ),
        ],
      ]);
      const start = checkStart(record);
      const [list] = elementsIn(start.doc, 0);
      const keys = elementsIn(start.doc, list.start).map(
        (element) => keyBytes(start.doc, element).length,
      );

      expect(start.cut).toBe(false);
      expect(keys).toEqual([1500, 1500, 8, 8, 8, 8]);
    });

    it("doesn't count a list key of that size", () => {
      const record = documentOf([
        [0x04, "l", documentOf([[0x10, "k".repeat(1025), int32(1)]])],
        [0x10, "after", int32(2)],
      ]);
      const start = checkStart(record);

      expect(start.cut).toBe(false);
    });
  });
});
