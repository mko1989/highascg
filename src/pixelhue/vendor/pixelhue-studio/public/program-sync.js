// A bounded live-write queue: one request in flight, only the newest geometry per layer retained.
// Start immediately; at most one new request every 40 ms, or immediately on release/commit.
export function createProgramSync({ submit, onResult, onError, onStatus = () => {}, canSend = () => true, interval = 40 }) {
  const pending = new Map(); let running = null, failure = null, timer, epoch = 0, revision = 0, lastSent = -Infinity, urgent = false;
  const status = () => onStatus();
  const key = change => `${change.screenId}:${change.id}`;
  function schedule() {
    clearTimeout(timer);
    if (failure || running || !pending.size || !canSend()) return;
    const wait = urgent ? 0 : Math.max(0, interval - (Date.now() - lastSent));
    if (!wait) { flush(); return; }
    timer = setTimeout(() => flush(), wait);
  }
  function flush(force = false) {
    urgent ||= force; clearTimeout(timer);
    if (running || failure || !pending.size || !canSend()) return running;
    const generation = epoch, sent = [...pending.values()]; urgent = false; lastSent = Date.now();
    const task = Promise.resolve().then(async () => {
      try {
        if (generation !== epoch) return;
        const next = await submit(sent.map(item => item.change));
        if (generation !== epoch) return;
        const accepted = [];
        for (const item of sent) if (pending.get(key(item.change))?.revision === item.revision) {
          pending.delete(key(item.change)); accepted.push(item.change);
        }
        onResult(next, accepted);
      } catch (error) {
        if (generation === epoch) { failure = error; onError(error); }
      } finally {
        if (running === task) running = null;
        status(); schedule();
      }
    });
    running = task; status(); return task;
  }
  return {
    put(change, immediate = false) {
      pending.set(key(change), { change: structuredClone(change), revision: ++revision });
      urgent ||= immediate; status(); schedule();
    },
    flush,
    resume: schedule,
    retry() { failure = null; status(); return flush(true); },
    reset() { epoch++; pending.clear(); failure = null; urgent = false; clearTimeout(timer); status(); },
    async drain() {
      while ((pending.size || running) && !failure) {
        if (!canSend()) return false;
        await (running || flush(true));
      }
      return !failure;
    },
    get saving() { return Boolean(running); }, get dirty() { return pending.size > 0; }, get error() { return failure; },
  };
}
