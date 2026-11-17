import { describe, expect, it } from "vitest";
import { eachStep, meterFor, step, timeLeftOf } from "./meter.js";
import { refusalOf } from "./refusal.js";

const refusal = (promise) => promise.then(() => null, refusalOf);

describe("the meter", () => {
  it("refuses as too costly once the work budget is spent", async () => {
    const meter = meterFor(Date.now() + 60_000, 10);

    await step(meter, 6);
    expect(await refusal(step(meter, 6))).toBe("TOO_COSTLY");
  });

  it("refuses as too slow past the deadline, checked once a slice of time is spent", async () => {
    const meter = meterFor(Date.now() - 1);
    let taken = 0;
    const slow = () => {
      taken += 1;

      const until = Date.now() + 5;

      while (Date.now() < until);
    };

    expect(
      await refusal(eachStep(Array.from({ length: 1000 }), meter, 1, slow)),
    ).toBe("TOO_SLOW");
    expect(taken).toBeLessThan(10);
  });

  it("never holds the event loop longer than a slice and a record", async () => {
    const meter = meterFor(Date.now() + 60_000);
    let last = Date.now();
    let worst = 0;
    const timer = setInterval(() => {
      worst = Math.max(worst, Date.now() - last);
      last = Date.now();
    }, 1);
    const busy = () => {
      const until = Date.now() + 2;

      while (Date.now() < until);
    };

    await eachStep(Array.from({ length: 300 }), meter, 1, busy);
    clearInterval(timer);

    expect(worst).toBeLessThan(40);
  });

  it("lets the event loop run while it works", async () => {
    const meter = meterFor(Date.now() + 60_000);
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 0);
    const busy = () => {
      const until = Date.now() + 1;

      while (Date.now() < until);
    };

    await eachStep(Array.from({ length: 2000 }), meter, 1, busy);
    clearInterval(timer);

    expect(ticks).toBeGreaterThan(3);
    expect(timeLeftOf(meter)).toBeGreaterThan(0);
  });
});
