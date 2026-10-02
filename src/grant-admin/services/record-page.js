import { auditedRead } from "../../events/audited-read.js";
import { toPublicSourceErrors } from "./event-sources.js";
import { sectionOf } from "./page-sections.js";

// Past this a tab's document is not shown: the admin renders a section whole.
export const SECTION_CAP_BYTES = 1024 * 1024;
export const TOO_LARGE = "too large to show";

const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value) ?? "");

const isOverCap = (value) =>
  value !== null && jsonBytes(value) > SECTION_CAP_BYTES;

// A tab may already know it is too large, without reading what it would show.
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

const readPage = async ({ readHeader, tab, args }) => {
  const [header, body] = await Promise.allSettled([
    readHeader(args),
    tab.readTab(args),
  ]);

  // No record, or no way to read it: there is no page to draw.
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

/**
 * One tab of a record page, read as one audited call. The header and the tab
 * are read in parallel; an unreadable header fails the page, an unreadable or
 * oversized tab is null beside a section error. `accounts` from the header
 * read reach the audit and never the page.
 */
export const viewRecordPage = ({ readHeader, tabs, audit }) => {
  const read = auditedRead(
    (args) => readPage({ readHeader, tab: tabs[args.tab], args }),
    (args, result, error) =>
      audit({ ...args, accounts: result?.accounts }, error),
  );

  return async (args) => (await read(args)).page;
};
