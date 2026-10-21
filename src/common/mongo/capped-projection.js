// $bsonSize measures the whole stored document before any projection.
export const storedBytes = { $bsonSize: "$$ROOT" };

// A projected value that is never sent when the stored document is over
// `maxBytes`: only its size is.
export const cappedField = (value, maxBytes) => ({
  $cond: [{ $lte: [storedBytes, maxBytes] }, value, "$$REMOVE"],
});
