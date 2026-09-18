// Whether trying a failed event again could ever work. Only the code that threw knows: a
// bad message, or a definition that will not build, is just as bad next time, while a
// database or network fault is not. Anything that does not say is retried, so existing
// rows and every subscriber without an opinion keep the behaviour they had.

export const markPermanentFailure = (error) =>
  Object.assign(error, { retryable: false });

export const isRetryableFailure = (error) => error?.retryable !== false;
