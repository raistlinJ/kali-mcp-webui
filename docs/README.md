# Kali MCP WebUI — Landing Page

Static GitHub Pages site for the Kali MCP WebUI research tool.

## Structure

```
docs/
├── index.html          ← Main page (all sections)
├── style.css           ← Stylesheet (dark terminal theme)
├── script.js           ← Interactivity (nav, modal, copy, scroll reveal)
├── assets/
│   ├── images/         ← Put screenshots here (PNG/JPG)
│   └── videos/         ← Put local demo videos here (MP4/WebM)
└── README.md           ← This file
```

## Adding Content

### Screenshots
Drop PNG or JPG files into `assets/images/`. Then update `index.html`:

```html
<!-- Replace ss-placeholder div with: -->
<div class="screenshot-card" data-caption="Your caption here">
  <img src="assets/images/your-screenshot.png" alt="Your caption here" loading="lazy" />
</div>
```

### Demo Video
**Option A — YouTube:**
Replace the `demo-placeholder` div with:
```html
<iframe
  class="demo-video"
  src="https://www.youtube.com/embed/YOUR_VIDEO_ID"
  title="Kali MCP WebUI Demo"
  frameborder="0"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowfullscreen>
</iframe>
```

**Option B — Local video:**
```html
<video class="demo-video" controls poster="assets/images/video-poster.jpg">
  <source src="assets/videos/demo.mp4" type="video/mp4">
</video>
```

### Team Members
In `index.html`, duplicate the `.team-card` block and fill in names, links, etc.

## Hosting on GitHub Pages

```bash
# From the repo root:
git checkout -b website
# (copy docs/ contents into root OR keep in docs/)
git add docs/
git commit -m "Add landing page"
git push origin website
```

Then go to: **Repo → Settings → Pages → Branch: website → Folder: /docs**

GitHub will generate: `https://<username>.github.io/<repo-name>/`

## Local Preview

Just open `docs/index.html` in a browser. No build step required.
