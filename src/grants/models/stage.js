import { Position } from "./position.js";
import { Status } from "./status.js";
import { assertUniqueCodes } from "./unique-codes.js";

export class Stage {
  constructor({ code, statuses }, { phaseCode, isKnownProcess }) {
    assertUniqueCodes(
      statuses,
      (statusCode) => `status "${phaseCode}:${code}:${statusCode}"`,
    );

    this.code = code;
    this.statuses = statuses.map(
      (status) =>
        new Status(status, {
          position: new Position({
            phase: phaseCode,
            stage: code,
            status: status.code,
          }),
          isKnownProcess,
        }),
    );
  }
}
