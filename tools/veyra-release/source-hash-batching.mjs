/** Hash only Source inputs in eight bounded async lanes. Each reader owns its
 * descriptor checks/finally-close; settle every started read before returning. */
export async function hashSourceFileBatch(names, readFile) {
  const ordered = [...names], files = new Array(ordered.length);
  let next = 0, stopped = false, failedAt = Infinity, failure;
  const worker = async () => {
    while (!stopped) {
      const index = next++;
      if (index >= ordered.length) return;
      try { files[index] = [ordered[index], await readFile(ordered[index])]; }
      catch (error) {
        stopped = true;
        // Preserve sequential sorted-order failure selection when concurrent
        // reads fail in a different completion order. Earlier reads are already
        // started; drain them (and their finally-close blocks) before throwing.
        if (index < failedAt) { failedAt = index; failure = error; }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, ordered.length) }, () => worker()));
  if (failedAt !== Infinity) throw failure;
  return files;
}
