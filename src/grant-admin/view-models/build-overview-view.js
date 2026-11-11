export const TOP_ERRORS = 5;
const CONFIG_FAILED_LIMIT = 100;

const capAt = (cap, sum, capped) => ({
  count: Math.min(sum, cap),
  capped: capped || sum > cap,
});

const sumOf = (cap, counts) =>
  capAt(
    cap,
    counts.reduce((total, { count }) => total + count, 0),
    counts.some(({ capped }) => capped),
  );

const toBar = (cap, boxes) => (bin, i) => ({
  from: bin.from,
  to: bin.to,
  ...sumOf(
    cap,
    boxes.map(({ bins }) => bins[i]),
  ),
});

// A list opened from a 24-hour figure shows exactly the window it counted.
const withinWindow = ({ path, query }, { from, to }) => ({
  path,
  query: { ...query, from, to },
});

// Each box's bins, added bar by bar; the figure is the sum of the bars,
// capped when any bar or the sum is. Each box has its own count and list, so
// a figure always matches the list its link opens.
const toDeadLetters = ({ countCap, boxes }, window) => {
  const bars = boxes[0].bins.map(toBar(countCap, boxes));

  return {
    ...sumOf(countCap, bars),
    bars,
    lists: boxes.map(({ box, list, bins }) => ({
      box,
      ...sumOf(countCap, bins),
      list: withinWindow(list, window),
    })),
  };
};

const urlQueryOf = (box, values) =>
  Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== null)
      .map(([fact, value]) => [box.params[fact], value]),
  );

const toTopError =
  (box) =>
  ({ values, count, capped, lastAt }) => ({
    errorKey: values.errorKey,
    event:
      values.eventType === null
        ? null
        : {
            value: values.eventType,
            label: box.labels[values.eventType] ?? values.eventType,
          },
    count,
    capped,
    lastAt,
    list: {
      path: box.path,
      query: urlQueryOf(box, { ...box.among, ...values }),
    },
  });

const byCountThenLatest = (a, b) =>
  b.count - a.count || String(b.lastAt).localeCompare(String(a.lastAt));

// `box` is the list a summary was read from: its path, the URL key of each
// fact, its event labels and what the summary picks out. The summaries cover
// every current dead letter, so the links carry no window.
const toTopErrors = ({ summaries }) => {
  const entries = summaries
    .flatMap(({ box, summary }) => summary.entries.map(toTopError(box)))
    .sort(byCountThenLatest);

  return {
    entries: entries.slice(0, TOP_ERRORS),
    more:
      entries.length > TOP_ERRORS ||
      summaries.some(({ summary }) => summary.more),
    complete: summaries.every(({ summary }) => summary.complete),
  };
};

const toFailedVersion =
  (definition) =>
  ({ time, link }) => ({
    code: link.code,
    version: link.version,
    definition,
    receivedAt: time,
  });

const newestReceived = (a, b) =>
  String(b.receivedAt ?? "").localeCompare(String(a.receivedAt ?? ""));

// One page of the version list per failed definition, merged newest first.
const toConfigFailed = ({ pages }) => {
  const versions = pages
    .flatMap(({ definition, rows }) => rows.map(toFailedVersion(definition)))
    .sort(newestReceived);

  return {
    versions: versions.slice(0, CONFIG_FAILED_LIMIT),
    more:
      versions.length > CONFIG_FAILED_LIMIT || pages.some(({ more }) => more),
  };
};

const withoutStored = ({ stored: _stored, ...token }) => token;

const toTokensExpiring = ({ withinDays, tokens }) => ({
  withinDays,
  tokens: tokens.map(withoutStored),
});

const shapers = {
  deadLetters: toDeadLetters,
  topErrors: toTopErrors,
  configFailed: toConfigFailed,
  tokensExpiring: toTokensExpiring,
};

const toPart =
  (shape, window) =>
  ({ data, sourceError }) =>
    data === null
      ? { data: null, sourceError }
      : { data: shape(data, window), sourceError: null };

const toPerService = (shape, window, parts) =>
  Object.fromEntries(
    Object.entries(parts).map(([service, part]) => [
      service,
      toPart(shape, window)(part),
    ]),
  );

// The Overview as the admin's page reads it, each part shaped on its own.
export const buildOverviewView = (overview) => ({
  at: overview.at,
  window: overview.window,
  countCap: overview.countCap,
  ...Object.fromEntries(
    Object.entries(shapers).map(([part, shape]) => [
      part,
      toPerService(shape, overview.window, overview[part]),
    ]),
  ),
});
