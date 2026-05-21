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

const refinementSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "base_alt_text",
    "seo_alt_text",
    "seo_title",
    "filename_stem"
  ],
  properties: {
    base_alt_text: {
      type: "string",
      description: "Natural accessible alt text."
    },
    seo_alt_text: {
      type: "string",
      description: "Natural SEO-aware alt text."
    },
    seo_title: {
      type: "string",
      description: "Natural SEO title."
    },
    filename_stem: {
      type: "string",
      description: "Lowercase hyphenated filename stem without extension."
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
  } catch (_error) {
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
    tone = "",
    filenameCase = "lowercase"
  } = req.body ?? {};

  if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return res.status(400).json({
      error: "Please upload an image before requesting generated metadata."
    });
  }

  try {
    const generated = await generateMetadata({
      imageDataUrl,
      originalFilename,
      seoKeyword,
      brandName,
      audience,
      tone,
      filenameCase
    });

    res.json(generated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: resolveGenerationError(error) });
  }
});

app.post("/api/generate-bulk", async (req, res) => {
  const {
    imageUrls,
    seoKeyword = "",
    brandName = "",
    audience = "",
    tone = "",
    filenameCase = "lowercase"
  } = req.body ?? {};

  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return res.status(400).json({
      error: "Paste at least one image URL before running the bulk generator."
    });
  }

  if (imageUrls.length > 25) {
    return res.status(400).json({
      error: "Please process 25 image URLs or fewer per batch."
    });
  }

  try {
    const results = [];

    for (const rawUrl of imageUrls) {
      const sourceUrl = String(rawUrl || "").trim();

      if (!sourceUrl) {
        continue;
      }

      try {
        const remoteImage = await fetchRemoteImageAsDataUrl(sourceUrl);
        const generated = await generateMetadata({
          imageDataUrl: remoteImage.imageDataUrl,
          originalFilename: remoteImage.originalFilename,
          seoKeyword,
          brandName,
          audience,
          tone,
          filenameCase
        });

        results.push({
          success: true,
          sourceUrl,
          ...generated
        });
      } catch (error) {
        results.push({
          success: false,
          sourceUrl,
          error: resolveBulkItemError(error)
        });
      }
    }

    res.json({
      processedCount: results.length,
      results,
      model,
      provider: "ollama"
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Something went wrong while running the bulk generator. Check the server logs and try again."
    });
  }
});

app.listen(port, () => {
  console.log(`Alt text generator running at http://localhost:${port}`);
});

function buildPrompt({ originalFilename, seoKeyword, brandName, audience, tone }) {
  const candidateKeywords = parseKeywords(seoKeyword);
  const guidance = [
    "Analyze the uploaded image and produce accessible and SEO-conscious image metadata.",
    "Describe only what is visually supported by the image.",
    "Keep the base alt text concise, specific, and accessibility-first.",
    "Make the SEO alt text natural and readable. Include only the most applicable keyword or keywords if they genuinely fit the visible content.",
    "Create an SEO title that feels useful for an asset library or CMS.",
    "Create a filename stem using lowercase words separated by hyphens.",
    "Do not stuff keywords. Avoid vague filler like 'image of' unless necessary for clarity.",
    "If there is visible text in the image, mention it only when it matters to understanding the image.",
    "If multiple candidate SEO keywords are provided, choose only the best match or a small subset that truly fits the image.",
    "If you select a keyword from the candidate list, naturally weave the primary selected keyword into seo_alt_text, seo_title, and filename_stem whenever it fits.",
    "Prefer candidate keywords over invented ones when they are visually accurate for the image.",
    "If one candidate keyword is clearly the closest match, prefer selecting it instead of leaving seo_keywords empty.",
    "If none of the candidate keywords fit the image, do not force them into the output.",
    "Return valid JSON that matches the provided schema."
  ];

  const context = [
    `Original filename: ${originalFilename}`,
    `Candidate SEO keywords: ${candidateKeywords.length > 0 ? candidateKeywords.join(", ") : "None provided"}`,
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

async function generateMetadata({
  imageDataUrl,
  originalFilename = "image",
  seoKeyword = "",
  brandName = "",
  audience = "",
  tone = "",
  filenameCase = "lowercase"
}) {
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
  const candidateKeywords = parseKeywords(seoKeyword);
  const normalizedKeywords = normalizeSelectedKeywords({
    selectedKeywords: dedupeStrings(payload.seo_keywords),
    candidateKeywords,
    fallbackText: [payload.seo_alt_text, payload.seo_title, payload.filename_stem, payload.image_summary]
  });
  const primaryKeyword = normalizedKeywords[0] || "";
  const refinedCopy = normalizedKeywords.length > 0
    ? await refineMetadataCopy({
        imageSummary: payload.image_summary,
        baseAltText: payload.base_alt_text,
        seoAltText: payload.seo_alt_text,
        seoTitle: payload.seo_title,
        filenameStem: payload.filename_stem,
        selectedKeywords: normalizedKeywords,
        brandName,
        audience,
        tone
      })
    : null;

  const baseAltText = cleanupSentence(
    refinedCopy?.base_alt_text || applyPrimaryKeywordToBaseAlt(payload.base_alt_text, primaryKeyword, 125),
    125
  );
  const seoAltText = cleanupSentence(
    refinedCopy?.seo_alt_text || applyPrimaryKeywordToSentence(payload.seo_alt_text, primaryKeyword, 180),
    180
  );
  const seoTitle = cleanupSentence(
    refinedCopy?.seo_title || applyPrimaryKeywordToTitle(payload.seo_title, primaryKeyword, 70),
    70
  );
  const filenameStem = refinedCopy?.filename_stem || applyPrimaryKeywordToFilename(payload.filename_stem, primaryKeyword);

  return {
    imageSummary: payload.image_summary.trim(),
    baseAltText,
    seoAltText,
    seoTitle,
    filename: formatFilenameCase(`${sanitizeFilename(filenameStem)}${extension}`, filenameCase),
    seoKeywords: normalizedKeywords,
    notes: dedupeStrings(payload.notes),
    model,
    provider: "ollama"
  };
}

async function refineMetadataCopy({
  imageSummary,
  baseAltText,
  seoAltText,
  seoTitle,
  filenameStem,
  selectedKeywords,
  brandName,
  audience,
  tone
}) {
  try {
    const prompt = [
      "Rewrite the following image metadata so it sounds natural and human-written.",
      "Keep the meaning grounded in the image summary.",
      "Use the selected keyword or keywords naturally, not mechanically.",
      "You may inflect wording for natural English, such as turning 'luxury' into 'luxurious' when appropriate.",
      "Silently correct obvious spelling mistakes in candidate keywords when rewriting natural copy.",
      "Do not start seo_alt_text with a raw keyword fragment followed by a comma unless it sounds fully natural.",
      "Keep base_alt_text accessibility-first and concise.",
      "Keep seo_alt_text descriptive and natural.",
      "Keep seo_title concise and readable.",
      "Keep filename_stem lowercase and hyphenated.",
      "Return valid JSON only.",
      "",
      `Image summary: ${String(imageSummary || "").trim()}`,
      `Selected keywords: ${selectedKeywords.join(", ")}`,
      `Brand or site context: ${brandName || "None provided"}`,
      `Audience: ${audience || "General audience"}`,
      `Tone: ${tone || "Clear and professional"}`,
      `Current base alt text: ${String(baseAltText || "").trim()}`,
      `Current seo alt text: ${String(seoAltText || "").trim()}`,
      `Current seo title: ${String(seoTitle || "").trim()}`,
      `Current filename stem: ${String(filenameStem || "").trim()}`
    ].join("\n");

    const response = await fetchJson(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: refinementSchema,
        options: {
          temperature: 0
        },
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    return parseStructuredOutput(response);
  } catch (_error) {
    return null;
  }
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

async function fetchRemoteImageAsDataUrl(url) {
  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch (_error) {
    const error = new Error("Invalid image URL.");
    error.code = "INVALID_URL";
    throw error;
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    const error = new Error("Only HTTP and HTTPS image URLs are supported.");
    error.code = "INVALID_PROTOCOL";
    throw error;
  }

  const response = await fetch(parsedUrl, {
    redirect: "follow",
    headers: {
      Accept: "image/*,*/*;q=0.8",
      "User-Agent": "AltTextGenerator/1.0"
    }
  });

  if (!response.ok) {
    const error = new Error(`Image fetch failed with status ${response.status}.`);
    error.code = "FETCH_FAILED";
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.startsWith("image/")) {
    const error = new Error("The remote URL did not return an image.");
    error.code = "NOT_IMAGE";
    throw error;
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return {
    imageDataUrl: `data:${contentType};base64,${buffer.toString("base64")}`,
    originalFilename: inferRemoteFilename(parsedUrl, contentType)
  };
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

function parseKeywords(value) {
  return [...new Set(
    String(value || "")
      .split(/[\r\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function normalizeSelectedKeywords({ selectedKeywords, candidateKeywords, fallbackText }) {
  if (candidateKeywords.length === 0) {
    return dedupeStrings(selectedKeywords);
  }

  const matchedCandidates = candidateKeywords.filter((candidate) =>
    selectedKeywords.some((selected) => normalizeText(selected) === normalizeText(candidate))
  );

  if (matchedCandidates.length > 0) {
    return matchedCandidates;
  }

  const haystack = normalizeText(fallbackText.join(" "));
  const exactContainedCandidates = candidateKeywords.filter((candidate) => haystack.includes(normalizeText(candidate)));

  if (exactContainedCandidates.length > 0) {
    return exactContainedCandidates;
  }

  const bestFallbackCandidate = chooseBestFallbackKeyword(candidateKeywords, haystack);
  return bestFallbackCandidate ? [bestFallbackCandidate] : [];
}

function applyPrimaryKeywordToSentence(sentence, primaryKeyword, maxLength) {
  const cleaned = cleanupSentence(sentence, maxLength);

  if (!primaryKeyword || containsNormalized(cleaned, primaryKeyword)) {
    return cleaned;
  }

  const withoutTerminalPunctuation = cleaned.replace(/[.!?]+$/g, "");
  return cleanupSentence(`${capitalizeKeyword(primaryKeyword)}, ${lowercaseFirst(withoutTerminalPunctuation)}.`, maxLength);
}

function applyPrimaryKeywordToBaseAlt(baseAlt, primaryKeyword, maxLength) {
  const cleaned = cleanupSentence(baseAlt, maxLength);

  if (!primaryKeyword || containsNormalized(cleaned, primaryKeyword)) {
    return cleaned;
  }

  return cleanupSentence(`${capitalizeKeyword(primaryKeyword)} - ${lowercaseFirst(cleaned)}`, maxLength);
}

function applyPrimaryKeywordToTitle(title, primaryKeyword, maxLength) {
  const cleaned = cleanupSentence(title, maxLength);

  if (!primaryKeyword || containsNormalized(cleaned, primaryKeyword)) {
    return cleaned;
  }

  return cleanupSentence(`${capitalizeKeyword(primaryKeyword)} | ${cleaned}`, maxLength);
}

function applyPrimaryKeywordToFilename(filenameStem, primaryKeyword) {
  if (!primaryKeyword) {
    return filenameStem;
  }

  const sanitizedStem = sanitizeFilename(filenameStem);
  const sanitizedKeyword = sanitizeFilename(primaryKeyword);

  if (!sanitizedKeyword || sanitizedStem.includes(sanitizedKeyword)) {
    return sanitizedStem;
  }

  return `${sanitizedKeyword}-${sanitizedStem}`;
}

function formatFilenameCase(filename, filenameCase) {
  const text = String(filename || "");

  if (String(filenameCase || "").toLowerCase() !== "titlecase") {
    return text.toLowerCase();
  }

  const dotIndex = text.lastIndexOf(".");
  const stem = dotIndex >= 0 ? text.slice(0, dotIndex) : text;
  const extension = dotIndex >= 0 ? text.slice(dotIndex).toLowerCase() : "";
  const titleCasedStem = stem
    .split("-")
    .map((part) => {
      const token = String(part || "");
      return token ? token.charAt(0).toUpperCase() + token.slice(1).toLowerCase() : token;
    })
    .join("-");

  return `${titleCasedStem}${extension}`;
}

function containsNormalized(text, keyword) {
  return normalizeText(text).includes(normalizeText(keyword));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function chooseBestFallbackKeyword(candidateKeywords, haystack) {
  const haystackTokens = new Set(normalizeText(haystack).split(/\s+/).filter(Boolean));
  let bestCandidate = "";
  let bestScore = 0;

  for (const candidate of candidateKeywords) {
    const score = scoreCandidateKeyword(candidate, haystackTokens);

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestScore > 0 ? bestCandidate : "";
}

function scoreCandidateKeyword(candidate, haystackTokens) {
  const candidateTokens = normalizeText(candidate).split(/\s+/).filter(Boolean);

  if (candidateTokens.length === 0) {
    return 0;
  }

  let score = 0;

  for (const token of candidateTokens) {
    if (haystackTokens.has(token)) {
      score += 2;
    }

    if (token.endsWith("s") && haystackTokens.has(token.slice(0, -1))) {
      score += 1;
    }
  }

  return score;
}

function capitalizeKeyword(value) {
  const text = String(value || "").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function lowercaseFirst(value) {
  const text = String(value || "").trim();
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
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

function inferRemoteFilename(url, contentType) {
  const pathname = url.pathname || "";
  const fileName = pathname.split("/").filter(Boolean).pop();

  if (fileName && /\.[a-zA-Z0-9]+$/.test(fileName)) {
    return fileName;
  }

  const byMime = {
    "image/jpeg": "remote-image.jpg",
    "image/jpg": "remote-image.jpg",
    "image/png": "remote-image.png",
    "image/webp": "remote-image.webp",
    "image/gif": "remote-image.gif"
  };

  return byMime[contentType.toLowerCase()] || "remote-image.png";
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

function resolveBulkItemError(error) {
  if (error?.code === "INVALID_URL") {
    return "Invalid URL.";
  }

  if (error?.code === "INVALID_PROTOCOL") {
    return "Only HTTP and HTTPS links are supported.";
  }

  if (error?.code === "NOT_IMAGE") {
    return "The URL did not return an image file.";
  }

  if (error?.code === "FETCH_FAILED") {
    return error.message;
  }

  return resolveGenerationError(error);
}
