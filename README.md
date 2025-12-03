# TranscribEasy

Transcribeasy is a local, offline speech-to-text desktop app built with Tauri (Rust) and a TypeScript/Vite frontend. It uses the Whisper ecosystem (via `whisper-rs` / `whisper.cpp`-style models) to transcribe audio and video files into plain-text transcripts and SRT subtitle files.

This repository provides a simple GUI for downloading models, selecting audio/video files (drag & drop or browse), and running local transcription — output files are saved next to the input media.

---

## Table of contents

- [Features](#features)
- [Supported formats](#supported-formats)
- [How it works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Quick start (development)](#quick-start-development)
- [Build (production)](#build-production)
- [Model management](#model-management)
- [Usage](#usage)
- [Troubleshooting & notes](#troubleshooting--notes)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- Local/offline transcription using native Rust bindings (`whisper-rs`).
- Drag & drop or browse to select audio/video files.
- Built-in model downloader and manager (models stored in the app local data directory).
- Export as SRT (subtitle) and/or plain TXT transcript.
- Options to control max segment length and characters per segment for subtitle chunking.

## Supported formats

- Audio: `wav`

Output: `.srt` and/or `.txt` files are written next to the input file (same directory, same base name).

## How it works

- The frontend (`src/`) is a small Vite + TypeScript app that provides the UI for selecting files, picking a model and options, and managing downloads.
- The backend runs inside a Tauri Rust binary (`src-tauri/`) and exposes a `transcribe_command` Tauri command. The Rust code uses `whisper-rs` to run the model on audio data and writes SRT/TXT outputs.

Key components:
- `src/main.ts` — UI wiring, drag/drop, model selection and calling the Tauri invoke command.
- `src/fileManage.ts` — model downloader and local state management.
- `src-tauri/src/transcribe.rs` — transcription logic, chunking and SRT/TXT generation.

## Prerequisites

You need both Node (frontend) and the Rust toolchain (backend) installed.

- macOS (recommended):
	- Install Rust via `rustup`: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
	- Install Node.js (use `brew` or nvm). Example with Homebrew:
		```bash
		brew install node
		```
	- Xcode Command Line Tools (for build tooling):
		```bash
		xcode-select --install
		```
	- Install Tauri CLI (optional, you can also use `npx`):
		```bash
		cargo install tauri-cli --locked
		# or use npx: npx @tauri-apps/cli@latest
		```

- General:
	- `npm` / `pnpm` / `yarn` to manage JS deps
	- `cargo` (comes with rustup)

Note: `whisper-rs` can use platform acceleration backends (Metal on macOS, CUDA/Vulkan where available) if built with the corresponding features. See `src-tauri/Cargo.toml` to pick the right feature flags.

## Quick start (development)

1. Clone the repository and install frontend dependencies:

```bash
git clone <repo-url>
cd transcribeasy
npm install
```

2. Run the app:
```
npm run tauri dev
```

## Build (production)

Build the Tauri app (native bundle):

```bash
npm run tauri build -- --bundles app
```

The OS-specific installers/bundles will be produced in the `src-tauri/target/` output directories.

## Model management

- Models are stored in the application local data directory under `models/` (the frontend code resolves model paths using `appLocalDataDir()` and looks for `models/<key>.bin`).
- The UI includes a simple downloader (`src/fileManage.ts`). The file contains `MODEL_URLS` constants — replace them with correct model URLs if needed.
- Alternatively, place a `ggml-*.bin` model manually into the app local data `models/` directory (or the platform equivalent) and restart the app; the model selector will detect available models.

## Usage

1. Open the app.
2. Download or add a Whisper-style model (e.g. `ggml-tiny.bin`, `ggml-base.bin`) to the `models/` folder via the UI or manually.
3. Drag & drop a supported audio/video file onto the drop zone or click **Browse**.
4. Select a model and output format (`SRT`, `TXT`, or `Both`).
5. Optionally change `Max segment length` and `Max characters per segment` to control subtitle chunking.
6. Click **Start**. When finished, the app writes outputs alongside the source media file (e.g. `myvideo.srt` and/or `myvideo.txt`). The full transcript is also returned and displayed in the UI console.

## Troubleshooting & notes

- If you get build errors in the Rust/Tauri build, ensure your Rust toolchain is up to date: `rustup update`.
- If model downloads fail, check the `MODEL_URLS` in `src/fileManage.ts` — the example contains placeholder links for some models.
- `whisper-rs` requires the input audio to be a WAV file with a supported sample rate. The Rust code expects PCM samples; the frontend does not perform heavy audio conversion. If your input is not WAV/PCM, consider converting it to WAV first (many video containers like `mp4` may require extraction or conversion).
- For macOS hardware acceleration: `whisper-rs` may be configured with the `metal` feature (see `src-tauri/Cargo.toml`). If you plan to use GPU acceleration, ensure your platform and crate features are configured accordingly.

## Contributing

- Issues and PRs welcome. Please open issues for bugs or feature ideas.
- Keep PRs focused and provide a clear description of changes. If adding new features (e.g., automatic audio conversion), include tests or a manual verification plan.

## Roadmap

I'm not sure if I'll work on this more since it was mainly just a project to learn Tauri and Rust, but possible future improvements include:

- [ ] Add support for custom models.
- [ ] Add support for non-WAV audio inputs with built-in conversion.
- [ ] Progress bar / ETA during transcription.
- [ ] Test on other platforms (Windows, Linux).



## License

This project includes an MIT-style `LICENSE` file in the repo. Check the `LICENSE` at the repo root for full terms.

---

If you'd like, I can also:

- Add a short example `dev` workflow to `package.json` (if you want `npm run tauri:dev`).
- Replace placeholder `MODEL_URLS` with official `ggml-*` URLs for `tiny`/`base` if you want me to wire that in.

Want me to commit both of those small follow-ups?
