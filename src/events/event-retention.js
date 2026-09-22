// A partial TTL index does the deleting; this is only the deadline it reads.
const MS_PER_DAY = 86_400_000;

export const expiryFrom = (date, days) =>
  new Date(new Date(date).getTime() + days * MS_PER_DAY);
