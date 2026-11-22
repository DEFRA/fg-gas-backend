import { sectionOf } from "./page-sections.js";

// Past this a tab's document is not shown: the admin renders a section whole.
export const SECTION_CAP_BYTES = 1024 * 1024;
export const TOO_LARGE = "too large to show";

// One read per page, started before the page's own reads so the header and the
// tab share it. Its failure surfaces through them.
export const startSharedRead = (read) => {
  read.catch(() => {});

  return read;
};

const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value) ?? "");

const isOverCap = (value) =>
  value !== null && jsonBytes(value) > SECTION_CAP_BYTES;

// A tab that knows its own size says when it is too large, and its section
// error is named by the tab; any other is measured by its JSON.
const isTooLarge = (read, tab) =>
  read.tooLarge || (!tab.sized && isOverCap(read.content[tab.capped]));

const capSection = (read, { tab, name }, sectionErrors) => {
  if (!tab.capped || !isTooLarge(read, tab)) {
    return read.content;
  }

  sectionErrors.push({
    section: tab.sized ? name : tab.capped,
    message: TOO_LARGE,
  });

  return { ...read.content, [tab.capped]: null };
};

const tabContent = ({ tab, name }, read, sectionErrors) =>
  read ? capSection(read, { tab, name }, sectionErrors) : tab.empty;

const sourceErrorsOf = (...reads) =>
  reads.flatMap((read) => read?.sourceErrors ?? []);

// An unreadable header fails the page; an unreadable or oversized tab is null
// beside a section error. `accounts` are for the audit, never the page.
export const composeRecordPage = async ({ readHeader, tab, args }) => {
  const [header, body] = await Promise.allSettled([
    readHeader(args),
    tab.readTab(args),
  ]);

  if (header.status === "rejected") {
    throw header.reason;
  }

  const sectionErrors = [];
  const read = sectionOf(args.tab, body, sectionErrors);

  return {
    page: {
      header: header.value.header,
      ...tabContent({ tab, name: args.tab }, read, sectionErrors),
      sourceErrors: sourceErrorsOf(header.value, read),
      sectionErrors,
    },
    accounts: header.value.accounts,
  };
};
