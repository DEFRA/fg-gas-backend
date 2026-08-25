import { vi } from "vitest";

/**
 * A stub rather than an automock: pino writes its log methods onto the instance
 * as plain functions, so automocking leaves them untouched. Building the real
 * logger also fails once config is mocked out from under it.
 *
 * Picked up by a bare `vi.mock("../common/logger.js")`, so tests that only need
 * the logger silenced no longer restate the shape they happen to use.
 */
export const logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
};
