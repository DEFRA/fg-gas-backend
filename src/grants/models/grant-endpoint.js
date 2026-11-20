import { assertOutputMappingValid } from "./output-mapping.js";

const NAME_PLACEHOLDER = "{name}";

// A call to another service a grant declares once, by code, for its lists to
// share. The address comes from {service}_URL; {name} in the path becomes the
// name of the list being read.
export class GrantEndpoint {
  constructor({ code, method, path, service, output }) {
    this.code = code;
    this.method = method;
    this.path = path;
    this.service = service;
    this.output = output;

    if (output) {
      assertOutputMappingValid(`Endpoint "${code}"`, output);
    }
  }

  pathFor(name) {
    return this.path.replaceAll(NAME_PLACEHOLDER, encodeURIComponent(name));
  }

  toJSON() {
    return {
      code: this.code,
      method: this.method,
      path: this.path,
      service: this.service,
      ...(this.output && { output: this.output }),
    };
  }
}
