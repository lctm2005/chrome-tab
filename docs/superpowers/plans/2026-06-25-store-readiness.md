# Store Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first Chrome Web Store readiness bundle for Space Tabs.

**Architecture:** Keep store preparation separate from runtime code. Add one release packager that stages a clean extension zip from a fixed allowlist, plus documentation for privacy, listing copy, reviewer notes, and commercialization.

**Tech Stack:** Chrome Extension Manifest V3, Node.js ES modules, system `zip`, Markdown documentation.

---

## File Structure

- Create `scripts/package-release.mjs` for release packaging.
- Modify `package.json` to expose `npm run package` and syntax-check the packager.
- Modify `.gitignore` so generated `dist/` packages are not tracked.
- Modify `README.md` to document the release workflow.
- Create `PRIVACY.md` for privacy policy copy.
- Create `docs/store-listing.md` for Chrome Web Store listing copy and reviewer notes.
- Create `docs/commercialization.md` for free-to-Pro commercialization strategy.

### Task 1: Release Packager

**Files:**
- Create: `scripts/package-release.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

- [x] **Step 1: Add a packaging script**

Create a Node.js script that reads `manifest.json`, stages only runtime files,
generates a safe empty `config.local.js`, and creates `dist/space-tabs-<version>.zip`
with the system `zip` command.

- [x] **Step 2: Add npm command**

Add `"package": "node scripts/package-release.mjs"` to `package.json`.

- [x] **Step 3: Ignore generated packages**

Add `dist/` to `.gitignore`.

### Task 2: Store Documentation

**Files:**
- Create: `PRIVACY.md`
- Create: `docs/store-listing.md`
- Create: `docs/commercialization.md`

- [x] **Step 1: Write privacy policy**

Document local storage, optional AI network requests, data handled, permissions,
and user control.

- [x] **Step 2: Write listing draft**

Document store name, short description, long description, permission
justifications, reviewer notes, screenshot plan, and launch checklist.

- [x] **Step 3: Write commercialization plan**

Document positioning, target users, recommended free release, future Pro tier,
pricing hypotheses, and launch sequence.

### Task 3: README Release Workflow

**Files:**
- Modify: `README.md`

- [x] **Step 1: Add package workflow**

Document `npm run package`, generated zip location, and store preparation docs.

- [x] **Step 2: Remove stale hard-coded package filename**

Replace the previous fixed `dist/space-tabs-0.4.2-space-switch-fix.zip` reference
with the generated `dist/space-tabs-<version>.zip` pattern.

### Task 4: Verification

**Files:**
- Generated: `dist/space-tabs-<version>.zip`

- [x] **Step 1: Run syntax checks**

Run `npm run check` and confirm it exits with status 0.

- [x] **Step 2: Run release packaging**

Run `npm run package` and confirm it creates `dist/space-tabs-<version>.zip`.

- [x] **Step 3: Inspect package contents**

Run `zipinfo -1 dist/space-tabs-<version>.zip` and confirm it includes runtime
files and excludes `config.local.js` secrets, `.git`, tests, backup icons, and
raw artwork. The generated safe `config.local.js` stub is expected.
