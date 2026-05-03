# Setup

First-time setup for this project. Run these once.

## Prerequisites

- Node.js 20 or newer
- A GitHub account
- Claude Code installed (`npm i -g @anthropic-ai/claude-code` or follow [official install guide](https://docs.claude.com/en/docs/claude-code/quickstart))

## Choose your hosting model first

Before doing anything else, decide how you want to run the editor. This affects every step below.

**Option A: Public GitHub Pages (recommended for most cases)**
- The repo is public. The editor code is publicly readable.
- WFP/Philips fixture content stays out of the repo (gitignored by default in `.gitignore`).
- Bookmarklet works on any device, fetches editor.js from your public URL.
- Setup is the simplest. Follow Steps 1-7 below as written.

**Option B: Local-only (no hosting)**
- Nothing on the internet. Editor only runs on machines where you've cloned the repo.
- The bookmarklet points at `http://localhost:8080/editor.js` instead of GitHub.
- You start a local server (`npm run dev`) before clicking the bookmarklet.
- Setup: skip Steps 2, 3, and 6 below. The bookmarklet generator has a `--local` flag.

**Most users should pick Option A.** The editor code reveals nothing sensitive, and the gitignore rules in this starter pack already keep your slide content private. Only choose Option B if you're certain you don't want the editor URL to exist anywhere on the internet.

## Privacy by default (both options)

This starter pack ships with a strict `.gitignore` that excludes all HTML fixtures from git unless explicitly allow-listed. So `fixtures/Townhall-1.html` and any other WFP slides on your laptop are present locally (tests run against them) but never enter git history. See `.gitignore` and CLAUDE.md "Privacy: what's safe to commit" for the full rules.

If you need to commit a fixture (e.g. a sanitized example for documentation), edit `.gitignore` to add it to the allow-list. Treat each addition as a deliberate decision.

## Steps

### 1. Drop this folder into a new git repo

```bash
cd /path/to/parent/folder
# (the unzipped wfp-slide-editor folder is here)
cd wfp-slide-editor
git init
git add .
git status  # ← review what's about to be committed BEFORE the commit
git commit -m "chore: initial starter pack"
```

The `git status` step is critical. Read the file list. No HTML fixtures should appear in `Changes to be committed` unless you've deliberately allow-listed them.

### 2. Create a GitHub repo and push *(skip for Option B)*

Create a new public repo on github.com (e.g. `wfp-slide-editor`). Then:

```bash
git remote add origin https://github.com/[your-username]/wfp-slide-editor.git
git branch -M main
git push -u origin main
```

### 3. Enable GitHub Pages *(skip for Option B)*

On github.com:

1. Go to your repo → Settings → Pages
2. Source: **Deploy from a branch**
3. Branch: **main** / **/ (root)**
4. Save

After ~1 minute, your editor will be live at `https://[username].github.io/wfp-slide-editor/editor.js`.

(But editor.js doesn't exist yet. That's fine. Claude Code will create it in Phase 1 of `TASKS.md`. Once you push that change, the URL will work.)

### 4. Open in Claude Code

```bash
cd wfp-slide-editor
claude
```

When Claude Code starts, give it this prompt:

> Read CLAUDE.md, REQUIREMENTS.md, DESIGN.md, and TASKS.md. Then start at Phase 0 in TASKS.md and work through to Phase 10. Verify after each task before moving on.

### 5. After Claude Code finishes a phase

Claude Code commits at the end of each phase using the suggested message in TASKS.md (Conventional Commits format, e.g. `feat(phase-1): editor.js bootstrap with edit-mode toggle`).

**You** push when ready:

```bash
git push
```

GitHub Pages auto-deploys on push. Wait ~1 minute, then the latest `editor.js` is live at your hosted URL.

**Push cadence:** push at checkpoint moments (after you've eyeballed the work and replied `proceed` to Claude Code) rather than after every phase. Pushing live code that you haven't verified means a broken bookmarklet for any open slide. The phases marked `*(checkpoint)*` in TASKS.md are natural push points: 2, 4, 5, 8, 9.

After Phase 10 ships, tag the release:

```bash
git tag v1.0.0
git push --tags
```

### 6. Build and save the bookmarklet

**Option A (public GitHub Pages):** once `editor.js` is hosted on Pages:

```bash
EDITOR_URL=https://[your-username].github.io/wfp-slide-editor/editor.js npm run build:bookmarklet
```

**Option B (local-only):** start the local server first, then build a local-pointing bookmarklet:

```bash
npm run dev    # starts http-server on port 8080, leave running
# in another terminal:
npm run build:bookmarklet -- --local
# (or: EDITOR_URL=http://localhost:8080/editor.js npm run build:bookmarklet)
```

Either way, this prints a `javascript:...` string. Drag it to your browser's bookmarks bar (or right-click bookmarks bar → Add page → paste the URL).

For Option B, the bookmarklet only works while `npm run dev` is running. Consider adding a shell alias like `alias edit-slides="cd ~/projects/wfp-slide-editor && npm run dev"` so you can spin the server up in one command.

### 7. Test it on a real slide

Open any WFP slide HTML in your browser. Click the bookmarklet. Press `E`. Edit. Press `Cmd+S`. Done.

## Updating the editor

**Option A:** when Claude Code adds features in later phases, `git push` to deploy. GitHub Pages auto-deploys. The next time you click the bookmarklet, you get the new version (the cache-buster ensures freshness).

**Option B:** changes are live as soon as Claude Code saves `editor.js`, since the bookmarklet fetches from your local server. The cache-buster ensures the browser doesn't serve a stale copy.
