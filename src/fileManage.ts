import { create, remove, exists, BaseDirectory, mkdir } from '@tauri-apps/plugin-fs';
import { fetch } from '@tauri-apps/plugin-http';
import { appLocalDataDir, join } from '@tauri-apps/api/path';


// --- Types & Config ---
type ModelKey = 'tiny' | 'base' | 'small' | 'medium' | 'large';

interface ModelState {
    state: 'not-downloaded' | 'downloading' | 'downloaded';
    progress: number;
}

const MODEL_KEYS: ModelKey[] = ['tiny', 'base', 'small', 'medium', 'large'];
const STORAGE_KEY = 'app:modelStates:v2';

// REPLACE THESE WITH YOUR REAL URLS
const MODEL_URLS: Record<ModelKey, string> = {
    tiny: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    small: 'https://huggingface.co/some-repo/small.bin',
    medium: 'https://huggingface.co/some-repo/medium.bin',
    large: 'https://huggingface.co/some-repo/large.bin',
};

const abortControllers: Record<string, AbortController> = {};

// --- State Management ---

function defaultState(): Record<ModelKey, ModelState> {
    const obj: any = {};
    MODEL_KEYS.forEach(k => obj[k] = { state: 'not-downloaded', progress: 0 });
    return obj;
}

function loadStates(): Record<ModelKey, ModelState> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaultState();
        const parsed = JSON.parse(raw);
        // Just merge; do NOT mutate states here
        return { ...defaultState(), ...parsed };
    } catch (e) {
        return defaultState();
    }
}

function normalizeStatesOnStartup() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;

        const parsed = JSON.parse(raw) as Record<ModelKey, ModelState>;
        let changed = false;

        MODEL_KEYS.forEach((key) => {
            const st = parsed[key];

            // If we don't have anything, skip
            if (!st) return;

            // Any interrupted download or weird state -> reset to "not-downloaded", 0%
            if (st.state === 'downloading' || st.state === 'not-downloaded') {
                if (st.progress !== 0 || st.state === 'downloading') {
                    parsed[key] = { state: 'not-downloaded', progress: 0 };
                    changed = true;
                }
            }

            // Optional: if you *ever* saved a downloaded model with progress != 100,
            // you can normalize that too:
            if (st.state === 'downloaded' && st.progress !== 100) {
                parsed[key].progress = 100;
                changed = true;
            }
        });

        if (changed) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        }
    } catch {
        // ignore
    }
}


function saveStates(states: Record<ModelKey, ModelState>) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
}

async function getModelPath(key: string) {
    // Files will save to: %APPDATA%/com.yourapp/models/key.bin
    return `models/${key}.bin`;
}

// --- UI Rendering Logic (The missing piece) ---

function createActionButton(text: string, cls: string, handler: () => void) {
    const btn = document.createElement('button');
    btn.className = cls;
    btn.textContent = text;
    btn.addEventListener('click', handler);
    return btn;
}

function render() {
    const container = document.getElementById('models');
    if (!container) return;

    const states = loadStates();

    MODEL_KEYS.forEach(key => {
        // Try to find existing element for this model
        let item = document.getElementById(`model-row-${key}`);
        
        // 1. Create it if it doesn't exist
        if (!item) {
            item = document.createElement('div');
            item.id = `model-row-${key}`; // Add ID for easy lookup
            item.className = 'model-item';
            
            // Structure skeleton (empty initially)
            item.innerHTML = `
                <div class="model-info">
                    <div class="model-name">${key.charAt(0).toUpperCase() + key.slice(1)}</div>
                    <div class="model-status" id="status-${key}"></div>
                </div>
                <div class="model-actions" id="actions-${key}"></div>
                <div class="model-progress-wrap">
                    <div class="model-progress" id="prog-${key}"></div>
                </div>
            `;
            container.appendChild(item);
        }

        // 2. Update specific elements (DOM Diffing)
        const statusEl = document.getElementById(`status-${key}`);
        const actionsEl = document.getElementById(`actions-${key}`);
        const progEl = document.getElementById(`prog-${key}`);

        // Update Status Text
        if (statusEl) {
            if (states[key].state === 'not-downloaded') statusEl.textContent = 'Not downloaded';
            else if (states[key].state === 'downloading') statusEl.textContent = `Downloading (${states[key].progress}%)`;
            else statusEl.textContent = 'Downloaded';
        }

        // Update Progress Bar Width
        if (progEl) {
            progEl.style.width = `${states[key].progress}%`;
        }

        // Update Buttons (Only recreate if state changed to prevent click loss)
        if (actionsEl) {
            // Check what button is currently there vs what we need
            const currentBtnType = actionsEl.dataset.btnType;
            const targetBtnType = states[key].state;

            if (currentBtnType !== targetBtnType) {
                actionsEl.innerHTML = ''; // Clear old buttons
                actionsEl.dataset.btnType = targetBtnType; // Tag it

                if (states[key].state === 'not-downloaded') {
                    const dl = createActionButton('Download', 'ghost-btn', () => startDownload(key));
                    actionsEl.appendChild(dl);
                } else if (states[key].state === 'downloading') {
                    const cancel = createActionButton('Cancel', 'ghost-btn', () => cancelDownload(key));
                    actionsEl.appendChild(cancel);
                } else if (states[key].state === 'downloaded') {
                    const del = createActionButton('Delete', 'ghost-btn', () => deleteDownload(key));
                    actionsEl.appendChild(del);
                }
            }
        }
    });
}

// --- Core Logic ---

async function startDownload(key: ModelKey) {
    const states = loadStates();
    if (states[key].state === 'downloading') return;

    const controller = new AbortController();
    abortControllers[key] = controller;

    try {
        states[key].state = 'downloading';
        states[key].progress = 0;
        saveStates(states);
        render(); // Update UI

        const filename = await getModelPath(key);

        console.log('Creating models directory if not exists');

        await mkdir('models', { 
            baseDir: BaseDirectory.AppLocalData, 
            recursive: true 
        });

        console.log('Directory created! Starting fetch...');

        // Start Fetch
        const response = await fetch(MODEL_URLS[key], {
            method: 'GET',
            signal: controller.signal,
        });

        console.log('Fetch started', response);

        if (!response.ok || !response.body) throw new Error('Network error');

        const contentLength = response.headers.get('content-length');
        const totalLength = contentLength ? parseInt(contentLength, 10) : 0;
        
        // Write file
        const fileHandle = await create(filename, { baseDir: BaseDirectory.AppLocalData });
        const reader = response.body.getReader();
        let receivedLength = 0;
        let lastRenderTime = 0;

        while (true) {
            const latest = loadStates();
            if (latest[key].state !== 'downloading') {
                break;
            }
            const { done, value } = await reader.read();
            if (done) break;

            await fileHandle.write(value);

            receivedLength += value.length;
            if (totalLength > 0) {
                const percent = Math.round((receivedLength / totalLength) * 100);
                
                // Only update state if percent changed
                if (percent !== states[key].progress) {
                    states[key].progress = percent;
                    // Don't save to localStorage on every % (too slow)
                    // saveStates(states); 
                    
                    // Throttle UI updates to roughly 30fps
                    const now = Date.now();
                    if (now - lastRenderTime > 30) {
                        saveStates(states); // Save occasionally
                        render();
                        lastRenderTime = now;
                        console.log(`Download ${key}: ${percent}%`);
                    }
                }
            }
        }

        const finalStates = loadStates();
        if (finalStates[key].state !== 'downloading') return;

        
        // Ensure we end on 100%
        states[key].progress = 100;
        saveStates(states);
        render();

        await fileHandle.close();

        const baseDir = await appLocalDataDir();
        const fullPath = await join(baseDir, 'models', `${key}.bin`);
        console.log('✅ File successfully saved to:', fullPath);
        
        // Success
        states[key].state = 'downloaded';
        states[key].progress = 100;
        saveStates(states);
        render();

    } catch (error: any) {
        if (error.name === 'AbortError') return; // Cancelled intentionally
        
        console.error('Download failed', error);
        states[key].state = 'not-downloaded';
        saveStates(states);
        render();
    } finally {
        delete abortControllers[key];
    }
}

async function cancelDownload(key: ModelKey) {
    if (abortControllers[key]) {
        abortControllers[key].abort();
        delete abortControllers[key];
    }

    // Force-reset state for this key
    const states = loadStates();
    states[key] = {
        state: 'not-downloaded',
        progress: 0,
    };
    
    saveStates(states);
    render();

    console.log('Cancelled download for', key);

    // Cleanup partial file
    try {
        const filename = await getModelPath(key);
        await remove(filename, { baseDir: BaseDirectory.AppLocalData });
        console.log('Removed partial file for', key);
    } catch (e) { /* ignore */ }
}

async function deleteDownload(key: ModelKey) {
    try {
        const filename = await getModelPath(key);
        await remove(filename, { baseDir: BaseDirectory.AppLocalData });
        
        const states = loadStates();
        states[key].state = 'not-downloaded';
        states[key].progress = 0;
        saveStates(states);
        render();
        console.log('Deleted model file for', key);
    } catch (e) {
        console.error('Failed to delete', e);
    }
}

async function checkExistingFiles() {
    const states = loadStates();
    let changed = false;

    for (const key of MODEL_KEYS) {
        if (states[key].state === 'downloaded') {
            const filename = await getModelPath(key);
            const existsOnDisk = await exists(filename, { baseDir: BaseDirectory.AppLocalData });
            if (!existsOnDisk) {
                states[key].state = 'not-downloaded';
                states[key].progress = 0;
                changed = true;
            }
        }
    }

    if (changed) saveStates(states);
    render();
}

// --- Initialization ---

// This starts the whole process when the page loads
document.addEventListener('DOMContentLoaded', () => {
    normalizeStatesOnStartup();
    render(); // Initial draw
    checkExistingFiles(); // Verify disk state
});