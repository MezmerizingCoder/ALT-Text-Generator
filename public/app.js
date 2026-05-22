const form = document.querySelector("#generator-form");
const imageInput = document.querySelector("#image-input");
const uploadZone = document.querySelector("#upload-zone");
const uploadLabel = document.querySelector("#upload-label");
const statusMessage = document.querySelector("#status-message");
const generateButton = document.querySelector("#generate-button");
const modeButtons = document.querySelectorAll("[data-mode]");
const singleModePanel = document.querySelector("#single-mode-panel");
const bulkModePanel = document.querySelector("#bulk-mode-panel");
const bulkImageUrls = document.querySelector("#bulk-image-urls");
const filenameCase = document.querySelector("#filename-case");
const pageContextUrl = document.querySelector("#page-context-url");
const baseAltMaxWords = document.querySelector("#base-alt-max-words");
const seoAltMaxWords = document.querySelector("#seo-alt-max-words");
const seoTitleMaxWords = document.querySelector("#seo-title-max-words");
const previewPanel = document.querySelector("#preview-panel");
const previewImage = document.querySelector("#image-preview");
const previewPlaceholder = document.querySelector("#preview-placeholder");
const originalName = document.querySelector("#original-name");
const imageDimensions = document.querySelector("#image-dimensions");
const imageSize = document.querySelector("#image-size");
const resultsGrid = document.querySelector("#results-grid");
const bulkResultsPanel = document.querySelector("#bulk-results-panel");
const bulkResultsBody = document.querySelector("#bulk-results-body");
const copyBulkJsonButton = document.querySelector("#copy-bulk-json");
const copyBulkCsvButton = document.querySelector("#copy-bulk-csv");
const downloadBulkCsvButton = document.querySelector("#download-bulk-csv");
const singleRevisePanel = document.querySelector("#single-revise-panel");
const singleRevisePrompt = document.querySelector("#single-revise-prompt");
const singleReviseButton = document.querySelector("#single-revise-button");

const resultFields = {
  imageSummary: document.querySelector("#image-summary"),
  baseAltText: document.querySelector("#base-alt-text"),
  seoAltText: document.querySelector("#seo-alt-text"),
  seoTitle: document.querySelector("#seo-title"),
  filename: document.querySelector("#seo-filename")
};

const notesList = document.querySelector("#notes-list");
const seoKeywords = document.querySelector("#seo-keywords");
const copyButtons = document.querySelectorAll("[data-copy-target]");

let selectedImage = null;
let activeMode = "single";
let latestBulkResults = [];
let currentSingleResult = null;

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setMode(button.getAttribute("data-mode"));
  });
});

imageInput.addEventListener("change", async (event) => {
  const [file] = event.target.files ?? [];
  await handleSelectedFile(file);
});

["dragenter", "dragover"].forEach((eventName) => {
  uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadZone.classList.add("is-dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadZone.classList.remove("is-dragover");
  });
});

uploadZone.addEventListener("drop", async (event) => {
  const [file] = event.dataTransfer?.files ?? [];
  if (!file) {
    return;
  }

  imageInput.files = event.dataTransfer.files;
  await handleSelectedFile(file);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  generateButton.disabled = true;
  setStatus(
    activeMode === "bulk"
      ? "Fetching image links and generating metadata for each one..."
      : "Analyzing the image and generating metadata..."
  );

  try {
    if (activeMode === "bulk") {
      const urls = parseBulkUrls(bulkImageUrls.value);

      if (urls.length === 0) {
        throw new Error("Paste at least one image URL in the bulk links box.");
      }

      const response = await fetch("/api/generate-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrls: urls,
          seoKeyword: document.querySelector("#seo-keyword").value.trim(),
          brandName: document.querySelector("#brand-name").value.trim(),
          audience: document.querySelector("#audience").value.trim(),
          tone: document.querySelector("#tone").value.trim(),
          filenameCase: filenameCase.value,
          pageContextUrl: pageContextUrl.value.trim(),
          baseAltMaxWords: parseWordLimit(baseAltMaxWords.value, 12),
          seoAltMaxWords: parseWordLimit(seoAltMaxWords.value, 20),
          seoTitleMaxWords: parseWordLimit(seoTitleMaxWords.value, 10)
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to generate bulk metadata.");
      }

      latestBulkResults = data.results;
      renderBulkResults(data.results);
      setStatus(
        `Processed ${data.processedCount} image link${data.processedCount === 1 ? "" : "s"} with ${data.model} on local Ollama.`
      );
      return;
    }

    if (!selectedImage) {
      throw new Error("Please upload an image first.");
    }

    const payload = {
      imageDataUrl: selectedImage.dataUrl,
      originalFilename: selectedImage.file.name,
      seoKeyword: document.querySelector("#seo-keyword").value.trim(),
      brandName: document.querySelector("#brand-name").value.trim(),
      audience: document.querySelector("#audience").value.trim(),
      tone: document.querySelector("#tone").value.trim(),
      filenameCase: filenameCase.value,
      pageContextUrl: pageContextUrl.value.trim(),
      baseAltMaxWords: parseWordLimit(baseAltMaxWords.value, 12),
      seoAltMaxWords: parseWordLimit(seoAltMaxWords.value, 20),
      seoTitleMaxWords: parseWordLimit(seoTitleMaxWords.value, 10)
    };

    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to generate metadata.");
    }

    renderResults(data);
    setStatus(`Metadata generated with ${data.model} on local Ollama.`);
  } catch (error) {
    setStatus(error.message || "Something went wrong while generating metadata.", true);
  } finally {
    generateButton.disabled = false;
  }
});

copyButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const targetId = button.getAttribute("data-copy-target");
    const node = document.getElementById(targetId);
    const text = node?.textContent?.trim();

    if (!text || text.includes("Generate to fill")) {
      return;
    }

    await copyText(text, button);
  });
});

copyBulkJsonButton.addEventListener("click", async () => {
  if (latestBulkResults.length === 0) {
    return;
  }

  await copyText(JSON.stringify(latestBulkResults, null, 2), copyBulkJsonButton);
});

copyBulkCsvButton.addEventListener("click", async () => {
  if (latestBulkResults.length === 0) {
    return;
  }

  await copyText(convertBulkResultsToCsv(latestBulkResults), copyBulkCsvButton);
});

downloadBulkCsvButton.addEventListener("click", () => {
  if (latestBulkResults.length === 0) {
    return;
  }

  downloadTextFile({
    text: convertBulkResultsToCsv(latestBulkResults),
    filename: buildBulkExportFilename("csv"),
    mimeType: "text/csv;charset=utf-8"
  });
});

singleReviseButton.addEventListener("click", async () => {
  if (!selectedImage || !currentSingleResult) {
    setStatus("Generate a single-image result before revising it.", true);
    return;
  }

  const revisionPrompt = singleRevisePrompt.value.trim();

  if (!revisionPrompt) {
    setStatus("Add a revision prompt before revising the result.", true);
    return;
  }

  const originalLabel = singleReviseButton.textContent;
  singleReviseButton.disabled = true;
  singleReviseButton.textContent = "Revising...";
  setStatus("Revising the single-image result...");

  try {
    const response = await fetch("/api/revise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRevisionPayload({
        revisionPrompt,
        imageDataUrl: selectedImage.dataUrl,
        originalFilename: selectedImage.file.name,
        currentResult: currentSingleResult
      }))
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to revise the single-image result.");
    }

    renderResults(data);
    singleRevisePrompt.value = "";
    setStatus(`Single-image result revised with ${data.model} on local Ollama.`);
  } catch (error) {
    setStatus(error.message || "Something went wrong while revising the result.", true);
  } finally {
    singleReviseButton.disabled = false;
    singleReviseButton.textContent = originalLabel;
  }
});

bulkResultsBody.addEventListener("click", async (event) => {
  const toggleButton = event.target.closest("[data-bulk-toggle]");

  if (toggleButton) {
    toggleBulkRevisionRow(toggleButton.getAttribute("data-bulk-toggle"));
    return;
  }

  const reviseButton = event.target.closest("[data-bulk-revise]");

  if (!reviseButton) {
    return;
  }

  const rowId = reviseButton.getAttribute("data-bulk-revise");
  const reviseRow = bulkResultsBody.querySelector(`[data-revise-row="${rowId}"]`);
  const promptField = reviseRow?.querySelector("textarea");
  const prompt = promptField?.value?.trim() || "";

  if (!prompt) {
    setStatus("Add a revision prompt before revising that row.", true);
    return;
  }

  const result = latestBulkResults.find((item) => item.rowId === rowId);

  if (!result || !result.success) {
    setStatus("Only successful bulk rows can be revised.", true);
    return;
  }

  const originalLabel = reviseButton.textContent;
  reviseButton.disabled = true;
  reviseButton.textContent = "Revising...";
  setStatus("Revising the selected bulk row...");

  try {
    const response = await fetch("/api/revise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRevisionPayload({
        revisionPrompt: prompt,
        imageUrl: result.sourceUrl,
        originalFilename: result.originalFilename || "remote-image",
        currentResult: result
      }))
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to revise this bulk row.");
    }

    latestBulkResults = latestBulkResults.map((item) =>
      item.rowId === rowId
        ? { ...item, ...data, success: true, sourceUrl: item.sourceUrl, originalFilename: item.originalFilename, rowId }
        : item
    );
    renderBulkResults(latestBulkResults);
    toggleBulkRevisionRow(rowId, true);
    const refreshedRow = bulkResultsBody.querySelector(`[data-revise-row="${rowId}"] textarea`);
    if (refreshedRow) {
      refreshedRow.value = prompt;
    }
    setStatus(`Bulk row revised with ${data.model} on local Ollama.`);
  } catch (error) {
    setStatus(error.message || "Something went wrong while revising this bulk row.", true);
  } finally {
    reviseButton.disabled = false;
    reviseButton.textContent = originalLabel;
  }
});

resetResults();
resetBulkResults();
setMode(activeMode);

async function handleSelectedFile(file) {
  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    setStatus("Please choose an image file.", true);
    return;
  }

  const dataUrl = await readFileAsDataUrl(file);
  const dimensions = await readImageDimensions(dataUrl);

  selectedImage = { file, dataUrl, dimensions };
  uploadLabel.textContent = file.name;
  originalName.textContent = file.name;
  imageDimensions.textContent = `${dimensions.width} x ${dimensions.height}`;
  imageSize.textContent = formatBytes(file.size);

  previewImage.src = dataUrl;
  previewImage.hidden = false;
  previewPlaceholder.hidden = true;

  resetResults();
  setStatus("Image ready. Add optional context and generate metadata.");
}

function setMode(mode) {
  activeMode = mode === "bulk" ? "bulk" : "single";

  modeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.getAttribute("data-mode") === activeMode);
  });

  const isBulk = activeMode === "bulk";
  bulkModePanel.hidden = !isBulk;
  singleModePanel.hidden = isBulk;
  previewPanel.hidden = isBulk;
  bulkResultsPanel.hidden = !isBulk;
  resultsGrid.hidden = isBulk;
  imageInput.required = !isBulk;
  generateButton.textContent = isBulk ? "Generate bulk metadata" : "Generate metadata";

  if (isBulk) {
    resetBulkResults();
    setStatus("Bulk mode is ready. Paste one image URL per line and generate metadata.");
  } else {
    setStatus(selectedImage ? "Image ready. Add optional context and generate metadata." : "");
  }
}

function renderResults(data) {
  currentSingleResult = normalizeResultRecord(data);
  resultFields.imageSummary.textContent = data.imageSummary;
  resultFields.baseAltText.textContent = data.baseAltText;
  resultFields.seoAltText.textContent = data.seoAltText;
  resultFields.seoTitle.textContent = data.seoTitle;
  resultFields.filename.textContent = data.filename;
  singleRevisePanel.hidden = false;

  renderKeywordChips(seoKeywords, data.usedKeywords || data.seoKeywords);

  notesList.replaceChildren();
  if (data.notes.length === 0) {
    const note = document.createElement("li");
    note.textContent = "No additional notes.";
    notesList.appendChild(note);
  } else {
    data.notes.forEach((item) => {
      const note = document.createElement("li");
      note.textContent = item;
      notesList.appendChild(note);
    });
  }
}

function resetResults() {
  currentSingleResult = null;
  resultFields.imageSummary.textContent = "No analysis yet.";
  resultFields.baseAltText.textContent = "Generate to fill this field.";
  resultFields.seoAltText.textContent = "Generate to fill this field.";
  resultFields.seoTitle.textContent = "Generate to fill this field.";
  resultFields.filename.textContent = "Generate to fill this field.";
  seoKeywords.replaceChildren();
  notesList.replaceChildren();
  singleRevisePanel.hidden = true;
  singleRevisePrompt.value = "";

  const note = document.createElement("li");
  note.textContent = "Notes will appear after analysis.";
  notesList.appendChild(note);
}

function renderBulkResults(results) {
  bulkResultsPanel.hidden = false;
  bulkResultsBody.replaceChildren();

  if (results.length === 0) {
    resetBulkResults();
    return;
  }

  results.forEach((rawResult, index) => {
    const result = normalizeResultRecord({
      ...rawResult,
      rowId: rawResult.rowId || `bulk-row-${index + 1}`
    });
    const row = document.createElement("tr");
    row.dataset.resultRow = result.rowId;

    row.appendChild(createPreviewCell(result));
    row.appendChild(createLinkCell(result.sourceUrl));
    row.appendChild(createCell(
      result.success ? "Success" : "Error",
      `bulk-status-cell ${result.success ? "bulk-status-ok" : "bulk-status-error"}`
    ));
    row.appendChild(createCell(result.baseAltText || result.error || "-", "bulk-copy-cell bulk-base-cell"));
    row.appendChild(createCell(result.seoAltText || "-", "bulk-copy-cell bulk-seo-alt-cell"));
    row.appendChild(createCell(result.seoTitle || "-", "bulk-copy-cell bulk-title-cell"));
    row.appendChild(createCell(result.filename || "-", "bulk-filename-cell"));
    row.appendChild(createKeywordsCell(result.usedKeywords || result.seoKeywords));
    row.appendChild(createBulkActionsCell(result));

    bulkResultsBody.appendChild(row);
    bulkResultsBody.appendChild(createBulkRevisionRow(result));
  });

  latestBulkResults = results.map((rawResult, index) =>
    normalizeResultRecord({
      ...rawResult,
      rowId: rawResult.rowId || `bulk-row-${index + 1}`
    })
  );
}

function resetBulkResults() {
  latestBulkResults = [];
  bulkResultsBody.replaceChildren();

  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 9;
  cell.className = "bulk-empty";
  cell.textContent = "Bulk results will appear here.";
  row.appendChild(cell);
  bulkResultsBody.appendChild(row);
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? "#a33616" : "";
}

function parseBulkUrls(value) {
  return [...new Set(
    String(value || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function parseWordLimit(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const originalLabel = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = originalLabel;
    }, 1500);
  } catch (_error) {
    setStatus("Clipboard access was blocked in this browser.", true);
  }
}

function convertBulkResultsToCsv(results) {
  const header = ["sourceUrl", "status", "usedKeywords", "baseAltText", "seoAltText", "seoTitle", "filename", "imageSummary", "notes", "error"];
  const rows = results.map((result) => [
    result.sourceUrl,
    result.success ? "success" : "error",
    (result.usedKeywords || result.seoKeywords || []).join(" | "),
    result.baseAltText || "",
    result.seoAltText || "",
    result.seoTitle || "",
    result.filename || "",
    result.imageSummary || "",
    (result.notes || []).join(" | "),
    result.error || ""
  ]);

  return [header, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadTextFile({ text, filename, mimeType }) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildBulkExportFilename(extension) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `alt-text-bulk-results-${year}${month}${day}-${hours}${minutes}.${extension}`;
}

function createCell(text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) {
    cell.className = className;
  }
  return cell;
}

function createKeywordsCell(keywords) {
  const cell = document.createElement("td");
  cell.className = "bulk-keywords-cell chips";
  renderKeywordChips(cell, keywords);
  return cell;
}

function createLinkCell(url) {
  const cell = document.createElement("td");
  cell.className = "bulk-url";

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  link.textContent = url;
  link.className = "bulk-url-link";

  cell.appendChild(link);
  return cell;
}

function createBulkActionsCell(result) {
  const cell = document.createElement("td");
  cell.className = "bulk-actions-cell";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button";
  button.textContent = result.success ? "Revise" : "Unavailable";
  button.disabled = !result.success;
  button.setAttribute("data-bulk-toggle", result.rowId);

  cell.appendChild(button);
  return cell;
}

function createBulkRevisionRow(result) {
  const row = document.createElement("tr");
  row.hidden = true;
  row.dataset.reviseRow = result.rowId;
  row.className = "bulk-revise-row";

  const cell = document.createElement("td");
  cell.colSpan = 9;

  if (!result.success) {
    cell.className = "bulk-empty";
    cell.textContent = "Only successful rows can be revised.";
    row.appendChild(cell);
    return row;
  }

  const shell = document.createElement("div");
  shell.className = "bulk-revise-shell";

  const label = document.createElement("label");
  label.className = "field field-stack";

  const span = document.createElement("span");
  span.textContent = "Revision prompt";

  const textarea = document.createElement("textarea");
  textarea.rows = 3;
  textarea.placeholder = "Example: Make the alt text sound more natural and keep only the strongest keyword.";

  label.appendChild(span);
  label.appendChild(textarea);

  const actions = document.createElement("div");
  actions.className = "revise-actions";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button revise-button";
  button.textContent = "Apply revision";
  button.setAttribute("data-bulk-revise", result.rowId);

  actions.appendChild(button);
  shell.appendChild(label);
  shell.appendChild(actions);
  cell.appendChild(shell);
  row.appendChild(cell);
  return row;
}

function createPreviewCell(result) {
  const cell = document.createElement("td");
  cell.className = "bulk-preview-cell";

  if (!result.sourceUrl) {
    cell.textContent = "-";
    return cell;
  }

  const link = document.createElement("a");
  link.href = result.sourceUrl;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  link.className = "bulk-preview-link";

  const image = document.createElement("img");
  image.src = result.sourceUrl;
  image.alt = result.baseAltText || result.seoTitle || "Bulk result preview";
  image.className = "bulk-preview-image";
  image.loading = "lazy";

  link.appendChild(image);
  cell.appendChild(link);
  return cell;
}

function renderKeywordChips(container, keywords) {
  container.replaceChildren();
  const values = Array.isArray(keywords) ? keywords.filter(Boolean) : [];

  if (values.length === 0) {
    const emptyChip = document.createElement("span");
    emptyChip.className = "chip";
    emptyChip.textContent = "No keywords used";
    container.appendChild(emptyChip);
    return;
  }

  values.forEach((keyword) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = keyword;
    container.appendChild(chip);
  });
}

function normalizeResultRecord(result) {
  return {
    ...result,
    usedKeywords: Array.isArray(result?.usedKeywords)
      ? result.usedKeywords
      : Array.isArray(result?.seoKeywords)
        ? result.seoKeywords
        : [],
    notes: Array.isArray(result?.notes) ? result.notes : []
  };
}

function buildRevisionPayload({ revisionPrompt, imageDataUrl = "", imageUrl = "", originalFilename = "image", currentResult }) {
  return {
    revisionPrompt,
    imageDataUrl,
    imageUrl,
    originalFilename,
    seoKeyword: document.querySelector("#seo-keyword").value.trim(),
    brandName: document.querySelector("#brand-name").value.trim(),
    audience: document.querySelector("#audience").value.trim(),
    tone: document.querySelector("#tone").value.trim(),
    filenameCase: filenameCase.value,
    pageContextUrl: pageContextUrl.value.trim(),
    baseAltMaxWords: parseWordLimit(baseAltMaxWords.value, 12),
    seoAltMaxWords: parseWordLimit(seoAltMaxWords.value, 20),
    seoTitleMaxWords: parseWordLimit(seoTitleMaxWords.value, 10),
    currentResult
  };
}

function toggleBulkRevisionRow(rowId, forceOpen = false) {
  const row = bulkResultsBody.querySelector(`[data-revise-row="${rowId}"]`);
  if (!row) {
    return;
  }

  const shouldOpen = forceOpen || row.hidden;
  row.hidden = !shouldOpen;

  const button = bulkResultsBody.querySelector(`[data-bulk-toggle="${rowId}"]`);
  if (button && !button.disabled) {
    button.textContent = shouldOpen ? "Hide revise" : "Revise";
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read the selected file."));
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Unable to load the selected image."));
    image.src = dataUrl;
  });
}
