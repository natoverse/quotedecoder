(function () {
  "use strict";

  var N_BUCKETS = 100;
  var PAGE_SIZE = 100;
  var LOAD_CONCURRENCY = 6;
  var MAX_ISSUE_URL_LENGTH = 2000;
  var MAX_ISSUE_BODY_LENGTH = 60000;
  var NEW_ISSUE_URL = "https://github.com/natoverse/quotedecoder/issues/new";
  var buckets = new Array(N_BUCKETS);
  var quotes = [];
  var filteredQuotes = [];
  var selected = new Set();
  var page = 1;

  var statusEl = document.getElementById("review-status");
  var retryEl = document.getElementById("review-retry");
  var controlsEl = document.getElementById("review-controls");
  var tagEl = document.getElementById("review-tag");
  var selectedOnlyEl = document.getElementById("review-selected-only");
  var selectPageEl = document.getElementById("review-select-page");
  var selectionCountEl = document.getElementById("review-selection-count");
  var clearEl = document.getElementById("review-clear");
  var removeEl = document.getElementById("review-remove");
  var issueFallbackEl = document.getElementById("review-issue-fallback");
  var issueHelpEl = document.getElementById("review-issue-help");
  var issueBodyEl = document.getElementById("review-issue-body");
  var previousEls = document.querySelectorAll(".review-previous");
  var nextEls = document.querySelectorAll(".review-next");
  var pageEl = document.getElementById("review-page");
  var pageCountEl = document.getElementById("review-page-count");
  var bottomPagesEl = document.getElementById("review-bottom-pages");
  var bottomPageCountEl = document.getElementById("review-bottom-page-count");
  var resultsEl = document.getElementById("review-results");
  var listEl = document.getElementById("review-quotes");

  function pageQuotes() {
    return filteredQuotes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }

  function updateSelection() {
    var visible = pageQuotes();
    var checked = visible.filter(function (quote) {
      return selected.has(quote.number);
    }).length;
    selectPageEl.disabled = visible.length === 0;
    selectPageEl.checked = visible.length > 0 && checked === visible.length;
    selectPageEl.indeterminate = checked > 0 && checked < visible.length;
    selectionCountEl.textContent = selected.size + " selected across all pages and tags";
    clearEl.disabled = selected.size === 0;
    removeEl.hidden = selected.size === 0;
    removeEl.removeAttribute("href");
    issueFallbackEl.hidden = true;
    issueBodyEl.value = "";
    if (selected.size === 0) return;

    var numbers = Array.from(selected).sort(function (a, b) { return a - b; });
    var body = "Please remove the following " + numbers.length + " quotes from Quote Decoder.\n\n" +
      "Quote numbers (using the app's quotes/all/ numbering):\n\n" +
      numbers.join(", ");
    var url = new URL(NEW_ISSUE_URL);
    url.searchParams.set("title", "Remove quotes: " + numbers.length + " selected");
    var titleOnlyUrl = url.href;
    url.searchParams.set("body", body);
    removeEl.textContent = "Remove quotes (opens GitHub)";
    if (url.href.length <= MAX_ISSUE_URL_LENGTH) {
      removeEl.href = url.href;
    } else {
      issueFallbackEl.hidden = false;
      issueBodyEl.value = body;
      if (body.length > MAX_ISSUE_BODY_LENGTH) {
        removeEl.hidden = true;
        issueHelpEl.textContent = "This selection exceeds GitHub's issue size limit. " +
          "Select fewer quotes and submit smaller batches.";
      } else {
        issueHelpEl.textContent = "This batch is too large to prefill a GitHub URL. " +
          "Copy the entire issue body below, then open the issue and paste it before submitting.";
        removeEl.href = titleOnlyUrl;
        removeEl.textContent = "Open issue and paste batch (opens GitHub)";
      }
    }
  }

  function appendText(parent, className, text) {
    var span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    parent.appendChild(span);
    return span;
  }

  function renderPage() {
    var pageCount = Math.max(1, Math.ceil(filteredQuotes.length / PAGE_SIZE));
    page = Math.max(1, Math.min(page, pageCount));
    pageEl.value = page;
    pageEl.max = pageCount;
    pageCountEl.textContent = "of " + pageCount;
    bottomPageCountEl.textContent = "Page " + page + " of " + pageCount;
    previousEls.forEach(function (button) { button.disabled = page === 1; });
    nextEls.forEach(function (button) { button.disabled = page === pageCount; });
    var start = (page - 1) * PAGE_SIZE;
    resultsEl.textContent = filteredQuotes.length === 0 ? "No quotes match these filters." :
      "Showing " + (start + 1) + "–" + Math.min(start + PAGE_SIZE, filteredQuotes.length) +
      " of " + filteredQuotes.length + " quotes";

    var fragment = document.createDocumentFragment();
    pageQuotes().forEach(function (quote) {
      var item = document.createElement("li");
      item.className = "review-quote";
      var label = document.createElement("label");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.number = quote.number;
      checkbox.checked = selected.has(quote.number);
      checkbox.setAttribute("aria-label", "Select quote #" + quote.number);
      label.appendChild(checkbox);
      var content = document.createElement("span");
      appendText(content, "review-quote-number", "#" + quote.number);
      appendText(content, "review-quote-text", quote.quote);
      appendText(content, "review-quote-author", "— " + quote.author);
      var tags = document.createElement("span");
      tags.className = "review-tags";
      tags.setAttribute("aria-label", "Tags");
      (quote.tags.length ? quote.tags : ["Untagged"]).forEach(function (tag) {
        appendText(tags, "review-tag", tag);
      });
      content.appendChild(tags);
      label.appendChild(content);
      item.appendChild(label);
      fragment.appendChild(item);
    });
    listEl.replaceChildren(fragment);
    updateSelection();
  }

  function filterQuotes() {
    filteredQuotes = quotes.filter(function (quote) {
      return (!tagEl.value || quote.tags.indexOf(tagEl.value) !== -1) &&
        (!selectedOnlyEl.checked || selected.has(quote.number));
    });
    renderPage();
  }

  function populateTags() {
    var counts = new Map();
    quotes.forEach(function (quote) {
      quote.tags.forEach(function (tag) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    Array.from(counts.keys()).sort().forEach(function (tag) {
      var option = document.createElement("option");
      option.value = tag;
      option.textContent = tag + " (" + counts.get(tag) + ")";
      tagEl.appendChild(option);
    });
  }

  function loadQuotes() {
    retryEl.hidden = true;
    statusEl.textContent = "Loading all quote buckets…";
    var nextBucket = 1;
    var loaded = buckets.filter(function (bucket) { return !!bucket; }).length;
    var loadError = null;

    function loadNextBucket() {
      if (loadError || nextBucket > N_BUCKETS) return Promise.resolve();
      var bucketId = nextBucket++;
      if (buckets[bucketId - 1]) return loadNextBucket();
      return fetch(new URL("quotes/all/" + bucketId + ".json", document.baseURI), {
        cache: "no-store"
      }).then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      }).then(function (data) {
        if (!Array.isArray(data)) throw new Error("Invalid bucket");
        buckets[bucketId - 1] = data.map(function (quote, index) {
          if (!quote || typeof quote.quote !== "string" || typeof quote.author !== "string" ||
              !Array.isArray(quote.tags) ||
              !quote.tags.every(function (tag) { return typeof tag === "string"; })) {
            throw new Error("Invalid quote");
          }
          return {
            number: index * N_BUCKETS + bucketId,
            quote: quote.quote,
            author: quote.author,
            tags: quote.tags
          };
        });
        loaded++;
        statusEl.textContent = "Loading quote buckets: " + loaded + " of " + N_BUCKETS + "…";
        return loadNextBucket();
      }).catch(function () {
        loadError = "Could not load quote bucket " + bucketId +
          ". Check your connection and retry; no incomplete list will be shown.";
      });
    }

    var workers = [];
    for (var i = 0; i < LOAD_CONCURRENCY; i++) workers.push(loadNextBucket());
    Promise.all(workers).then(function () {
      if (loadError) {
        statusEl.textContent = loadError;
        retryEl.hidden = false;
        return;
      }
      quotes = [].concat.apply([], buckets).sort(function (a, b) {
        return a.number - b.number;
      });
      populateTags();
      statusEl.textContent = quotes.length + " quotes loaded.";
      controlsEl.hidden = false;
      bottomPagesEl.hidden = false;
      filterQuotes();
    });
  }

  listEl.addEventListener("change", function (event) {
    var checkbox = event.target;
    if (!checkbox.matches("input[data-number]")) return;
    var number = Number(checkbox.dataset.number);
    if (checkbox.checked) selected.add(number);
    else selected.delete(number);
    if (selectedOnlyEl.checked) filterQuotes();
    else updateSelection();
  });
  selectPageEl.addEventListener("change", function () {
    var checked = selectPageEl.checked;
    pageQuotes().forEach(function (quote) {
      if (checked) selected.add(quote.number);
      else selected.delete(quote.number);
    });
    filterQuotes();
  });
  clearEl.addEventListener("click", function () {
    selected.clear();
    filterQuotes();
  });
  [tagEl, selectedOnlyEl].forEach(function (control) {
    control.addEventListener("change", function () {
      page = 1;
      filterQuotes();
    });
  });
  previousEls.forEach(function (button) {
    button.addEventListener("click", function () {
      page--;
      renderPage();
      controlsEl.scrollIntoView();
    });
  });
  nextEls.forEach(function (button) {
    button.addEventListener("click", function () {
      page++;
      renderPage();
      controlsEl.scrollIntoView();
    });
  });
  pageEl.addEventListener("change", function () {
    var requestedPage = Number(pageEl.value);
    if (Number.isInteger(requestedPage)) page = requestedPage;
    renderPage();
  });
  retryEl.addEventListener("click", loadQuotes);
  loadQuotes();
})();
