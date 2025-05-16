import { MongoClient } from "mongodb";
import tls from "node:tls";
import { config } from "./config.js";

export const mongoClient = new MongoClient(config.mongoUri, {
  retryWrites: false,
  readPreference: "secondary",
  secureContext: tls.createSecureContext(),
});

export const db = mongoClient.db(config.mongoDatabase);
