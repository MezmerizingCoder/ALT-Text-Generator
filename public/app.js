const form = document.querySelector("#generator-form");
const imageInput = document.querySelector("#image-input");
const uploadZone = document.querySelector("#upload-zone");
const uploadLabel = document.querySelector("#upload-label");
const statusMessage = document.querySelector("#status-message");
const generateButton = document.querySelector("#generate-button");
const previewImage = document.querySelector("#image-preview");
const previewPlaceholder = document.querySelector("#preview-placeholder");
const originalName = document.querySelector("#original-name");
const imageDimensions = document.querySelector("#image-dimensions");
const imageSize = document.querySelector("#image-size");

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

  if (!selectedImage) {
    setStatus("Please upload an image first.", true);
    return;
  }

  generateButton.disabled = true;
  setStatus("Analyzing the image and generating metadata...");

  try {
    const payload = {
      imageDataUrl: selectedImage.dataUrl,
      originalFilename: selectedImage.file.name,
      seoKeyword: document.querySelector("#seo-keyword").value.trim(),
      brandName: document.querySelector("#brand-name").value.trim(),
      audience: document.querySelector("#audience").value.trim(),
      tone: document.querySelector("#tone").value.trim()
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

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? "#a33616" : "";
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
