import { Readable } from "node:stream";

// Called once, however often it is asked.
const once = (finished) => {
  let called = false;
  let ending;

  return () => {
    if (!called) {
      called = true;
      ending = finished();
    }

    return ending;
  };
};

// Values as NDJSON, one JSON value a line, read from `values` only as fast
// as the caller takes them; `finished()` once it has ended, however it
// ended: read to its end, failed, or closed by a caller that went away,
// before its first read too.
export const ndjsonOf = (values, finished) => {
  const finish = once(finished);
  const lines = async function* () {
    try {
      for await (const value of values) {
        yield `${JSON.stringify(value)}\n`;
      }
    } finally {
      await finish();
    }
  };
  const stream = Readable.from(lines(), { objectMode: false });

  stream.once("close", finish);

  return stream;
};
