export const AgreementStatus = {
  Offered: "OFFERED",
  Accepted: "ACCEPTED",
  Rejected: "REJECTED",
  Withdrawn: "WITHDRAWN",
  Terminated: "TERMINATED",
};

export const AgreementServiceStatus = {
  Accepted: "accepted",
  Withdrawn: "withdrawn",
  Offered: "offered",
  Rejected: "rejected",
  Terminated: "terminated",
};

export class AgreementHistoryEntry {
  constructor({ agreementStatus, createdAt }) {
    this.agreementStatus = agreementStatus;
    this.createdAt = createdAt;
  }
}

export class Agreement {
  constructor({
    agreementRef,
    latestStatus,
    updatedAt,
    history,
    startDate,
    endDate,
    acceptedDate,
  }) {
    this.agreementRef = agreementRef;
    this.latestStatus = latestStatus;
    this.updatedAt = updatedAt;
    this.history = history;
    this.startDate = startDate;
    this.endDate = endDate;
    this.acceptedDate = acceptedDate;
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

  accept({ startDate, endDate, acceptedDate }) {
    this.latestStatus = AgreementStatus.Accepted;
    this.updatedAt = new Date().toISOString();
    this.startDate = startDate;
    this.endDate = endDate;
    this.acceptedDate = acceptedDate;

    this.history.push(
      new AgreementHistoryEntry({
        agreementStatus: this.latestStatus,
        createdAt: new Date().toISOString(),
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

  terminate(date) {
    this.latestStatus = AgreementStatus.Terminated;
    this.updatedAt = new Date().toISOString();

    this.history.push(
      new AgreementHistoryEntry({
        agreementStatus: this.latestStatus,
        createdAt: date,
      }),
    );
  }
}
