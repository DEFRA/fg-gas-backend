import { logger } from "../../common/logger.js";
import { describeError } from "../repositories/cw-http.js";
import { listApiTokensUseCase } from "./list-api-tokens.use-case.js";

// The list is read as the page reads it, so it is audited as a view of the
// service's tokens, not of the client written to.
const listArgsOf = ({ service, caller, callerHash, actor, encodedActor }) => ({
  service,
  caller,
  callerHash,
  actor,
  encodedActor,
});

// The page is drawn again from this list, so one that cannot be read is null.
export const readTokensOrNull = async (params) => {
  try {
    return (await listApiTokensUseCase(listArgsOf(params))).tokens;
  } catch (error) {
    logger.warn(
      `API clients: ${params.service} tokens not read (${describeError(error)})`,
    );

    return null;
  }
};

export const withTokens = async (params, answer) => ({
  ...answer,
  tokens: await readTokensOrNull(params),
});

// A refusal names its code and carries the list, so the page that refused is
// drawn again from this answer alone. `tokens` already read is not read again.
export const refusalWithTokens = async (error, params, tokens) => {
  const { payload } = error.output;

  payload.code = payload.errorCode ?? null;
  payload.tokens =
    tokens === undefined ? await readTokensOrNull(params) : tokens;

  return error;
};

export const answeringTokens =
  (write) =>
  async (params, ...rest) => {
    try {
      return await write(params, ...rest);
    } catch (error) {
      if (!error.isBoom || error.output.payload.tokens !== undefined) {
        throw error;
      }

      throw await refusalWithTokens(error, params);
    }
  };
