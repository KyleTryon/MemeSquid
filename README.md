# MemeSquid

The free, local-first meme editor behind [memesquid.com](https://memesquid.com). Built with React, TypeScript, Vite, and Konva.js.

**Remove backgrounds, combine images, add captions, and export—all in your browser.**

## Features

- **Flexible Image Import:** Drag and drop, paste from the clipboard, or choose PNG, JPEG, WebP, and SVG files.
- **Built-in Template Library:** Search and filter the curated local catalog by title, tag, franchise, or artist.
- **Layered Editing:** Combine multiple images, reorder layers, draw freehand, and undo or redo edits.
- **Local Background Removal:** Remove or restore the background on the main image or any additional image. Inference runs locally in a browser worker; images are not uploaded to a removal service.
- **Quick Image Controls:** Flip imported images horizontally or vertically from the canvas controls.
- **Non-destructive Cropping:** Crop individual images without losing hidden pixels, or crop the full canvas while preserving off-canvas layers for later expansion.
- **Text Editing:** Add multiple text layers, drag or resize them, and customize their appearance.
- **Properties Panel:**
  - **Typography:** Change font family, size, and alignment.
  - **Colors:** Customize fill and stroke (outline) colors.
  - **Shadows:** Add and adjust drop shadows (color, blur, opacity, offset X/Y).
  - **Layout:** Fine-tune X/Y coordinates precisely.
- **Proportional Scaling:** Text width and stroke width scale naturally when resizing via the canvas handles.
- **Export:** Copy a PNG to the clipboard or download PNG, JPEG, and WebP files at high quality.
- **Installable PWA:** Add MemeSquid to an Android or iOS home screen and use the core editor offline.

## Local Background Removal

Background removal is performed on your device with Transformers.js and the
`briaai/RMBG-1.4` model. The first removal requires an approximately 176 MB model download,
which the browser caches for later use. After the model is available, the source image and
generated mask stay in the browser; MemeSquid does not send the image to a background-removal
API.

The editor tries WebGPU first and falls back to WebAssembly when WebGPU is unavailable. An
internet connection is therefore required for the initial model download, but not for later
removals while the model remains cached.

## Local Development

1. Install Node.js 26.3.1 or newer (but below 27) and enable [Corepack](https://nodejs.org/api/corepack.html):
   ```bash
   corepack enable
   ```
2. Install the exact pnpm version pinned by the project and its dependencies:
   ```bash
   corepack install
   pnpm install --frozen-lockfile
   ```
3. Start the development server:
   ```bash
   pnpm dev
   ```

## Meme Template Catalog

Add a template with the interactive terminal form:

```bash
pnpm template:add
```

The form processes a local PNG, JPEG, WebP, or AVIF image, creates normalized source and
thumbnail WebP files, and collects aliases, tags, group relationships, and optional reference
links. Committed entries appear automatically in the app's searchable template library. Use
`pnpm template:add --help` for the equivalent non-interactive flags and `--dry-run` to validate
without writing anything.

The form can also import an Imgflip template from its numeric ID or template-page URL. The
command downloads the blank image only during import, records the Imgflip ID as provenance, and
commits the normalized files locally:

```bash
pnpm template:add --imgflip "https://imgflip.com/memetemplate/516512053/Flork"
```

Use `--image` together with `--imgflip` to supply a downloaded local image while retaining the
Imgflip reference. Imgflip imports always require confirmation unless `--yes` is passed.

Templates can share reusable property or artist groups. Property groups represent the franchise
or intellectual property that a template comes from. Add a group before assigning templates to it:

```bash
pnpm template:group:add
```

Know Your Meme links are optional context references and do not represent image licensing or
permission. Run `pnpm templates:check` to validate all metadata, relationships, files, dimensions,
duplicate images, and duplicate Imgflip IDs. This validation is also part of `pnpm check`.

## Code Quality

Run the complete local and CI quality gate:

```bash
pnpm check
```

The individual commands include `pnpm templates:check`, `pnpm templates:test`, `pnpm typecheck`,
`pnpm lint`, `pnpm knip`, and `pnpm format:check`. Use `pnpm lint:fix` for safe ESLint fixes and
`pnpm format` to apply Prettier formatting.

## Deploying to Cloudflare Workers

This project deploys its Vite build as Cloudflare Workers static assets and serves it from
`memesquid.com`. The Worker and custom-domain binding are declared in `wrangler.jsonc`.

1. Create a scoped Cloudflare API token with permission to edit Workers for the account containing
   the `memesquid.com` zone.
2. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub Actions repository secrets.
3. Push to `main` or `master`, or run the **Deploy to Cloudflare Workers** workflow manually.

The workflow runs the full quality gate, builds `dist`, deploys it, and provisions the custom-domain
binding on the first successful deployment. A conflicting DNS record for the apex hostname must be
removed before Cloudflare can create that binding.

For an authenticated local deployment, run:

```bash
pnpm deploy
```
