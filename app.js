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
  var SETTINGS_KEY = "qd_settings";
  var WINDOW_DAYS = 30;
  var WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

  var statusEl = document.getElementById("status");
  var quoteEl = document.getElementById("quote");
  var encodedTextEl = document.getElementById("encoded-text");
  var keyboardEl = document.getElementById("keyboard");
  var hintEl = document.getElementById("hint");
  var clearAllEl = document.getElementById("clear-all");
  var settingsBtnEl = document.getElementById("settings-btn");
  var settingsOverlayEl = document.getElementById("settings-overlay");
  var settingsCloseEl = document.getElementById("settings-close");
  var settingShowErrorsEl = document.getElementById("setting-show-errors");
  var themeOptionEls = document.querySelectorAll('input[name="theme"]');
  var bannerEl = document.querySelector(".site-banner");
  var themeColorEl = document.querySelector('meta[name="theme-color"]');
  var solvedOverlayEl = document.getElementById("solved-overlay");
  var solvedQuoteEl = document.getElementById("solved-quote");
  var solvedAuthorEl = document.getElementById("solved-author");
  var solvedCloseEl = document.getElementById("solved-close");
  var currentEncodedText = "";
  var puzzleCipherLetters = [];
  var puzzleCipherLetterIndex = {};
  var selectedCipherLetter = null;
  var selectedTextPos = -1;
  var assignments = {};
  var currentCipherInverse = {};
  var currentQuote = null;
  var settings = { showErrors: false, theme: "hacker" };

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

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.showErrors === "boolean") {
          settings.showErrors = parsed.showErrors;
        }
        if (parsed && (parsed.theme === "hacker" || parsed.theme === "glitter")) {
          settings.theme = parsed.theme;
        }
      }
    } catch (e) {}
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {}
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    bannerEl.src = "assets/banner-" + theme + ".png";
    themeColorEl.content = theme === "glitter" ? "#fff4fc" : "#050d07";
  }

  function buildCipherInverse(cipher) {
    var inv = {}, k;
    for (k in cipher) {
      if (Object.prototype.hasOwnProperty.call(cipher, k)) {
        inv[cipher[k]] = k;
      }
    }
    return inv;
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
  }

  function isAsciiLetter(ch) {
    return /[A-Za-z]/.test(ch);
  }

  function buildPuzzleCipherLetters(text) {
    var seen = {};
    var letters = [];
    var i, ch, cipherLetter;
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      if (isAsciiLetter(ch)) {
        cipherLetter = ch.toUpperCase();
        if (!seen[cipherLetter]) {
          seen[cipherLetter] = true;
          letters.push(cipherLetter);
        }
      }
    }
    return letters;
  }

  function setPuzzleCipherLetters(text) {
    var i, letter;
    puzzleCipherLetters = buildPuzzleCipherLetters(text);
    puzzleCipherLetterIndex = {};
    for (i = 0; i < puzzleCipherLetters.length; i++) {
      letter = puzzleCipherLetters[i];
      puzzleCipherLetterIndex[letter] = i;
    }
  }

  // After an assignment, advance selectedCipherLetter to the next cipher letter
  // to the right of the current text position that has no assignment yet.
  function advanceSelection() {
    var len = currentEncodedText.length;
    if (!len) return;

    // Start scanning one position to the right of the current text cursor.
    var startPos = selectedTextPos >= 0 ? selectedTextPos + 1 : 0;

    // Scan forward from startPos (wrapping) for the next unfilled cipher letter.
    var i, pos, ch, cipherLetter;
    for (i = 0; i < len; i++) {
      pos = (startPos + i) % len;
      ch = currentEncodedText[pos];
      if (isAsciiLetter(ch)) {
        cipherLetter = ch.toUpperCase();
        if (!assignments[cipherLetter]) {
          selectedCipherLetter = cipherLetter;
          selectedTextPos = pos;
          return;
        }
      }
    }

    // All cipher letters are filled.
    selectedCipherLetter = null;
    selectedTextPos = -1;
  }

  function updateHintButton() {
    var i, cipherLetter;
    for (i = 0; i < puzzleCipherLetters.length; i++) {
      cipherLetter = puzzleCipherLetters[i];
      if (!assignments[cipherLetter]) {
        hintEl.disabled = false;
        return;
      }
    }
    hintEl.disabled = true;
  }

  function updateKeyboardState() {
    var selectedPlain = selectedCipherLetter
      ? assignments[selectedCipherLetter] || null
      : null;
    var buttons = keyboardEl.querySelectorAll(".keyboard-key");
    var i, button, letter, action;
    for (i = 0; i < buttons.length; i++) {
      button = buttons[i];
      action = button.getAttribute("data-action");
      if (action === "delete") {
        button.disabled = !hasAssignments();
        continue;
      }
      letter = button.getAttribute("data-letter");
      button.setAttribute(
        "data-selected",
        selectedPlain && selectedPlain === letter ? "true" : "false"
      );
      button.disabled = !selectedCipherLetter;
    }
    clearAllEl.disabled = !hasAssignments();
  }

  function hasAssignments() {
    return Object.keys(assignments).length > 0;
  }

  function selectPreviousAssigned(beforePos) {
    var len = currentEncodedText.length;
    var i, pos, ch, cipherLetter;
    for (i = 1; i <= len; i++) {
      pos = (beforePos - i + len) % len;
      ch = currentEncodedText[pos];
      if (isAsciiLetter(ch)) {
        cipherLetter = ch.toUpperCase();
        if (assignments[cipherLetter]) {
          selectedCipherLetter = cipherLetter;
          selectedTextPos = pos;
          return true;
        }
      }
    }
    return false;
  }

  function deletePreviousAssignment() {
    var startPos = selectedTextPos >= 0 ? selectedTextPos : 0;
    if (selectedCipherLetter && assignments[selectedCipherLetter]) {
      delete assignments[selectedCipherLetter];
    } else {
      if (!selectPreviousAssigned(startPos)) return;
      delete assignments[selectedCipherLetter];
      startPos = selectedTextPos;
    }
    if (!selectPreviousAssigned(startPos)) {
      selectedCipherLetter = null;
      selectedTextPos = -1;
    }
  }

  function wrapOverflowingWords() {
    var containerWidth = encodedTextEl.clientWidth;
    var words = encodedTextEl.querySelectorAll(".decoder-word");
    var i;
    for (i = 0; i < words.length; i++) {
      if (words[i].scrollWidth > containerWidth) {
        words[i].classList.add("decoder-word--break");
      }
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
        var assignedLetter = assignments[cipherLetter] || "";
        var isWrong = settings.showErrors && assignedLetter &&
          assignedLetter !== currentCipherInverse[cipherLetter];
        fill.textContent = assignedLetter;
        fill.className = "decoder-fill" + (isWrong ? " decoder-fill--error" : "");
        fill.setAttribute(
          "data-selected",
          selectedCipherLetter === cipherLetter ? "true" : "false"
        );
        fill.setAttribute("aria-label", "Set letter for " + cipherLetter);
        encoded.textContent = cipherLetter;
        fill.addEventListener("click", (function (letter, pos) {
          return function () {
            selectedCipherLetter = letter;
            selectedTextPos = pos;
            renderDecoderGrid();
            updateKeyboardState();
          };
        })(cipherLetter, i));
      } else {
        fill.disabled = true;
        fill.className += " decoder-space";
        fill.textContent = ch;
        encoded.textContent = "";
      }

      cell.appendChild(fill);
      cell.appendChild(encoded);
      wordGroup.appendChild(cell);
    }
    wrapOverflowingWords();
  }

  function createKeyboard() {
    var rows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
    var i, j, letter, button, rowEl;
    keyboardEl.textContent = "";
    for (i = 0; i < rows.length; i++) {
      rowEl = document.createElement("div");
      rowEl.className = "keyboard-row";
      for (j = 0; j < rows[i].length; j++) {
        letter = rows[i][j];
        button = document.createElement("button");
        button.type = "button";
        button.className = "keyboard-key";
        button.setAttribute("data-letter", letter);
        button.textContent = letter;
        button.addEventListener("click", (function (plainLetter) {
          return function () {
            if (!selectedCipherLetter) return;
            var cipherLetter;
            for (cipherLetter in assignments) {
              if (
                Object.prototype.hasOwnProperty.call(assignments, cipherLetter) &&
                assignments[cipherLetter] === plainLetter
              ) {
                delete assignments[cipherLetter];
              }
            }
            assignments[selectedCipherLetter] = plainLetter;
            advanceSelection();
            renderDecoderGrid();
            updateKeyboardState();
            updateHintButton();
            checkSolved();
          };
        })(letter));
        rowEl.appendChild(button);
      }
      if (i === rows.length - 1) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "keyboard-key keyboard-clear";
        button.setAttribute("data-action", "delete");
        button.setAttribute("aria-label", "Delete previous letter");
        button.textContent = "\u2715";
        button.addEventListener("click", function () {
          deletePreviousAssignment();
          renderDecoderGrid();
          updateKeyboardState();
          updateHintButton();
        });
        rowEl.appendChild(button);
      }
      keyboardEl.appendChild(rowEl);
    }
  }

  function showQuote(quote) {
    currentQuote = quote;
    var cipher = generateCipher();
    currentCipherInverse = buildCipherInverse(cipher);
    currentEncodedText = encodeText(quote.quote, cipher);
    setPuzzleCipherLetters(currentEncodedText);
    selectedCipherLetter = null;
    selectedTextPos = -1;
    assignments = {};
    renderDecoderGrid();
    updateKeyboardState();
    updateHintButton();
    statusEl.hidden = true;
    quoteEl.hidden = false;
    keyboardEl.hidden = false;
    document.body.classList.add("has-keyboard");
    hintEl.hidden = false;
    clearAllEl.hidden = false;
  }

  function loadQuote() {
    statusEl.textContent = "Loading a quote\u2026";
    statusEl.hidden = false;
    quoteEl.hidden = true;
    keyboardEl.hidden = true;
    document.body.classList.remove("has-keyboard");
    hintEl.hidden = true;
    clearAllEl.hidden = true;
    solvedOverlayEl.hidden = true;

    var now = Date.now();
    var seen = loadSeen(now);
    var bucketId = pickBucket(seen);

    seen.push({ id: bucketId, ts: now });
    writeCookie(COOKIE_NAME, JSON.stringify(seen));

    fetch(new URL("quotes/all/" + bucketId + ".json", document.baseURI), {
      cache: "no-store"
    })
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

  hintEl.addEventListener("click", function () {
    var candidates = [];
    var i, cipherLetter;
    for (i = 0; i < puzzleCipherLetters.length; i++) {
      cipherLetter = puzzleCipherLetters[i];
      if (!assignments[cipherLetter]) {
        candidates.push(cipherLetter);
      }
    }
    if (candidates.length === 0) return;
    var pick = candidates[Math.floor(Math.random() * candidates.length)];
    assignments[pick] = currentCipherInverse[pick];
    renderDecoderGrid();
    updateKeyboardState();
    updateHintButton();
    checkSolved();
  });

  function checkSolved() {
    var i, cipherLetter;
    for (i = 0; i < puzzleCipherLetters.length; i++) {
      cipherLetter = puzzleCipherLetters[i];
      if (assignments[cipherLetter] !== currentCipherInverse[cipherLetter]) {
        return;
      }
    }
    openSolvedPanel();
  }

  function openSolvedPanel() {
    solvedQuoteEl.textContent = currentQuote.quote;
    solvedAuthorEl.textContent = currentQuote.author;
    solvedOverlayEl.hidden = false;
    solvedCloseEl.focus();
  }

  function closeSolvedPanel() {
    solvedOverlayEl.hidden = true;
  }

  function openSettings() {
    var i;
    settingShowErrorsEl.checked = settings.showErrors;
    for (i = 0; i < themeOptionEls.length; i++) {
      themeOptionEls[i].checked = themeOptionEls[i].value === settings.theme;
    }
    settingsOverlayEl.hidden = false;
    settingsBtnEl.setAttribute("aria-expanded", "true");
    settingsCloseEl.focus();
  }

  function closeSettings() {
    settingsOverlayEl.hidden = true;
    settingsBtnEl.setAttribute("aria-expanded", "false");
    settingsBtnEl.focus();
  }

  solvedCloseEl.addEventListener("click", closeSolvedPanel);
  solvedOverlayEl.addEventListener("click", function (e) {
    if (e.target === solvedOverlayEl) closeSolvedPanel();
  });

  settingsBtnEl.addEventListener("click", openSettings);
  settingsCloseEl.addEventListener("click", closeSettings);
  settingsOverlayEl.addEventListener("click", function (e) {
    if (e.target === settingsOverlayEl) closeSettings();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (!solvedOverlayEl.hidden) closeSolvedPanel();
      else if (!settingsOverlayEl.hidden) closeSettings();
    }
  });
  settingShowErrorsEl.addEventListener("change", function () {
    settings.showErrors = settingShowErrorsEl.checked;
    saveSettings();
    if (!quoteEl.hidden) renderDecoderGrid();
  });
  Array.prototype.forEach.call(themeOptionEls, function (option) {
    option.addEventListener("change", function () {
      if (!option.checked) return;
      settings.theme = option.value;
      applyTheme(settings.theme);
      saveSettings();
    });
  });

  clearAllEl.addEventListener("click", function () {
    assignments = {};
    renderDecoderGrid();
    updateKeyboardState();
    updateHintButton();
  });
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(function () {
      if (!quoteEl.hidden) wrapOverflowingWords();
    }).observe(encodedTextEl);
  }
  createKeyboard();
  loadSettings();
  applyTheme(settings.theme);
  loadQuote();
})();
