export function createLocalQueue(processBody) {
  const pending = new Set();

  async function enqueue(body) {
    const task = Promise.resolve()
      .then(() => processBody(body))
      .catch((error) => console.error("[selfhost] queue job failed", error))
      .finally(() => pending.delete(task));
    pending.add(task);
  }

  return {
    async send(body) {
      await enqueue(body);
    },
    async sendBatch(messages) {
      for (const message of messages) await enqueue(message.body);
    },
    async drain() {
      await Promise.all([...pending]);
    },
  };
}

