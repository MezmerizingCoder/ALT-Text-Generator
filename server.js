import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const model = process.env.OLLAMA_MODEL || "gemma3:4b";

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "base_alt_text",
    "seo_alt_text",
    "seo_title",
    "filename_stem",
    "image_summary",
    "seo_keywords",
    "notes"
  ],
  properties: {
    base_alt_text: {
      type: "string",
      description: "Concise accessible alt text, ideally under 125 characters."
    },
    seo_alt_text: {
      type: "string",
      description: "A slightly richer alt text that stays natural and descriptive."
    },
    seo_title: {
      type: "string",
      description: "A concise page or asset title related to the image."
    },
    filename_stem: {
      type: "string",
      description: "A lowercase hyphenated filename stem without the extension."
    },
    image_summary: {
      type: "string",
      description: "One-sentence summary of the image content."
    },
    seo_keywords: {
      type: "array",
      items: { type: "string" },
      description: "Relevant SEO keywords grounded in the image."
    },
    notes: {
      type: "array",
      items: { type: "string" },
      description: "Short notes about ambiguity, visible text, or SEO constraints."
    }
  }
};

app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));

app.get("/api/health", async (_req, res) => {
  try {
    const ollama = await fetchJson(`${ollamaUrl}/api/tags`);

    res.json({
      ok: true,
      configured: true,
      model,
      provider: "ollama",
      availableModels: Array.isArray(ollama.models) ? ollama.models.map((item) => item.name) : []
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      configured: false,
      model,
      provider: "ollama",
      error: `Could not reach Ollama at ${ollamaUrl}. Make sure Ollama is installed and running.`
    });
  }
});

app.post("/api/generate", async (req, res) => {
  const {
    imageDataUrl,
    originalFilename = "image",
    seoKeyword = "",
    brandName = "",
    audience = "",
    tone = ""
  } = req.body ?? {};

  if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return res.status(400).json({
      error: "Please upload an image before requesting generated metadata."
    });
  }

  try {
    const prompt = buildPrompt({
      originalFilename,
      seoKeyword,
      brandName,
      audience,
      tone
    });

    const response = await fetchJson(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: responseSchema,
        options: {
          temperature: 0
        },
        messages: [
          {
            role: "user",
            content: prompt,
            images: [extractBase64Image(imageDataUrl)]
          }
        ]
      })
    });

    const payload = parseStructuredOutput(response);
    const extension = inferExtension(imageDataUrl, originalFilename);

    res.json({
      imageSummary: payload.image_summary.trim(),
      baseAltText: cleanupSentence(payload.base_alt_text, 125),
      seoAltText: cleanupSentence(payload.seo_alt_text, 180),
      seoTitle: cleanupSentence(payload.seo_title, 70),
      filename: `${sanitizeFilename(payload.filename_stem)}${extension}`,
      seoKeywords: dedupeStrings(payload.seo_keywords),
      notes: dedupeStrings(payload.notes),
      model,
      provider: "ollama"
    });
  } catch (error) {
    console.error(error);

    const message = resolveGenerationError(error);

    res.status(500).json({ error: message });
  }
});

app.listen(port, () => {
  console.log(`Alt text generator running at http://localhost:${port}`);
});

function buildPrompt({ originalFilename, seoKeyword, brandName, audience, tone }) {
  const guidance = [
    "Analyze the uploaded image and produce accessible and SEO-conscious image metadata.",
    "Describe only what is visually supported by the image.",
    "Keep the base alt text concise, specific, and accessibility-first.",
    "Make the SEO alt text natural and readable. Include the SEO keyword only if it genuinely fits the visible content.",
    "Create an SEO title that feels useful for an asset library or CMS.",
    "Create a filename stem using lowercase words separated by hyphens.",
    "Do not stuff keywords. Avoid vague filler like 'image of' unless necessary for clarity.",
    "If there is visible text in the image, mention it only when it matters to understanding the image.",
    "Return valid JSON that matches the provided schema."
  ];

  const context = [
    `Original filename: ${originalFilename}`,
    `Preferred SEO keyword: ${seoKeyword || "None provided"}`,
    `Brand or site context: ${brandName || "None provided"}`,
    `Audience: ${audience || "General audience"}`,
    `Tone: ${tone || "Clear and professional"}`
  ];

  return `${guidance.join("\n")}\n\nContext:\n${context.join("\n")}`;
}

function parseStructuredOutput(response) {
  const text = response?.message?.content || response?.response;

  if (!text) {
    throw new Error("Model returned no text output.");
  }

  return JSON.parse(text);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Request failed with status ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return response.json();
}

function extractBase64Image(imageDataUrl) {
  const match = String(imageDataUrl).match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);

  if (!match) {
    throw new Error("The uploaded image format is not valid base64 data.");
  }

  return match[1];
}

function cleanupSentence(value, maxLength) {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLength - 3).trimEnd()}...`;
}

function sanitizeFilename(value) {
  const cleaned = String(value || "image")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return cleaned || "image";
}

function dedupeStrings(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function inferExtension(imageDataUrl, originalFilename) {
  const mimeMatch = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  const nameMatch = String(originalFilename).match(/(\.[a-zA-Z0-9]+)$/);

  if (nameMatch) {
    return nameMatch[1].toLowerCase();
  }

  const mime = mimeMatch?.[1]?.toLowerCase();
  const byMime = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };

  return byMime[mime] || ".png";
}

function resolveGenerationError(error) {
  if (error?.status === 404) {
    return `The Ollama model "${model}" is not installed. Run "ollama pull ${model}" and try again.`;
  }

  if (error?.status === 400) {
    return "Ollama could not process this image request. Try a smaller image or a different file.";
  }

  if (error?.cause?.code === "ECONNREFUSED" || error?.message?.includes("fetch failed")) {
    return `Could not reach Ollama at ${ollamaUrl}. Start Ollama and try again.`;
  }

  return "Something went wrong while generating metadata locally with Ollama. Check the server logs and try again.";
}
