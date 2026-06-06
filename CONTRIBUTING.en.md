# Contributing to WorkShadow

Thank you for your interest in [WorkShadow](https://github.com/FutureUniant/WorkShadow)! WorkShadow is a **local-first** desktop work-log application (Tauri 2 + React + TypeScript + Rust). Whether you are fixing bugs, improving documentation, enhancing i18n, or working on search and AI features, we welcome your participation.

Please read this guide first. For community behavior expectations, see [CODE_OF_CONDUCT.en.md](./CODE_OF_CONDUCT.en.md).

<p align="center">
  <a href="CONTRIBUTING.md">中文</a> | <strong>English</strong>
</p>

---

## How You Can Contribute

| Way | Description |
|-----|-------------|
| **Report issues** | File bugs, UX problems, or feature requests via [GitHub Issues](https://github.com/FutureUniant/WorkShadow/issues) |
| **Submit code** | Fork the repo → create a branch → open a Pull Request |
| **Improve docs** | Fix README, add developer notes, improve comments |
| **Translations & copy** | The project uses i18n (Chinese / English); corrections and new locales are welcome |
| **Join the discussion** | QQ group (1107536375), WeChat official account, or email [feiyangtech@qq.com](mailto:feiyangtech@qq.com) |

Users in China may also use the [AtomGit / GitCode mirror](https://gitcode.com/FutureUniant/WorkShadow) for Issues and PRs. **GitHub remains the primary upstream** for code merges.

---

## Before You Start

1. **Search existing Issues / PRs** to avoid duplicate work.
2. **Discuss larger changes in an Issue first** (new features, architecture changes, breaking changes) before writing code.
3. **Follow [AGPL-3.0](./LICENSE)**: if you modify the software and offer it over a network, you must provide corresponding source code to users.
4. **Do not commit secrets**: API keys, personal logs, `.ws` backups, local databases, etc. must never enter the repository.

---

## Development Setup

### Requirements

- **Node.js** 18+ (current LTS recommended)
- **Rust + Cargo** (required for `tauri dev` / `tauri build`)
- **Windows**: packaging and native builds require the Visual Studio **“Desktop development with C++”** workload. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

### Clone and install

```bash
git clone https://github.com/FutureUniant/WorkShadow.git
cd WorkShadow
npm install
```

### Common commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Browser-only frontend dev (no Tauri; data uses `localStorage`) |
| `npm run tauri dev` | Desktop dev mode (Vite HMR + Tauri window) |
| `npm run build` | Build frontend static assets into `dist/` |
| `npm run tauri build` | Build a Release installer (requires a successful `build` first) |
| `npm test` | Run Vitest unit tests |
| `npm run preview` | Preview the production frontend build |

**Notes:**

- `npm run tauri dev` does not produce installers; it is for day-to-day debugging. React/TS/CSS changes hot-reload; Rust or `tauri.conf.json` changes trigger recompilation.
- If port `1420` is in use, stop the conflicting process first.
- Running the exe under `target/debug` directly requires `dist/` from `npm run build`; otherwise you may see a blank window.

### Project layout (overview)

```
WorkShadow/
├── src/                 # React frontend (components, services, i18n)
├── src-tauri/           # Rust native layer (SQLite, LanceDB, system APIs)
├── docs/                # Documentation and images
├── scripts/             # Icon sync and packaging helpers
└── assets/              # Site and showcase assets
```

Key modules:

- **Editing**: TipTap rich text ↔ Markdown (`src/` editor code)
- **Search**: keyword + semantic search (`src/services/rag.ts`, etc.)
- **Persistence**: SQLite state, LanceDB vectors (`src-tauri/`)
- **Workbench**: memory, log summaries, log Q&A (`src/services/`)

---

## Filing Issues

Good issues help us respond faster. Please include:

1. **Environment**: OS and version, WorkShadow version (installer / dev build / source commit)
2. **Steps to reproduce**: shortest path from launch to the problem
3. **Expected vs actual**: what you expected and what happened
4. **Screenshots or logs**: attach images for UI issues; attach Console / terminal errors for crashes or blank screens (**redact sensitive data**)
5. **Whether it reproduces reliably**

For feature requests, describe the **use case** and **why it matters for WorkShadow**, not only “I want feature X.”

---

## Submitting Pull Requests

### Branches and commits

1. Pull the latest code from `main` (or the current default branch).
2. Use meaningful branch names, for example:
   - `fix/search-highlight-jump`
   - `feat/i18n-ja-locale`
   - `docs/contributing-guide`
3. Keep each PR **focused on one topic**; split unrelated changes into separate PRs.
4. Use concise imperative commit messages, for example:
   - `fix: apply semantic search minimum similarity threshold`
   - `feat: add custom output templates for workbench summaries`
   - `docs: document model config storage`

### Code and style

- Use **TypeScript** and follow existing directory and naming conventions.
- For frontend changes, respect **i18n**: put user-visible strings in locale files; avoid hard-coded Chinese or English.
- When changing **Tauri invoke** calls, update Rust command signatures and error handling accordingly.
- When touching **Embedding / LanceDB**, respect index rebuild semantics and avoid breaking compatibility with existing user data.
- Prefer **small, reviewable diffs**; avoid large unrelated formatting changes.
- Add unit tests in `src/**/*.test.ts` when appropriate; run `npm test` and ensure it passes.

### PR description should include

- **Summary** (what changed and why)
- **Linked Issue** (`Fixes #123` / `Closes #123`)
- **Testing notes** (how you verified: commands, manual steps, screenshots)
- **Breaking changes** (if any, with migration steps)

Maintainers may request changes during review; please respond or update your branch promptly.

---

## License and copyright

- This repository is released under **[AGPL-3.0](./LICENSE)**.
- By contributing, you license your contributions under the same terms.
- Before adding new third-party dependencies, confirm license compatibility with AGPL and note it in the PR.

---

## Getting help

- **GitHub Issues**: [github.com/FutureUniant/WorkShadow/issues](https://github.com/FutureUniant/WorkShadow/issues)
- **Project site**: [futureuniant.github.io/WorkShadow](https://futureuniant.github.io/WorkShadow/)
- **Email**: [feiyangtech@qq.com](mailto:feiyangtech@qq.com)
- **QQ group**: 1107536375 (QR codes in README)

Thank you again for contributing. WorkShadow aims to help users **write it down, find it again, and explain it clearly**—every contributor makes that loop better.
