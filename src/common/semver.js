const SEMVER_PARTS = 3;
const RADIX = 10;

export const parseSemver = (version) => {
  const parts = version.split(".");
  if (parts.length !== SEMVER_PARTS || parts.some((p) => !/^\d+$/.test(p))) {
    return null;
  }
  return {
    major: Number.parseInt(parts[0], RADIX),
    minor: Number.parseInt(parts[1], RADIX),
    patch: Number.parseInt(parts[2], RADIX),
  };
};
