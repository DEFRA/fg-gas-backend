import { decodeGroupCursor } from "./cursor.js";
import { noMembersPage, readGroupPage } from "./page.js";
import { checkSearch, splitAddress } from "./split.js";

// A group's list read as any list's: a first page, and later ones from a
// cursor. `readMember` is the list's own read of one bucket. The address
// splits the same way on every page, and a cursor is checked before any read.
export const groupReaderFor = ({ view, where, ask, deadline, readMember }) => {
  const reading = splitAddress(view, where);
  const given =
    ask.cursor === undefined
      ? null
      : decodeGroupCursor(ask.cursor, view, reading);

  const readPage = async (start, { ref, count }, repeat) => {
    checkSearch(view, ref);

    return reading.length === 0
      ? noMembersPage({ bucket: view.id, count })
      : readGroupPage({
          bucket: view.id,
          pick: view.pick,
          reading,
          start,
          count,
          read: (member, { cursor, count: counted, signal }) =>
            readMember({
              bucketId: member.bucket,
              where: member.where,
              fields: { ref, cursor, count: counted },
              repeat,
              signal,
            }),
        });
  };

  const search = ask.search ?? undefined;

  return {
    deadline,
    first: (withSearch) =>
      withSearch
        ? readPage(
            given,
            { ref: search, count: given === null ? ask.count : undefined },
            ask.repeat,
          )
        : readPage(null, { count: ask.count }, false),
    later: (cursor) =>
      readPage(decodeGroupCursor(cursor, view, reading), { ref: search }, true),
  };
};
