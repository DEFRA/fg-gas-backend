import { MongoClient } from "mongodb";
import tls from "node:tls";
import { config } from "./config.js";

export const getReadPreference = (env) => {
  return env === "production" ? "secondary" : "primary";
};

export const mongoClient = new MongoClient(config.mongoUri, {
  retryWrites: false,
  readPreference: getReadPreference(config.env),
  secureContext: tls.createSecureContext(),
});

export const db = mongoClient.db(config.mongoDatabase);
