import { BSON, Decimal128 } from "mongodb";
import { connect } from "node:net";

// BSON written by hand, and stored as written: what `bson` never writes, a
// document with two elements of one name, reaches mongod as it is.

export const int32 = (n) => {
  const buf = Buffer.alloc(4);

  buf.writeInt32LE(n);

  return buf;
};

export const cstring = (text) =>
  Buffer.concat([Buffer.from(text), Buffer.from([0])]);

const int64 = (n) => {
  const buf = Buffer.alloc(8);

  buf.writeBigInt64LE(n);

  return buf;
};

const double = (n) => {
  const buf = Buffer.alloc(8);

  buf.writeDoubleLE(n);

  return buf;
};

export const string = (text) => {
  const value = Buffer.from(text);

  return Buffer.concat([int32(value.length + 1), value, Buffer.from([0])]);
};

const elementBytes = ([type, name, value]) =>
  Buffer.concat([Buffer.from([type]), cstring(name), value]);

const sized = (body) => Buffer.concat([int32(body.length + 4), body]);

// [type, name, value bytes] for each element, in order.
export const documentOf = (elements) =>
  sized(Buffer.concat([...elements.map(elementBytes), Buffer.from([0])]));

// A document's own bytes with more elements after its last.
export const withElements = (doc, elements) =>
  sized(
    Buffer.concat([
      doc.subarray(4, -1),
      ...elements.map(elementBytes),
      Buffer.from([0]),
    ]),
  );

export const objectIdElement = (name, id) => [0x07, name, Buffer.from(id.id)];
export const stringElement = (name, text) => [0x02, name, string(text)];

// Every type JavaScript can't hold as stored: numbers of each width, dates
// outside a JavaScript Date, undefined, a regex's flags, a UUID, keys
// mongosh can't write and a name given twice.
export const ODD_ELEMENTS = Object.freeze([
  [0x10, "int32", int32(5)],
  [0x12, "int64", int64(9_007_199_254_740_993n)],
  [0x01, "double", double(5)],
  [0x13, "decimal", Buffer.from(Decimal128.fromString("1234.5678").bytes)],
  [0x09, "late", int64(8_640_000_000_000_001n)],
  [0x09, "early", int64(-8_640_000_000_000_001n)],
  [0x06, "undefined", Buffer.alloc(0)],
  [0x0b, "regex", Buffer.from("^a.b$\0imsx\0", "latin1")],
  [
    0x05,
    "uuid",
    Buffer.concat([int32(16), Buffer.from([4]), Buffer.alloc(16, 7)]),
  ],
  stringElement("$schema", "dollar"),
  stringElement("a.b", "dotted"),
  [0x02, "dup", string("one")],
  [0x02, "dup", string("two")],
]);

// Documents inserted as their own bytes, in one OP_MSG insert.
export const rawInsert = (uri, database, collection, docs) =>
  new Promise((resolve, reject) => {
    const { hostname, port } = new URL(uri.replace("mongodb://", "http://"));
    const command = BSON.serialize({
      insert: collection,
      $db: database,
      ordered: false,
    });
    const name = cstring("documents");
    const sequence = Buffer.concat(docs);
    const message = Buffer.concat([
      int32(0),
      Buffer.from([0]),
      command,
      Buffer.from([1]),
      int32(4 + name.length + sequence.length),
      name,
      sequence,
    ]);
    const header = Buffer.concat([
      int32(16 + message.length),
      int32(1),
      int32(0),
      int32(2013),
    ]);
    const socket = connect(Number(port), hostname);
    const chunks = [];

    socket.on("error", reject);
    socket.on("data", (chunk) => {
      chunks.push(chunk);

      const reply = Buffer.concat(chunks);

      if (reply.length >= 4 && reply.length >= reply.readInt32LE(0)) {
        socket.end();
        resolve(BSON.deserialize(reply.subarray(21)));
      }
    });
    socket.write(Buffer.concat([header, message]));
  });
