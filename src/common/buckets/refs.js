const W3C_TRACEPARENT =
  /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i;

const isBlank = (value) =>
  value === null || value === undefined || String(value).trim() === "";

export const toRef = (kind, value) =>
  isBlank(value) ? null : `${kind}:${String(value).trim().toLowerCase()}`;

export const toRefs = (pairs) => [
  ...new Set(pairs.map(([kind, value]) => toRef(kind, value)).filter(Boolean)),
];

export const toTraceId = (traceparent) => {
  const [, traceId = traceparent] = W3C_TRACEPARENT.exec(traceparent) ?? [];

  return traceId;
};
