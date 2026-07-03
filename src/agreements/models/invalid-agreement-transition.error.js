export class InvalidAgreementTransitionError extends Error {
  constructor({ from, action, availableActions }) {
    const availableActionsMessage = availableActions.length
      ? availableActions.join(", ")
      : "none";
    super(
      `Cannot perform action "${action}" from agreement state "${from}". Available actions: ${availableActionsMessage}.`,
    );
    this.name = "InvalidAgreementTransitionError";
    this.from = from;
    this.action = action;
    this.availableActions = availableActions;
  }
}
