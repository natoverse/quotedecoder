"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function element() {
  return {
    hidden: false,
    textContent: "",
    events: {},
    classList: { add() {}, remove() {} },
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    querySelectorAll() { return []; },
    addEventListener(name, listener) { this.events[name] = listener; },
    focus() {}
  };
}

function offlineDatabase(quotes) {
  const queue = new Map(quotes.map((quote, i) => [i + 1, {
    quote,
    fingerprint: quote.quote + "\u0000" + quote.author
  }]));
  const played = new Map();
  let nextId = quotes.length + 1;
  const db = {
    transaction() {
      const tx = {
        objectStore(name) {
          const data = name === "queue" ? queue : played;
          return {
            openCursor() {
              const request = {};
              const rows = [...data.entries()];
              let index = 0;
              function advance() {
                const row = rows[index++];
                request.result = row ? {
                  primaryKey: row[0],
                  value: row[1],
                  continue() { queueMicrotask(advance); },
                  delete() { data.delete(row[0]); }
                } : null;
                request.onsuccess();
              }
              queueMicrotask(advance);
              return request;
            },
            delete(key) { data.delete(key); },
            put(value) { data.set(value.fingerprint, value); },
            add(value) { data.set(nextId++, value); }
          };
        }
      };
      setImmediate(() => tx.oncomplete());
      return tx;
    }
  };
  return {
    queue,
    indexedDB: {
      open() {
        const request = { result: db };
        queueMicrotask(() => request.onsuccess());
        return request;
      }
    }
  };
}

function startApp({ respond, seen = [], offline, online = true, random = () => 0 }) {
  const elements = new Map();
  const requests = [];
  function get(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  }
  let cookie = "qd_seen=" + encodeURIComponent(JSON.stringify(seen));
  const document = {
    baseURI: "https://example.test/quotedecoder/",
    get cookie() { return cookie; },
    set cookie(value) { cookie = value.split(";")[0]; },
    getElementById: get,
    querySelector: get,
    querySelectorAll() { return []; },
    createElement: element,
    addEventListener() {},
    body: element(),
    documentElement: element()
  };
  const window = {};
  const context = {
    document,
    window,
    navigator: { onLine: online },
    URL,
    localStorage: { getItem() { return null; }, setItem() {} },
    Math: Object.assign(Object.create(Math), { random }),
    fetch(url, options) {
      assert.equal(options.cache, "no-store");
      assert.ok(url.href.startsWith(document.baseURI + "quotes/all/"));
      const bucketId = Number(url.pathname.match(/(\d+)\.json$/)[1]);
      requests.push(bucketId);
      return Promise.resolve().then(() => respond(bucketId, requests.length));
    }
  };
  if (offline) window.indexedDB = context.indexedDB = offline.indexedDB;
  vm.runInNewContext(source, context);
  return {
    get,
    requests,
    seen() { return JSON.parse(decodeURIComponent(cookie.split("=")[1])); },
    number() {
      get("settings-btn").events.click();
      const title = new URL(get("remove-current-quote").href).searchParams.get("title");
      return Number(title.match(/#(\d+)$/)[1]);
    }
  };
}

function quote(text = "Test puzzle") {
  return { quote: text, author: "Test", tags: [] };
}

function response(quotes, status = 200) {
  return {
    ok: status === 200,
    status,
    json: async () => JSON.parse(JSON.stringify(quotes))
  };
}

function loaded(app) {
  return app.get("status").hidden && !app.get("quote").hidden;
}

function failed(app) {
  return app.get("status").textContent === "Sorry, we couldn't load a quote. Please try again.";
}

async function waitFor(predicate) {
  for (let i = 0; i < 1000; i++) {
    await new Promise(setImmediate);
    if (predicate()) return;
  }
  assert.fail("Timed out waiting for application state");
}

test("loads an existing quote on the first selection", async () => {
  const app = startApp({ respond: () => response([quote()]) });
  await waitFor(() => loaded(app));
  assert.deepEqual(app.requests, [1]);
  assert.equal(app.number(), 1);
});

test("a requested null slot in an HTTP 200 bucket retries a different quote number", async () => {
  const app = startApp({
    respond: id => response(id === 1 ? [null, quote("Unrelated sibling")] : [quote()])
  });
  await waitFor(() => loaded(app));
  assert.deepEqual(app.requests, [1, 2]);
  assert.equal(app.number(), 2);
  assert.deepEqual(app.seen().map(entry => entry.id), [1, 2]);
});

test("unselected null slots do not remove siblings or renumber later quotes", async () => {
  const app = startApp({
    respond: () => response([quote("First"), null, quote("Third")]),
    random: () => 0.9
  });
  await waitFor(() => loaded(app));
  assert.deepEqual(app.requests, [91]);
  assert.equal(app.number(), 291);
});

test("a missing first slot preserves the second slot's number", async () => {
  const app = startApp({
    respond: () => response([null, quote()]),
    random: () => 0.75
  });
  await waitFor(() => loaded(app));
  assert.deepEqual(app.requests, [76]);
  assert.equal(app.number(), 176);
});

test("succeeds on the fifth quote-number selection", async () => {
  const app = startApp({
    respond: (_, attempt) => response([attempt < 5 ? null : quote()])
  });
  await waitFor(() => loaded(app));
  assert.deepEqual(app.requests, [1, 2, 3, 4, 5]);
  assert.equal(app.number(), 5);
});

test("five missing requested numbers fail even though all bucket files exist", async () => {
  const app = startApp({ respond: () => response([null, quote("Unselected sibling")]) });
  await waitFor(() => failed(app));
  assert.deepEqual(app.requests, [1, 2, 3, 4, 5]);
  assert.equal(app.get("quote").hidden, true);
  assert.equal(app.seen().length, 5);
});

test("all-null buckets count toward the same five-selection limit", async () => {
  const app = startApp({ respond: () => response([null, null]) });
  await waitFor(() => failed(app));
  assert.deepEqual(app.requests, [1, 2, 3, 4, 5]);
});

test("missing files and missing quote slots share one retry budget", async () => {
  const app = startApp({
    respond: (_, attempt) => attempt % 2 ? response([], 404) : response([null])
  });
  await waitFor(() => failed(app));
  assert.deepEqual(app.requests, [1, 2, 3, 4, 5]);
});

for (const status of [403, 500]) {
  test("HTTP " + status + " is not retried", async () => {
    const app = startApp({ respond: () => response([], status) });
    await waitFor(() => failed(app));
    assert.deepEqual(app.requests, [1]);
  });
}

test("network failures are not retried", async () => {
  const app = startApp({ respond: () => { throw new Error("Network unavailable"); } });
  await waitFor(() => failed(app));
  assert.deepEqual(app.requests, [1]);
});

test("invalid JSON is not retried", async () => {
  const app = startApp({
    respond: () => ({ ok: true, json: async () => { throw new SyntaxError("Invalid JSON"); } })
  });
  await waitFor(() => failed(app));
  assert.deepEqual(app.requests, [1]);
});

test("an empty array retains existing error handling", async () => {
  const app = startApp({ respond: () => response([]) });
  await waitFor(() => failed(app));
  assert.deepEqual(app.requests, [1]);
});

test("seen-cycle reset does not select the same missing number again", async () => {
  const seen = Array.from({ length: 99 }, (_, i) => ({ id: i + 1, ts: Date.now() }));
  const app = startApp({ seen, respond: id => response([id === 100 ? null : quote()]) });
  await waitFor(() => loaded(app));
  assert.deepEqual(app.requests, [100, 1]);
  assert.equal(app.number(), 1);
});

test("failed loads persist progress past missing quote numbers across visits", async () => {
  let seen = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, ts: Date.now() }));
  const respond = id => response([id > 80 ? null : quote()]);
  for (let visit = 0; visit < 4; visit++) {
    const app = startApp({ seen, respond });
    await waitFor(() => failed(app));
    assert.deepEqual(app.requests, Array.from({ length: 5 }, (_, i) => 81 + visit * 5 + i));
    seen = app.seen();
  }
  const app = startApp({ seen, respond });
  await waitFor(() => loaded(app));
  assert.deepEqual(app.requests, [1]);
});

test("refresh starts a new bounded quote selection", async () => {
  const app = startApp({ respond: (_, attempt) => response([attempt === 1 ? quote() : null]) });
  await waitFor(() => loaded(app));
  app.get("refresh").events.click();
  await waitFor(() => failed(app));
  assert.deepEqual(app.requests, [1, 2, 3, 4, 5, 6]);
});

function queuedQuotes() {
  return Array.from({ length: 99 }, (_, i) => ({
    ...quote("Offline puzzle " + i),
    number: i + 1
  }));
}

test("offline refill retries missing numbers and queues only distinct existing quotes", async () => {
  const offline = offlineDatabase(queuedQuotes());
  const app = startApp({
    offline,
    respond: id => response(id === 1 ? [null] : [quote("New first"), quote("New second")])
  });
  await waitFor(() => loaded(app) && offline.queue.size === 100);
  assert.deepEqual(app.requests, [1, 2, 1, 2]);
  const added = [...offline.queue.values()].slice(-2).map(entry => entry.quote);
  assert.deepEqual(added.map(item => item.number), [2, 102]);
  assert.deepEqual(added.map(item => item.quote), ["New first", "New second"]);
});

test("offline refill stops silently after five missing quote numbers", async () => {
  const offline = offlineDatabase(queuedQuotes());
  const app = startApp({ offline, respond: () => response([null]) });
  await waitFor(() => loaded(app) && app.requests.length === 5);
  assert.deepEqual(app.requests, [1, 2, 3, 4, 5]);
  assert.equal(offline.queue.size, 98);
  assert.ok(loaded(app));
});

test("offline refill stops when every quote in a bucket is already queued or played", async () => {
  const offline = offlineDatabase(queuedQuotes());
  const app = startApp({ offline, respond: () => response(queuedQuotes()) });
  await waitFor(() => loaded(app) && app.requests.length === 1);
  assert.equal(offline.queue.size, 98);
  assert.ok(loaded(app));
});

test("existing offline play does not make network requests", async () => {
  const offline = offlineDatabase(queuedQuotes());
  const app = startApp({
    offline,
    online: false,
    respond: () => { throw new Error("Unexpected fetch"); }
  });
  await waitFor(() => loaded(app));
  assert.deepEqual(app.requests, []);
  assert.equal(offline.queue.size, 98);
});
