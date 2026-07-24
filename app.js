/**
 * Quote Decoder — phase 1: read-only quote display.
 *
 * On each visit we pick a random bucket from quotes/all/ (1..N_BUCKETS), then a
 * random quote inside it. To avoid repeats we remember which buckets were shown
 * in a cookie for 30 days; because buckets are randomly shuffled, never
 * repeating a bucket within the window guarantees we never repeat a quote.
 */
(function () {
  "use strict";

  var N_BUCKETS = 100;
  var COOKIE_NAME = "qd_seen";
  var WINDOW_DAYS = 30;
  var WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

  var statusEl = document.getElementById("status");
  var quoteEl = document.getElementById("quote");
  var quoteTextEl = document.getElementById("quote-text");
  var quoteAuthorEl = document.getElementById("quote-author");
  var nextEl = document.getElementById("next");

  function readCookie(name) {
    var prefix = name + "=";
    var parts = document.cookie ? document.cookie.split("; ") : [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf(prefix) === 0) {
        return decodeURIComponent(parts[i].slice(prefix.length));
      }
    }
    return null;
  }

  function writeCookie(name, value) {
    document.cookie =
      name +
      "=" +
      encodeURIComponent(value) +
      "; max-age=" +
      Math.floor(WINDOW_MS / 1000) +
      "; path=/; samesite=lax";
  }

  // Returns the list of { id, ts } buckets seen within the window, pruning old ones.
  function loadSeen(now) {
    var raw = readCookie(COOKIE_NAME);
    if (!raw) return [];
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(function (entry) {
      return (
        entry &&
        typeof entry.id === "number" &&
        typeof entry.ts === "number" &&
        now - entry.ts < WINDOW_MS
      );
    });
  }

  // Pick a bucket id not seen within the window; if all are exhausted, reset.
  function pickBucket(seen) {
    var seenIds = {};
    seen.forEach(function (entry) {
      seenIds[entry.id] = true;
    });

    var available = [];
    for (var id = 1; id <= N_BUCKETS; id++) {
      if (!seenIds[id]) available.push(id);
    }
    if (available.length === 0) {
      // Every bucket seen within the window: start a fresh cycle.
      seen.length = 0;
      for (var j = 1; j <= N_BUCKETS; j++) available.push(j);
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  function showError(message) {
    statusEl.textContent = message;
    statusEl.hidden = false;
    nextEl.hidden = false;
  }

  function showQuote(quote) {
    quoteTextEl.textContent = quote.quote;
    quoteAuthorEl.textContent = quote.author || "Unknown";
    quoteAuthorEl.hidden = !quote.author;
    statusEl.hidden = true;
    quoteEl.hidden = false;
    nextEl.hidden = false;
  }

  function loadQuote() {
    statusEl.textContent = "Loading a quote\u2026";
    statusEl.hidden = false;
    quoteEl.hidden = true;
    nextEl.hidden = true;

    var now = Date.now();
    var seen = loadSeen(now);
    var bucketId = pickBucket(seen);

    seen.push({ id: bucketId, ts: now });
    writeCookie(COOKIE_NAME, JSON.stringify(seen));

    fetch("quotes/all/" + bucketId + ".json", { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      })
      .then(function (quotes) {
        if (!Array.isArray(quotes) || quotes.length === 0) {
          throw new Error("Empty bucket");
        }
        var quote = quotes[Math.floor(Math.random() * quotes.length)];
        showQuote(quote);
      })
      .catch(function () {
        showError("Sorry, we couldn't load a quote. Please try again.");
      });
  }

  nextEl.addEventListener("click", loadQuote);
  loadQuote();
})();
