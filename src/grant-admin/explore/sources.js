import { findBucket } from "../../common/buckets/registry.js";
import {
  findExploreSource,
  listExploreSources,
} from "../../common/explore-sources/registry.js";
import { SOURCES } from "./language/allowlist.js";

const withBucket = (box) => ({
  ...box,
  id: box.bucket,
  bucket: findBucket(box.bucket),
});

// A record attached from another source is read from that source's
// collection, and only through that source's roots.
const attachedFrom = ({ source: name, ...attach }) =>
  name ? { ...attach, collection: findExploreSource(name).collection } : attach;

const attachedRoots = (attach = []) =>
  attach
    .filter(({ source }) => source)
    .flatMap(({ as, source }) =>
      findExploreSource(source).roots.map((root) => `${as}.${root}`),
    );

// A source with its buckets read from the bucket registry and its attached
// records from the sources they come from, as every module has registered
// them by the time a query arrives.
const resolved = (source) => ({
  ...source,
  roots: [...source.roots, ...attachedRoots(source.attach)],
  ...(source.bucket && { bucket: findBucket(source.bucket) }),
  ...(source.boxes && { boxes: source.boxes.map(withBucket) }),
  ...(source.attach && { attach: source.attach.map(attachedFrom) }),
});

const inOrder = (a, b) => SOURCES.indexOf(a.name) - SOURCES.indexOf(b.name);

export const ownSources = () =>
  listExploreSources().toSorted(inOrder).map(resolved);

export const findOwnSource = (name) => {
  const source = findExploreSource(name);

  return source ? resolved(source) : null;
};
