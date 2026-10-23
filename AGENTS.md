# Project architecture

PromptGuard is a Korean-language, browser-local privacy redaction tool built on the basic TanStack Start template.

- `src/routes/index.tsx`: workspace, regex detection, file reading, selective redaction, copy/download, and guide dialogs.
- `src/routes/__root.tsx`: document language, metadata, and shared providers.
- `src/styles.css`: visual system, responsive layouts, and reduced-motion behavior.
- `src/components/ui/`: reusable primitives supplied by the starter.

Use TypeScript and React function components. Use Lucide icons and Korean user-facing copy. Maintain the quiet green palette, fixed navigation on desktop, two-column editor, and single-column mobile layout.

Privacy is a deliberate architectural constraint: do not send source text or uploaded documents to servers or AI providers, persist document content, or add content analytics. Current state exists only in browser memory. New persistence features require an explicit product decision and Netlify storage primitives.

Detection is heuristic, with non-overlapping match ranges sorted by source offset. Apply substitutions right-to-left to preserve offsets. Changes to source text invalidate prior results. Keep supported file types, size limits, and detection limitations visible. Do not claim complete anonymization. Existing name detection requires Korean labels and address detection supports limited Korean patterns.
