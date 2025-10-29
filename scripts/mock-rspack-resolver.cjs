const Module = require("module");
const resolve = require("resolve");

class ResolverFactory {
  constructor(options = {}) {
    this.extensions = options.extensions || [".js", ".json", ".mjs", ".cjs"];
    this.conditionNames = options.conditionNames || ["default"];
  }

  sync(context, request) {
    try {
      const path = resolve.sync(request, {
        basedir: context,
        extensions: this.extensions,
        packageFilter(pkg) {
          if (pkg && pkg.exports) {
            delete pkg.exports;
          }
          return pkg;
        },
      });
      return { path };
    } catch {
      return { path: undefined };
    }
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
