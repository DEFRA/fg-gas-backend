import Boom from "@hapi/boom";

const forbidden = () =>
  Boom.forbidden("You do not have access to administration for this grant");

export class GrantAdminAccess {
  constructor(admin) {
    this.role = admin?.role;
  }

  assertConfigured() {
    if (!this.isConfigured()) {
      throw forbidden();
    }
  }

  assertAccess(heldRoles) {
    this.assertConfigured();

    if (!this.permits(heldRoles)) {
      throw forbidden();
    }
  }

  isConfigured() {
    return typeof this.role === "string" && this.role.trim().length > 0;
  }

  permits(heldRoles) {
    return (
      this.isConfigured() &&
      Array.isArray(heldRoles) &&
      heldRoles.includes(this.role)
    );
  }
}
