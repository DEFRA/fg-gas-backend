export const AgreementStatus = {
  Offered: "OFFERED",
  Accepted: "ACCEPTED",
  Rejected: "REJECTED",
  Withdrawn: "WITHDRAWN",
};

export const AgreementServiceStatus = {
  Accepted: "accepted",
  Withdrawn: "withdrawn",
  Offered: "offered",
  Rejected: "rejected",
};

export class AgreementHistoryEntry {
  constructor({ agreementStatus, createdAt }) {
    this.agreementStatus = agreementStatus;
    this.createdAt = createdAt;
  }
}

export class Agreement {
  constructor({ agreementRef, latestStatus, updatedAt, history }) {
    this.agreementRef = agreementRef;
    this.latestStatus = latestStatus;
    this.updatedAt = updatedAt;
    this.history = history;
  }

  static new({ agreementRef, date }) {
    const latestStatus = AgreementStatus.Offered;

    return new Agreement({
      agreementRef,
      latestStatus,
      updatedAt: new Date().toISOString(),
      history: [
        new AgreementHistoryEntry({
          agreementStatus: latestStatus,
          createdAt: date,
        }),
      ],
    });
  }

  accept(date) {
    this.latestStatus = AgreementStatus.Accepted;
    this.updatedAt = new Date().toISOString();

    this.history.push(
      new AgreementHistoryEntry({
        agreementStatus: this.latestStatus,
        createdAt: date,
      }),
    );
  }

  withdraw(date) {
    this.latestStatus = AgreementStatus.Withdrawn;
    this.updatedAt = new Date().toISOString();

    this.history.push(
      new AgreementHistoryEntry({
        agreementStatus: this.latestStatus,
        createdAt: date,
      }),
    );
  }
}
