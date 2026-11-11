// One request at a time. The owner reconciles the sent snapshot with newer edits.
export function createMvrSync({ getChanges, submit, onResult, onError, onStatus = () => {}, canSend = () => true, delay = 100 }) {
  let timer, running = null, failure = null, generation = 0;
  const status = () => onStatus({ saving: Boolean(running), error: failure });
  function schedule(ms = delay) {
    clearTimeout(timer);
    if (failure) return;
    timer = setTimeout(() => { timer = undefined; flush(); }, ms);
  }
  async function flush() {
    clearTimeout(timer); timer = undefined;
    if (running || failure || !canSend()) return running;
    const sent = structuredClone(getChanges());
    if (!sent.length) { status(); return; }
    const epoch = generation;
    const task = Promise.resolve().then(() => submit(sent));
    running = task; status();
    try {
      const result = await task;
      if (generation === epoch) onResult(result, sent);
    } catch (error) {
      if (generation === epoch) { failure = error; onError(error, sent); }
    } finally {
      if (running === task) running = null;
      status();
      if (!failure && getChanges().length && canSend()) schedule(0);
    }
  }
  return { schedule, flush,
    retry() { failure = null; status(); return flush(); },
    reset() { generation++; clearTimeout(timer); timer = undefined; failure = null; status(); },
    async idle() { if (running) await running.catch(() => {}); },
    get saving() { return Boolean(running); }, get error() { return failure; },
  };
}
