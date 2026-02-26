export const up = async (db) => {
  await db
    .collection("changelog")
    .updateOne(
      { fileName: "20261902131400-add-replacement-allowed.js" },
      { $set: { fileName: "20260219131400-add-replacement-allowed.js" } },
    );
  await db
    .collection("changelog")
    .updateOne(
      { fileName: "20261902131401-application-x-ref.js" },
      { $set: { fileName: "20260219131401-application-x-ref.js" } },
    );
};

export const down = async (db) => {
  await db
    .collection("changelog")
    .updateOne(
      { fileName: "20260219131400-add-replacement-allowed.js" },
      { $set: { fileName: "20261902131400-add-replacement-allowed.js" } },
    );
  await db
    .collection("changelog")
    .updateOne(
      { fileName: "20260219131401-application-x-ref.js" },
      { $set: { fileName: "20261902131401-application-x-ref.js" } },
    );
};
