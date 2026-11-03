import { Metrics } from "@defra/cdp-metrics";
import { setTimeout } from "node:timers/promises";
import { logger } from "../common/logger.js";

const INTERVAL_MS = 60_000;

export class DeadLetterGauge {
  constructor({ enabled, counts }) {
    this.enabled = enabled;
    this.counts = counts;
    this.metrics = new Metrics(logger);
    this.running = false;
  }

  async poll() {
    while (this.running) {
      for (const [box, count] of Object.entries(this.counts)) {
        try {
          await this.metrics.gauge("deadLetters", await count(), { box });
        } catch (error) {
          logger.error(error, `Error counting ${box} dead letters`);
        }
      }

      await setTimeout(INTERVAL_MS, undefined, { ref: false });
    }
  }

  start() {
    if (!this.enabled) {
      return;
    }

    logger.info("Starting dead letter gauge");
    this.running = true;
    this.poll().catch((error) => {
      logger.error(error, "Dead letter gauge stopped");
    });
  }

  stop() {
    if (!this.enabled) {
      return;
    }

    logger.info("Stopping dead letter gauge");
    this.running = false;
  }
}
