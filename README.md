# Global Multimedia Search

A responsive full-stack web application that searches real images, video and audio from Wikimedia Commons. No API key or paid subscription is required.

## Requirements
- Node.js 18 or later
- Internet connection

## Run locally
```bash
npm start
```
Open http://localhost:3000

To run on another port:
```bash
PORT=8080 npm start
```

## How it works
- The frontend calls `GET /api/search?q=...&type=all|image|video|audio&page=1`.
- The Node.js backend queries the Wikimedia Commons MediaWiki API (namespace 6, files).
- Media metadata includes original file URL, thumbnail, MIME type, source page and license label.
- Video/audio playback depends on browser support for the source file codec.

## Important limitations
- This is a real search of Wikimedia Commons, **not** an index of every website on the internet.
- Media types are filtered after retrieving a batch of up to 30 files, so some pages can show few or no matching items. Keep loading pages or use more specific keywords.
- Search results and API availability depend on the external provider. Production deployment should implement caching, rate limiting, monitoring, and appropriate API identification/contact information.
- Always verify license, attribution, and reuse terms on the original source page before using or downloading media.
- No scraping of protected websites and no bypassing of download restrictions.

## Files
- `server.js`: Node.js HTTP server and Wikimedia Commons search proxy
- `public/index.html`: UI structure
- `public/style.css`: responsive design
- `public/app.js`: search, filters, result cards, modal preview

## Extending providers
Add separate server-side adapters for approved providers such as Pexels, Pixabay, Freesound or YouTube, using their official APIs and keys/terms where required. Do not expose API secrets to browser JavaScript.

## Deploy with GitHub + Render (free tier, subject to availability)
1. Create a new GitHub repository and upload the **contents** of this folder to the repository root (package.json and server.js should be at the root).
2. Sign in to https://dashboard.render.com with GitHub and authorize the repository.
3. Select **New > Blueprint**, select the repository, and apply `render.yaml`. Alternatively create a **Web Service** with Node runtime, `npm install` build command, and `npm start` start command.
4. Wait for the deployment to finish, then open the `.onrender.com` URL provided by Render.
5. Free instances may spin down after inactivity and have usage limits. Confirm current plan terms before deployment.

Do not upload API keys or `.env` secrets to GitHub. The default Wikimedia Commons provider does not require an API key.
