import { MongoServerError } from "mongodb";

const DUPLICATE_KEY_ERROR_CODE = 11000;

export const isMongoDuplicateKeyError = (error) =>
  error instanceof MongoServerError && error.code === DUPLICATE_KEY_ERROR_CODE;
