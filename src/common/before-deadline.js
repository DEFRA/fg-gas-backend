// What `reading` answers, unless it is still running at `deadline` (epoch
// ms): then it fails with `outOfTime()` and its later answer is dropped.
export const beforeDeadline = async (reading, deadline, outOfTime) => {
  let timer;
  const late = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(outOfTime()),
      Math.max(0, deadline - Date.now()),
    );
  });

  try {
    return await Promise.race([reading, late]);
  } finally {
    clearTimeout(timer);
  }
};
