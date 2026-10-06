import { toPublicSourceErrors } from "./event-sources.js";
import { sectionOf } from "./page-sections.js";

// Past this a tab's document is not shown: the admin renders a section whole.
export const SECTION_CAP_BYTES = 1024 * 1024;
export const TOO_LARGE = "too large to show";

const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value) ?? "");

const isOverCap = (value) =>
  value !== null && jsonBytes(value) > SECTION_CAP_BYTES;

const capSection = (read, key, sectionErrors) => {
  if (!key || !(read.tooLarge || isOverCap(read.content[key]))) {
    return read.content;
  }

  sectionErrors.push({ section: key, message: TOO_LARGE });

  return { ...read.content, [key]: null };
};

const tabContent = (tab, read, sectionErrors) =>
  read ? capSection(read, tab.capped, sectionErrors) : tab.empty;

const sourceErrorsOf = (...reads) =>
  toPublicSourceErrors(...reads.map((read) => read?.sourceErrors ?? []));

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
      ...tabContent(tab, read, sectionErrors),
      sourceErrors: sourceErrorsOf(header.value, read),
      sectionErrors,
    },
    accounts: header.value.accounts,
  };
};
