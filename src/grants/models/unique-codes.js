import Boom from "@hapi/boom";

// The runtime finds a phase, stage or status by the first one with its code,
// so a later one with the same code could never be reached.
export const assertUniqueCodes = (items, describe) => {
  const codes = new Set();

  for (const { code } of items) {
    if (codes.has(code)) {
      throw Boom.badImplementation(
        `${describe(code)} is defined more than once`,
      );
    }

    codes.add(code);
  }
};
