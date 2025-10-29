const Module = require("module");
const path = require("node:path");

class ResolverFactory {
  constructor(options = {}) {
    this.extensions = options.extensions || [".js", ".json", ".mjs", ".cjs"];
    this.conditionNames = options.conditionNames || ["default"];
  }

  sync(context, request) {
    const base = context || process.cwd();

    const lookupPaths = [base, path.join(base, "node_modules")];

    for (const candidate of lookupPaths) {
      try {
        const resolved = Module._resolveFilename(request, {
          id: candidate,
          filename: candidate,
          paths: Module._nodeModulePaths(candidate),
        });
        if (resolved) {
          return { path: resolved };
        }
      } catch {
        // continue
      }
    }

    return { path: undefined };
  }
}

const substitute = { ResolverFactory };

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "rspack-resolver") {
    return substitute;
  }
  return originalLoad.call(this, request, parent, isMain);
};
