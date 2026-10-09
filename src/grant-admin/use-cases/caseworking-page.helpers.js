import {
  findCwPage,
  isCwConfigured,
} from "../repositories/cw-actuators.repository.js";
import { PAGE_SIZE } from "../services/admin-list.js";
import { decodeCompositeCursor } from "../services/event-cursor.js";
import { selectsCaseworking } from "../services/event-sources.js";

// One Caseworking read of the named sections, started by the caller and passed
// to each use case that draws from it.
export const readCaseworkingPage = ({
  service,
  cursor,
  sections,
  ...filters
}) => {
  if (!selectsCaseworking(service) || !isCwConfigured()) {
    return undefined;
  }

  const page = findCwPage({
    ...filters,
    slices: decodeCompositeCursor(cursor),
    pageSize: PAGE_SIZE,
    sections,
  });

  // Unawaited if a section throws early; the no-op stops an unhandled rejection.
  // eslint-disable-next-line promise/prefer-await-to-then -- the promise is returned un-awaited, so its rejection can only be marked handled here
  page.catch(() => {});

  return page;
};
