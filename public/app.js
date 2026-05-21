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
          filenameCase: filenameCase.value
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
      filenameCase: filenameCase.value
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
  bulkResultsPanel.hidden = !isBulk;
  resultsGrid.hidden = isBulk;
  imageInput.required = !isBulk;

  if (isBulk) {
    resetBulkResults();
    setStatus("Bulk mode is ready. Paste one image URL per line and generate metadata.");
  } else {
    setStatus(selectedImage ? "Image ready. Add optional context and generate metadata." : "");
  }
}

function renderResults(data) {
  resultFields.imageSummary.textContent = data.imageSummary;
  resultFields.baseAltText.textContent = data.baseAltText;
  resultFields.seoAltText.textContent = data.seoAltText;
  resultFields.seoTitle.textContent = data.seoTitle;
  resultFields.filename.textContent = data.filename;

  seoKeywords.replaceChildren();
  if (data.seoKeywords.length === 0) {
    const emptyChip = document.createElement("span");
    emptyChip.className = "chip";
    emptyChip.textContent = "No keywords returned";
    seoKeywords.appendChild(emptyChip);
  } else {
    data.seoKeywords.forEach((keyword) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = keyword;
      seoKeywords.appendChild(chip);
    });
  }

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
  resultFields.imageSummary.textContent = "No analysis yet.";
  resultFields.baseAltText.textContent = "Generate to fill this field.";
  resultFields.seoAltText.textContent = "Generate to fill this field.";
  resultFields.seoTitle.textContent = "Generate to fill this field.";
  resultFields.filename.textContent = "Generate to fill this field.";
  seoKeywords.replaceChildren();
  notesList.replaceChildren();

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

  results.forEach((result) => {
    const row = document.createElement("tr");

    row.appendChild(createPreviewCell(result));
    row.appendChild(createLinkCell(result.sourceUrl));
    row.appendChild(createCell(result.success ? "Success" : "Error", result.success ? "bulk-status-ok" : "bulk-status-error"));
    row.appendChild(createCell(result.baseAltText || result.error || "-"));
    row.appendChild(createCell(result.seoAltText || "-"));
    row.appendChild(createCell(result.seoTitle || "-"));
    row.appendChild(createCell(result.filename || "-"));

    bulkResultsBody.appendChild(row);
  });
}

function resetBulkResults() {
  latestBulkResults = [];
  bulkResultsBody.replaceChildren();

  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 7;
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
  const header = ["sourceUrl", "status", "baseAltText", "seoAltText", "seoTitle", "filename", "imageSummary", "error"];
  const rows = results.map((result) => [
    result.sourceUrl,
    result.success ? "success" : "error",
    result.baseAltText || "",
    result.seoAltText || "",
    result.seoTitle || "",
    result.filename || "",
    result.imageSummary || "",
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
