/**
 * Quote Decoder — phase 2: read-only quote display with Caesar cipher encoding.
 *
 * On each visit we pick a random bucket from quotes/all/ (1..N_BUCKETS), then a
 * random quote inside it. To avoid repeats we remember which buckets were shown
 * in a cookie for 30 days; because buckets are randomly shuffled, never
 * repeating a bucket within the window guarantees we never repeat a quote.
 *
 * Each quote is also encoded with a randomly generated substitution cipher
 * (a derangement of the alphabet: every letter maps to a different letter).
 */
(function () {
  "use strict";

  var N_BUCKETS = 100;
  var COOKIE_NAME = "qd_seen";
  var WINDOW_DAYS = 30;
  var WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

  var statusEl = document.getElementById("status");
  var quoteEl = document.getElementById("quote");
  var encodedTextEl = document.getElementById("encoded-text");
  var keyboardEl = document.getElementById("keyboard");
  var nextEl = document.getElementById("next");
  var currentEncodedText = "";
  var selectedCipherLetter = null;
  var assignments = {};

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

  // Build a random substitution cipher where no letter maps to itself.
  // Uses Sattolo's algorithm to produce a single-cycle permutation (always a derangement).
  function generateCipher() {
    var alpha = "abcdefghijklmnopqrstuvwxyz";
    var perm = [], i, j, tmp;
    for (i = 0; i < 26; i++) perm[i] = i;
    for (i = 25; i > 0; i--) {
      j = Math.floor(Math.random() * i); // [0, i-1] ensures no fixed points
      tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
    }
    var map = {};
    for (i = 0; i < 26; i++) {
      map[alpha[i]] = alpha[perm[i]];
      map[alpha[i].toUpperCase()] = alpha[perm[i]].toUpperCase();
    }
    return map;
  }

  // Apply a substitution cipher to text, preserving non-letter characters.
  function encodeText(text, cipher) {
    var result = "", i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      result += Object.prototype.hasOwnProperty.call(cipher, ch) ? cipher[ch] : ch;
    }
    return result;
  }

  function showError(message) {
    statusEl.textContent = message;
    statusEl.hidden = false;
    nextEl.hidden = false;
  }

  function isAsciiLetter(ch) {
    return /[A-Za-z]/.test(ch);
  }

  function usedPlainLetters(exceptCipher) {
    var used = {};
    var cipher;
    for (cipher in assignments) {
      if (
        Object.prototype.hasOwnProperty.call(assignments, cipher) &&
        cipher !== exceptCipher
      ) {
        used[assignments[cipher]] = true;
      }
    }
    return used;
  }

  function updateKeyboardState() {
    var used = usedPlainLetters(selectedCipherLetter);
    var selectedPlain = selectedCipherLetter
      ? assignments[selectedCipherLetter] || null
      : null;
    var buttons = keyboardEl.querySelectorAll(".keyboard-key");
    var i, button, letter, isClear;
    for (i = 0; i < buttons.length; i++) {
      button = buttons[i];
      isClear = button.getAttribute("data-action") === "clear";
      if (isClear) {
        button.disabled = !(selectedCipherLetter && selectedPlain);
        continue;
      }
      letter = button.getAttribute("data-letter");
      button.setAttribute(
        "data-selected",
        selectedPlain && selectedPlain === letter ? "true" : "false"
      );
      button.disabled =
        !selectedCipherLetter || (used[letter] && selectedPlain !== letter);
    }
  }

  function renderDecoderGrid() {
    var i, ch, cipherLetter, cell, fill, encoded, wordGroup;
    encodedTextEl.textContent = "";
    wordGroup = null;
    for (i = 0; i < currentEncodedText.length; i++) {
      ch = currentEncodedText[i];

      if (ch === " ") {
        wordGroup = null;
        continue;
      }

      if (!wordGroup) {
        wordGroup = document.createElement("div");
        wordGroup.className = "decoder-word";
        encodedTextEl.appendChild(wordGroup);
      }

      cell = document.createElement("div");
      cell.className = "decoder-cell";

      fill = document.createElement("button");
      fill.type = "button";
      fill.className = "decoder-fill";

      encoded = document.createElement("span");
      encoded.className = "decoder-encoded";

      if (isAsciiLetter(ch)) {
        cipherLetter = ch.toUpperCase();
        fill.textContent = assignments[cipherLetter] || "";
        fill.setAttribute(
          "data-selected",
          selectedCipherLetter === cipherLetter ? "true" : "false"
        );
        fill.setAttribute("aria-label", "Set letter for " + cipherLetter);
        encoded.textContent = cipherLetter;
        fill.addEventListener("click", (function (letter) {
          return function () {
            selectedCipherLetter = letter;
            renderDecoderGrid();
            updateKeyboardState();
          };
        })(cipherLetter));
      } else {
        fill.disabled = true;
        fill.className += " decoder-space";
        fill.textContent = "";
        encoded.textContent = ch;
      }

      cell.appendChild(fill);
      cell.appendChild(encoded);
      wordGroup.appendChild(cell);
    }
  }

  function createKeyboard() {
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    var i, letter, button;
    keyboardEl.textContent = "";
    for (i = 0; i < letters.length; i++) {
      letter = letters[i];
      button = document.createElement("button");
      button.type = "button";
      button.className = "keyboard-key";
      button.setAttribute("data-letter", letter);
      button.textContent = letter;
      button.addEventListener("click", (function (plainLetter) {
        return function () {
          if (!selectedCipherLetter) return;
          assignments[selectedCipherLetter] = plainLetter;
          renderDecoderGrid();
          updateKeyboardState();
        };
      })(letter));
      keyboardEl.appendChild(button);
    }

    button = document.createElement("button");
    button.type = "button";
    button.className = "keyboard-key keyboard-clear";
    button.setAttribute("data-action", "clear");
    button.setAttribute("aria-label", "Clear selected letter");
    button.textContent = "\u2715";
    button.addEventListener("click", function () {
      if (!selectedCipherLetter) return;
      delete assignments[selectedCipherLetter];
      renderDecoderGrid();
      updateKeyboardState();
    });
    keyboardEl.appendChild(button);
  }

  function showQuote(quote) {
    var cipher = generateCipher();
    currentEncodedText = encodeText(quote.quote, cipher);
    selectedCipherLetter = null;
    assignments = {};
    renderDecoderGrid();
    updateKeyboardState();
    statusEl.hidden = true;
    quoteEl.hidden = false;
    keyboardEl.hidden = false;
    document.body.classList.add("has-keyboard");
    nextEl.hidden = false;
  }

  function loadQuote() {
    statusEl.textContent = "Loading a quote\u2026";
    statusEl.hidden = false;
    quoteEl.hidden = true;
    keyboardEl.hidden = true;
    document.body.classList.remove("has-keyboard");
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
  createKeyboard();
  loadQuote();
})();
