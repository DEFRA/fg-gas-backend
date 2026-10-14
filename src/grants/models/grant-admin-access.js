import Boom from "@hapi/boom";

export class GrantAdminAccess {
  constructor(admin) {
    this.role = admin?.role;
  }

  assertAccess(heldRoles) {
    if (!this.#hasConfiguredRole() || !this.#holdsRole(heldRoles)) {
      throw Boom.forbidden(
        "You do not have access to administration for this grant",
      );
    }
  }

  #hasConfiguredRole() {
    return typeof this.role === "string" && this.role.trim().length > 0;
  }

  #holdsRole(heldRoles) {
    return Array.isArray(heldRoles) && heldRoles.includes(this.role);
  }
}
