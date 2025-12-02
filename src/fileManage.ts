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
    tiny: 'https://huggingface.co/some-repo/tiny.bin',
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
        
        // Reset "downloading" to "not-downloaded" on refresh 
        // because the stream is dead
        Object.keys(parsed).forEach((k) => {
             if (parsed[k].state === 'downloading') {
                 parsed[k].state = 'not-downloaded';
                 parsed[k].progress = 0;
             }
        });
        return { ...defaultState(), ...parsed };
    } catch (e) {
        return defaultState();
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
    if (!container) return; // Guard clause in case HTML is missing

    container.innerHTML = ''; // Clear current list
    const states = loadStates();

    MODEL_KEYS.forEach(key => {
        const item = document.createElement('div');
        item.className = 'model-item';

        // Left side (Title + Status)
        const left = document.createElement('div');
        left.className = 'model-info';
        
        const title = document.createElement('div');
        title.className = 'model-name';
        title.textContent = key.charAt(0).toUpperCase() + key.slice(1); // Capitalize
        
        const status = document.createElement('div');
        status.className = 'model-status';
        if (states[key].state === 'not-downloaded') status.textContent = 'Not downloaded';
        else if (states[key].state === 'downloading') status.textContent = `Downloading (${states[key].progress}%)`;
        else status.textContent = 'Downloaded';

        left.appendChild(title);
        left.appendChild(status);

        // Actions (Buttons)
        const actions = document.createElement('div');
        actions.className = 'model-actions';

        if (states[key].state === 'not-downloaded') {
            const dl = createActionButton('Download', 'ghost-btn', () => startDownload(key));
            actions.appendChild(dl);
        }

        if (states[key].state === 'downloading') {
            const cancel = createActionButton('Cancel', 'ghost-btn', () => cancelDownload(key));
            actions.appendChild(cancel);
        }

        if (states[key].state === 'downloaded') {
            const del = createActionButton('Delete', 'ghost-btn', () => deleteDownload(key));
            actions.appendChild(del);
        }

        // Progress Bar
        const progWrap = document.createElement('div');
        progWrap.className = 'model-progress-wrap';
        const prog = document.createElement('div');
        prog.className = 'model-progress';
        prog.style.width = states[key].progress + '%';
        progWrap.appendChild(prog);

        // Assemble
        item.appendChild(left);
        item.appendChild(actions);
        item.appendChild(progWrap);
        container.appendChild(item);
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

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            await fileHandle.write(value);

            receivedLength += value.length;
            if (totalLength > 0) {
                const percent = Math.round((receivedLength / totalLength) * 100);
                if (percent !== states[key].progress) {
                    states[key].progress = percent;
                    saveStates(states);
                    render(); // Update UI
                    if (percent % 10 === 0) {
                        console.log(`Download progress for ${key}: ${percent}%`);
                    }
                }
            }
        }

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
    
    // Cleanup UI state
    const states = loadStates();
    states[key].state = 'not-downloaded';
    states[key].progress = 0;
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
    render(); // Initial draw
    checkExistingFiles(); // Verify disk state
});