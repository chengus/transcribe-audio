import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";


type OutputFormat = "srt" | "txt" | "both";

interface TranscriptionRequest {
  filePath: string;
  outputFormat: OutputFormat;
  model: string;
  maxSegmentLength: number;
  maxCharactersPerSegment: number;
}

const defaultStatusText = "Choose a file to begin.";
let selectedFilePath: string | null = null;

function isTauriEnvironment() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function registerNativeDropHandlers(
  dropZone: HTMLElement | null,
  setSelectedFile: (path: string) => void
) {
  if (!dropZone || !isTauriEnvironment()) {
    return;
  }

  try {
    const unlisten = await WebviewWindow.getCurrent().onDragDropEvent((event) => {
      forwardDragDropToUi(dropZone, setSelectedFile, event);
    });
    window.addEventListener(
      "beforeunload",
      () => {
        unlisten();
      },
      { once: true }
    );
  } catch (error) {
    console.warn("Failed to register native file drop handlers", error);
  }
}

function forwardDragDropToUi(
  dropZone: HTMLElement,
  setSelectedFile: (path: string) => void,
  event: { payload: DragDropEvent }
) {
  const { payload } = event;
  switch (payload.type) {
    case "enter":
    case "over":
      dropZone.classList.add("dragover");
      break;
    case "leave":
      dropZone.classList.remove("dragover");
      break;
    case "drop": {
      dropZone.classList.remove("dragover");
      const [firstPath] = payload.paths ?? [];
      if (firstPath) {
        setSelectedFile(firstPath);
      }
      break;
    }
    default:
      break;
  }
}

function queryElement<T extends HTMLElement>(selector: string) {
  return document.querySelector<T>(selector);
}

function parsePositiveInt(input: HTMLInputElement | null, fallback: number) {
  if (!input) {
    return fallback;
  }
  const parsed = Number.parseInt(input.value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

function getOutputFormat() {
  const radio = document.querySelector<HTMLInputElement>(
    'input[name="output-format"]:checked'
  );
  return (radio?.value as OutputFormat) ?? "srt";
}

async function chooseFile(labelEl: HTMLElement | null, startBtn: HTMLButtonElement | null) {
  const selection = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: "Audio", extensions: ["mp3", "wav", "m4a", "flac", "aac", "ogg"] },
      { name: "Video", extensions: ["mp4", "mov", "mkv"] },
    ],
  });

  if (typeof selection === "string") {
    selectedFilePath = selection;
    if (labelEl) {
      labelEl.textContent = selection;
    }
  } else {
    selectedFilePath = null;
    if (labelEl) {
      labelEl.textContent = "No file selected";
    }
  }

  if (startBtn) {
    startBtn.disabled = !selectedFilePath;
  }
}

async function runTranscription(request: TranscriptionRequest, statusEl: HTMLElement | null) {
  const modelPath = request.model;
  const wavPath = request.filePath;
  const outputFormat = request.outputFormat; // "srt" | "txt" | "both"
  const maxSegmentLength = request.maxSegmentLength;
  const maxCharactersPerSegment = request.maxCharactersPerSegment;

  try {
    const transcript = await invoke<string>("transcribe_command", {
      modelPath,
      wavPath,
      outputFormat,
      maxSegmentLength,
      maxCharactersPerSegment,
    });
    console.log("Transcript:", transcript);
    // update state/UI with transcript

    if (statusEl) {
      statusEl.textContent = [
        "Parameters sent to backend (check Rust console):",
        JSON.stringify(request, null, 2),
      ].join("\n");
    }
  } catch (e) {
    console.error("Transcription error:", e);
  }
}

async function sendParameters(request: TranscriptionRequest, statusEl: HTMLElement | null) {
  if (statusEl) {
    statusEl.textContent = "Sending parameters to backend...";
  }

  await invoke("log_transcription_parameters", { request });

  if (statusEl) {
    statusEl.textContent = [
      "Parameters sent to backend (check Rust console):",
      JSON.stringify(request, null, 2),
    ].join("\n");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const chooseFileBtn = queryElement<HTMLButtonElement>("#browse-files");
  const selectedFileLabel = queryElement<HTMLElement>("#selected-file-label");
  const startBtn = queryElement<HTMLButtonElement>("#start-btn");
  const statusEl = queryElement<HTMLElement>("#status");
  const modelSelect = queryElement<HTMLSelectElement>("#model-select");
  const maxSegmentInput = queryElement<HTMLInputElement>("#max-segment-length");
  const maxCharInput = queryElement<HTMLInputElement>("#max-char-limit");
  const dropZone = queryElement<HTMLElement>("#file-drop-zone");
  const fileInput = queryElement<HTMLInputElement>("#file-input");

  if (statusEl) {
    statusEl.textContent = defaultStatusText;
  }

  function setSelectedFile(path: string | null) {
    selectedFilePath = path;
    if (selectedFileLabel) {
      selectedFileLabel.textContent = path ?? "No file selected";
    }
    if (startBtn) {
      startBtn.disabled = !path;
    }
  }

  chooseFileBtn?.addEventListener("click", () => {
    void chooseFile(selectedFileLabel, startBtn);
  });

  // Wire hidden file input (useful for native browse fallback)
  fileInput?.addEventListener("change", (ev) => {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    // Some environments (Tauri) expose a `path` property on File
    // If available, use it; otherwise use file name as fallback.
    // For proper backend usage, prefer OS file path from drag/drop or dialog.
    // Note: native Tauri `open` dialog returns full path so that flow is preferred.
    // Here we display user choice.
    // @ts-ignore
    const p = (f as any).path ?? f.name;
    setSelectedFile(p);
  });

  if (dropZone) {
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });
    dropZone.addEventListener("dragenter", (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });
    dropZone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
    });
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
      const dt = (e as DragEvent).dataTransfer;
      if (!dt) return;
      // Prefer full path from DataTransfer.files (available in Tauri)
      const file = dt.files?.[0];
      if (file) {
        // @ts-ignore
        const p = (file as any).path ?? file.name;
        setSelectedFile(p);
        return;
      }
      // Fallback: try to read text/plain data (e.g., some apps)
      const text = dt.getData("text");
      if (text) {
        setSelectedFile(text);
      }
    });
    // Click on drop zone should open native dialog
    dropZone.addEventListener("click", () => {
      // Trigger hidden file input as fallback; prefer Tauri open
      void chooseFile(selectedFileLabel, startBtn);
    });
  }
  void registerNativeDropHandlers(dropZone, (path) => {
    setSelectedFile(path);
  });

  // Prevent default dragover/drop on window so drop events reach the drop zone reliably
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    // Don't allow dropping files outside our drop zone (we handle inside dropZone)
    e.preventDefault();
  });

  startBtn?.addEventListener("click", async () => {
    if (!selectedFilePath) {
      if (statusEl) {
        statusEl.textContent = "Please select a file before starting.";
      }
      return;
    }

    const request: TranscriptionRequest = {
      filePath: selectedFilePath,
      outputFormat: getOutputFormat(),
      model: modelSelect?.value ?? "base",
      maxSegmentLength: parsePositiveInt(maxSegmentInput, 8),
      maxCharactersPerSegment: parsePositiveInt(maxCharInput, 80),
    };

    if (startBtn) {
      startBtn.disabled = true;
    }

    try {
      await runTranscription(request, statusEl);
    } catch (error) {
      console.error("Failed to reach backend:", error);
      if (statusEl) {
        statusEl.textContent = `Failed to send parameters: ${error}`;
      }
    } finally {
      if (startBtn) {
        startBtn.disabled = !selectedFilePath;
      }
    }
  });
});
