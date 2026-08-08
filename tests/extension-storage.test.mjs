import assert from "node:assert/strict";
import test from "node:test";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("serializes extension storage writes so the latest learner state wins", async () => {
  const records = {};
  let writeCount = 0;
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (key === null) return { ...records };
          return { [key]: records[key] };
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete records[key];
          }
        },
        async set(values) {
          writeCount += 1;
          await delay(writeCount === 1 ? 25 : 0);
          Object.assign(records, values);
        },
      },
    },
  };

  try {
    const storage = await import(
      `../src/lib/storage.js?extension-write-order=${Date.now()}`
    );
    await Promise.all([
      storage.saveSettings({ theme: "light" }),
      storage.saveSettings({ theme: "dark" }),
    ]);
    assert.equal((await storage.loadSettings()).theme, "dark");

    await Promise.all([
      storage.saveAnnotationThreads(
        [{ id: "older", exact: "first", comments: [], anchor: {} }],
        "doc-race",
      ),
      storage.saveAnnotationThreads(
        [{ id: "newer", exact: "second", comments: [], anchor: {} }],
        "doc-race",
      ),
    ]);
    assert.equal(
      (await storage.loadAnnotationThreads("doc-race"))[0].id,
      "newer",
    );
  } finally {
    delete globalThis.chrome;
  }
});

test("propagates extension read failures instead of treating them as empty data", async () => {
  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          throw new Error("temporary storage failure");
        },
        async remove() {},
        async set() {},
      },
    },
  };

  try {
    const storage = await import(
      `../src/lib/storage.js?extension-read-failure=${Date.now()}`
    );
    await assert.rejects(
      storage.loadAnnotationThreads("doc-protected"),
      /temporary storage failure/,
    );
    await assert.rejects(storage.loadSettings(), /temporary storage failure/);
  } finally {
    delete globalThis.chrome;
  }
});
