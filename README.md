# ALT Text Generator

A lightweight local web app that analyzes an uploaded image and generates:

- Base alt text
- SEO-friendly alt text
- SEO title
- SEO filename
- Supporting keywords and notes

## Requirements

- Node.js 18 or newer
- Ollama installed locally
- `gemma3:4b` pulled in Ollama

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file from `.env.example`:

   ```bash
   copy .env.example .env
   ```

3. Make sure Ollama is running and the model exists:

   ```bash
   ollama list
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000)

## Environment variables

- `PORT`: optional, defaults to `3000`
- `OLLAMA_URL`: optional, defaults to `http://127.0.0.1:11434`
- `OLLAMA_MODEL`: optional, defaults to `gemma3:4b`

## Notes

- The app uses the local Ollama chat API with image input and structured JSON output.
- Accessible alt text is kept short, while SEO alt text is allowed to be slightly richer.
- Filenames are sanitized to lowercase hyphenated slugs and keep the original extension when possible.
