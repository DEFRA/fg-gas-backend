// A signal that aborts once the caller has gone before its answer was sent:
// the response closed unfinished. Hapi's own "disconnect" fires only while
// the request is still being read.
export const clientGoneSignal = (request) => {
  const gone = new AbortController();
  const { res } = request.raw;

  res.once("close", () => {
    if (!res.writableEnded) {
      gone.abort();
    }
  });

  return gone.signal;
};
