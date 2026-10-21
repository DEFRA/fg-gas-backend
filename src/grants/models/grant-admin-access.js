import Boom from "@hapi/boom";

const forbidden = () =>
  Boom.forbidden("You do not have access to administration for this grant");

export class GrantAdminAccess {
  constructor(admin) {
    this.role = admin?.role;
  }

  assertConfigured() {
    if (!this.#hasConfiguredRole()) {
      throw forbidden();
    }
  }

  assertAccess(heldRoles) {
    this.assertConfigured();

    if (!this.#holdsRole(heldRoles)) {
      throw forbidden();
    }
  }

  #hasConfiguredRole() {
    return typeof this.role === "string" && this.role.trim().length > 0;
  }

  #holdsRole(heldRoles) {
    return Array.isArray(heldRoles) && heldRoles.includes(this.role);
  }
}
