# Meme Generator

A premium, in-browser meme generator built with React, TypeScript, Vite, and Konva.js.

## Features

- **Flexible Image Upload:** Drag and drop, paste from clipboard, or upload via file selector.
- **Advanced Text Editing:** Add multiple text layers, drag to position, and use transformer handles to resize.
- **Local Background Removal:** Easily add stickers and assets to your image and remove the backgrounds. 100% local, in-browser.
- **Premium Properties Panel:**
  - **Typography:** Change font family, size, and alignment.
  - **Colors:** Customize fill and stroke (outline) colors.
  - **Shadows:** Add and adjust drop shadows (color, blur, opacity, offset X/Y).
  - **Layout:** Fine-tune X/Y coordinates precisely.
- **Proportional Scaling:** Text width and stroke width scale naturally when resizing via the canvas handles.
- **Export:** Download your finished meme as a high-quality PNG.

## Local Development

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

## Deploying to GitHub Pages

This project is pre-configured to deploy automatically to GitHub Pages using GitHub Actions.

1. Push your code to the `main` or `master` branch of your GitHub repository.
2. Go to your repository settings on GitHub: **Settings > Pages**.
3. Under **Build and deployment**, set the **Source** to **GitHub Actions**.
4. The included `.github/workflows/deploy.yml` will automatically build and deploy your site whenever you push to the default branch.

*Note: The `base` path in `vite.config.ts` is set to `'./'` to ensure assets load correctly regardless of your repository name.*
