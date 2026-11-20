const collection = "reference_data";
const name = "grantCode_name_unique";

// One DB Reference Data document per grant and set name.
export const up = async (db) => {
  await db
    .collection(collection)
    .createIndex({ grantCode: 1, name: 1 }, { name, unique: true });
};

export const down = async (db) => {
  await db.collection(collection).dropIndex(name);
};
