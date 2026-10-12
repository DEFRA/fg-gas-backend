/**
 * APPLY EVENT STATUS CHANGE SERVICE
 *
 * This service handles external status change events (e.g., from Case Working system)
 * and applies them to grant applications. It:
 *
 * 1. Maps external status codes to internal application states
 * 2. Validates state transitions according to grant configuration
 * 3. Updates the application state
 * 4. Raises events and commands for downstream processes
 * 5. Persists state and publications atomically within a transaction
 *
 * Durable publication is delegated to the Events module so this service
 * remains focused on mapping and applying the domain transition.
 */

import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import {
  persistResolvedVersion,
  resolveGrantForApplication,
} from "../use-cases/resolve-current-grant.use-case.js";
import { transitionApplicationUseCase } from "../use-cases/transition-application.use-case.js";

const getValidatedMapping = (grant, application, command) => {
  const mapping = grant.mapExternalStateToInternalState(
    application.position,
    command.externalRequestedState,
    command.sourceSystem,
  );

  if (!mapping.valid) {
    return null;
  }

  return mapping;
};

// ============================================================================
// STATE TRANSITION ORCHESTRATION
// ============================================================================

/**
 * Orchestrates the entire state transition process:
 * 1. Maps external status to internal state
 * 2. Validates the transition is allowed
 * 3. Updates the application state
 * 4. Creates side effects
 *
 * Returns null if the transition is invalid (no mapping or not allowed by grant rules).
 */
const processStateTransition = async (application, grant, command, session) => {
  const currentPosition = application.position;

  logger.info(`process state transition: ${currentPosition}`);

  const validMapping = getValidatedMapping(grant, application, command);

  if (!validMapping) {
    return null;
  }

  const { targetPosition } = validMapping;
  const transition = {
    application,
    grant,
    targetPosition,
    sideEffectContext: command,
  };

  if (!application.canMoveTo(targetPosition, grant)) {
    logger.warn(
      `Invalid state transition: ${currentPosition} to ${targetPosition.status}`,
    );
    return null;
  }

  await transitionApplicationUseCase(transition, session);

  return application;
};

/**
 * Main entry point for applying external status changes to grant applications.
 *
 * This function is typically called by SQS subscribers when external systems
 * (like Case Working) send status update messages. It handles the entire
 * state transition process within a database transaction.
 *
 * Flow:
 * 1. Looks up the application by clientRef
 * 2. Retrieves the grant configuration
 * 3. Processes the state transition (mapping, validation, state update)
 * 4. Saves application and runs any side-effects atomically
 */
export const applyExternalStateChange = async (command) => {
  // eslint-disable-next-line complexity
  return withTransaction(async (session) => {
    logger.info("applyExternalStateChange");

    const { clientRef, code } = command;
    const application = await findByClientRefAndCode({ clientRef, code });

    if (!application) {
      throw Boom.notFound(
        `Application with clientRef "${command.clientRef}" not found`,
      );
    }

    const { grant, resolvedVersion } =
      await resolveGrantForApplication(application);
    await persistResolvedVersion(application, resolvedVersion);

    if (!grant) {
      throw Boom.notFound(`Grant with code "${application.code}" not found`);
    }

    if (
      !grant.hasExternalStatusMapping(
        application.position,
        command.externalRequestedState,
        command.sourceSystem,
      )
    ) {
      logger.info(
        `Acknowledged unknown transition for grantCode ${code} from current position ${application.position} to target position ${command.externalRequestedState} for clientRef ${application.clientRef}`,
      );
      return;
    }

    const result = await processStateTransition(
      application,
      grant,
      command,
      session,
    );
    if (!result) {
      // must throw if we're to retry any inbox events
      throw new Error(
        `Unable to process state change from ${application.position} to ${command.externalRequestedState}`,
      );
    }
  });
};
