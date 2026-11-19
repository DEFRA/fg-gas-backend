import { describe, expect, it } from "vitest";
import {
  isTestFile,
  pinnedHashes,
  presentHashes,
} from "../../scripts/shared-explore.js";

const SHARED_WITH =
  "src/common/explore, and the src/common/buckets files it imports, are " +
  "shared with fg-gas-backend and fg-cw-backend and must change in both: " +
  "make the change in both, then run npm run explore:hash in " +
  "fg-gas-backend and copy SHARED.sha256 across.";

describe("the shared Explore code", () => {
  it("matches SHARED.sha256, file by file", () => {
    const present = presentHashes();
    const pinned = pinnedHashes();
    const hasTests = [...present.keys()].some(isTestFile);

    const changed = [...present]
      .filter(([name, hash]) => pinned.get(name) !== hash)
      .map(([name]) => name);
    const missing = [...pinned.keys()].filter(
      (name) => !present.has(name) && (hasTests || !isTestFile(name)),
    );

    expect({ changed, missing }, SHARED_WITH).toEqual({
      changed: [],
      missing: [],
    });
  });
});
