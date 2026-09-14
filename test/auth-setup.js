import { MongoClient } from "mongodb";

// Seed the access_tokens collection used by auth in the running Mongo container
// Token: 00000000-0000-0000-0000-000000000000 (hashed value below)
const HASHED_TOKEN =
  "12b9377cbe7e5c94e8a70d9d23929523d14afa954793130f8a3959c7b849aca8";

// A second, valid credential belonging to some OTHER service, so the suite can
// prove that authenticating is not the same as being allowed on the
// grant-admin surface. Token: 22222222-2222-2222-2222-222222222222
// (11111111-... is deliberately NOT seeded - three tests use it as the
// invalid-credential fixture and must keep getting a 401.)
const OTHER_CLIENT_HASHED_TOKEN =
  "05d17100b346c29d6760a0fdedcf8623945b53a26f7f811ae70835610f9e6797";

async function seedAccessToken() {
  const uri = process.env.MONGO_URI;
  if (!uri) return;

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const col = db.collection("access_tokens");

    // `clientId` is what auth.js reads onto the credentials, and the
    // grant-admin surface answers one client by name - so the suite's own
    // credential has to BE that client, exactly as a deployed one is.
    await col.updateOne(
      { id: HASHED_TOKEN },
      {
        $set: {
          id: HASHED_TOKEN,
          client: "fg-grants-platform-admin",
          clientId: "fg-grants-platform-admin",
        },
      },
      { upsert: true },
    );

    await col.updateOne(
      { id: OTHER_CLIENT_HASHED_TOKEN },
      {
        $set: {
          id: OTHER_CLIENT_HASHED_TOKEN,
          client: "some-other-service",
          clientId: "some-other-service",
        },
      },
      { upsert: true },
    );
  } catch (err) {
    console.warn("[auth-setup] Failed to seed access_tokens:", err?.message);
  } finally {
    await client.close().catch(() => {});
  }
}

await seedAccessToken();
