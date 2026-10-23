# PromptGuard

A Korean privacy review workspace for preparing text before sharing it with AI tools. Paste text or open a document or image, inspect pattern-based detections, choose which matches to redact, and copy or download the reviewed text.

Supported documents include PDF, HWP/HWPX, Word 97–2003 DOC and DOCX, Excel XLS/XLSX/XLSM/XLSB, PowerPoint PPT/PPTX, OpenDocument ODT/ODS/ODP, EPUB, RTF, HTML/XML/SVG text and other plain-text files (including UTF-8, UTF-16 BOM and EUC-KR). Legacy, encrypted or damaged documents may require conversion. PNG, JPEG, WebP, BMP, GIF (first frame) and multipage TIFF support Korean and English OCR. PDF image recognition is enabled by default and runs on every page, including pages containing both selectable text and images. Native text and OCR can overlap. Turning PDF OCR off extracts selectable text only.

Limits: one file at a time, 50 MB per file, 100 PDF/TIFF pages, 1 million extracted characters, 100 MB of expanded document data, and 50 million pixels per image. Images are resized to a maximum edge of 3000 pixels for OCR. Unsupported binary formats, audio, video and executables require conversion; there is no promise of universal file compatibility. File reads show progress, can be cancelled and preserve the previous input on failure. Editing text or selecting another file invalidates pending reads and scans.

All document processing happens in browser memory. Source documents are not uploaded, and inspection history is not persisted. Refreshing clears the workspace. PDF/OCR workers, fonts, WebAssembly and Korean/English language models are served from the same site; OCR caching is disabled. `pnpm install` runs `scripts/prepare-file-assets.mjs` to prepare the ignored `public/vendor/` runtime assets. Run that script manually if lifecycle scripts were disabled during installation.

Only extracted text is redacted and exported as TXT. Original documents, their formatting, embedded images, animations beyond the first frame, comments unsupported by a parser, and metadata are not comprehensively inspected or modified. OCR may miss or misread letters and numbers. Detection is heuristic and requires human review; names require a Korean name label, and address recognition covers limited Korean formats.

Built with React, TypeScript, TanStack Start, Vite, Tailwind CSS, and Lucide icons. Netlify hosts the application.

## Local development

Install dependencies with `pnpm install`, then run `pnpm dev`. For Netlify emulation, run `netlify dev --port 8889`. The deployment pipeline handles production builds. Run `pnpm typecheck` and `pnpm test` for validation; the development server generates the TanStack route tree required for type checking.
