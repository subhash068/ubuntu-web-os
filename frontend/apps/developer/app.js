// IDE/Code Editor Application Logic
let editActiveMode = 'vscode'; // 'vscode', 'vim', 'nano'
let editOpenFile = null;
let editEditor = null;
let editOriginalContent = '';
let editVimSubMode = 'NORMAL'; // 'NORMAL', 'INSERT'
let editCurrentDir = '/mnt/d/ubuntu-web-os'; // Default project root folder

// Register Editor Window configuration in global desktop environment
if (typeof windows !== 'undefined') {
    windows['editor'] = {
        title: 'IDE Code Editor',
        id: 'editor',
        min: false,
        max: false,
        active: false
    };
}

// Hook into Ubuntu Web OS window activation
document.addEventListener('DOMContentLoaded', () => {
    const editorIcon = document.getElementById('shortcut-editor') || document.querySelector('.start-menu-item[onclick*="editor"]');
    if (editorIcon) {
        const oldOpen = window.openWindow;
        window.openWindow = function(winId) {
            oldOpen(winId);
            if (winId === 'editor') {
                initEditorApp();
            }
        };
    }
});

async function initEditorApp() {
    // 1. Initialize Monaco Editor if not already initialized
    const container = document.getElementById('edit-monaco-container');
    if (container && !editEditor) {
        // Wait for monaco library AMD loader to be ready
        if (typeof monaco !== 'undefined') {
            createMonacoEditorInstance();
        } else {
            // Poll or check if require is ready
            const interval = setInterval(() => {
                if (typeof monaco !== 'undefined') {
                    clearInterval(interval);
                    createMonacoEditorInstance();
                }
            }, 200);
        }
    }
    
    // 2. Load File Tree
    await loadEditorFileTree();
    
    // 3. Register Global Keyboard Listeners for Vim and Nano Modes
    registerEditorKeybindings();
}

function createMonacoEditorInstance() {
    const container = document.getElementById('edit-monaco-container');
    editEditor = monaco.editor.create(container, {
        value: '// Double-click a file in the sidebar explorer to open and edit.\n',
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: true },
        fontSize: 13,
        lineNumbers: 'on'
    });
    
    // Listen for editor changes to update line/col status bar indicators
    editEditor.onDidChangeCursorPosition((e) => {
        updateEditorStatusBar();
    });
}

async function loadEditorFileTree() {
    const list = document.getElementById('edit-files-list');
    if (!list) return;
    
    list.innerHTML = `<div style="padding: 10px; font-size: 0.75rem; color: var(--edit-text); opacity: 0.5;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>`;
    
    try {
        const res = await apiCommand('ls', { path: editCurrentDir });
        if (res.stderr || res.error) {
            list.innerHTML = `<div style="padding: 10px; font-size: 0.75rem; color: #ef4444;"><i class="fa-solid fa-circle-exclamation"></i> Error loading workspace files.</div>`;
            return;
        }
        
        const lines = (res.stdout || '').trim().split('\n').filter(line => line.trim() && line !== './' && line !== '../');
        
        let html = '';
        
        // Add a back item if we're not at the root
        if (editCurrentDir !== '/' && editCurrentDir !== '') {
            const parts = editCurrentDir.split('/');
            parts.pop();
            const parent = parts.join('/') || '/';
            html += `
                <div class="edit-file-item" onclick="changeEditorDir('${parent}')" style="opacity: 0.65;">
                    <i class="fa-solid fa-turn-up"></i>
                    <span>.. (Parent Dir)</span>
                </div>
            `;
        }
        
        // Separate dirs and files from the output lines
        const dirs = [];
        const files = [];
        
        lines.forEach(item => {
            if (item.endsWith('/')) {
                dirs.push(item.slice(0, -1));
            } else {
                files.push(item);
            }
        });
        
        dirs.sort().forEach(dname => {
            html += `
                <div class="edit-file-item" onclick="changeEditorDir('${editCurrentDir}/${dname}')">
                    <i class="fa-solid fa-folder" style="color: #f59e0b;"></i>
                    <span>${dname}</span>
                </div>
            `;
        });
        
        files.sort().forEach(fname => {
            const ext = fname.split('.').pop().toLowerCase();
            const icon = ext === 'js' ? 'fa-brands fa-js' : ext === 'css' ? 'fa-brands fa-css3-alt' : ext === 'html' ? 'fa-brands fa-html5' : ext === 'json' ? 'fa-solid fa-braces' : 'fa-solid fa-file-lines';
            const color = ext === 'js' ? '#f59e0b' : ext === 'css' ? '#3b82f6' : ext === 'html' ? '#ef4444' : ext === 'json' ? '#10b981' : '#fff';
            const fpath = `${editCurrentDir}/${fname}`;
            const isActive = editOpenFile === fpath ? 'active' : '';
            
            html += `
                <div class="edit-file-item ${isActive}" onclick="openFileInEditor('${fpath}')">
                    <i class="${icon}" style="color: ${color};"></i>
                    <span>${fname}</span>
                </div>
            `;
        });
        
        if (html === '') {
            list.innerHTML = `<div style="padding: 10px; font-size: 0.75rem; color: var(--edit-text); opacity: 0.5;">Empty Folder</div>`;
        } else {
            list.innerHTML = html;
        }
    } catch (e) {
        console.error("Error loading editor file tree:", e);
    }
}

async function changeEditorDir(newPath) {
    editCurrentDir = newPath;
    await loadEditorFileTree();
}

async function openFileInEditor(filePath) {
    if (!editEditor) return;
    
    // Check if dirty
    if (isEditorFileDirty()) {
        const confirmSave = confirm("The current file has unsaved changes. Do you want to discard them?");
        if (!confirmSave) return;
    }
    
    showEditorLoader(true);
    try {
        const res = await apiCommand('cat', { path: filePath });
        if (res.error) {
            alert(`Failed to load file: ${res.error}`);
            return;
        }
        
        editOpenFile = filePath;
        editOriginalContent = res.content || '';
        
        // Determine language mode
        const ext = filePath.split('.').pop().toLowerCase();
        let lang = 'javascript';
        if (ext === 'css') lang = 'css';
        else if (ext === 'html') lang = 'html';
        else if (ext === 'py') lang = 'python';
        else if (ext === 'json') lang = 'json';
        else if (ext === 'sh') lang = 'shell';
        else if (ext === 'c' || ext === 'cpp') lang = 'cpp';
        
        const model = monaco.editor.createModel(editOriginalContent, lang);
        editEditor.setModel(model);
        
        // Update UI states
        document.getElementById('edit-open-tab-name').innerText = filePath.split('/').pop();
        document.getElementById('edit-open-tab').style.display = 'flex';
        
        // Highlight active sidebar file
        await loadEditorFileTree();
        
        // Reset Vim mode status
        editVimSubMode = 'NORMAL';
        updateEditorStatusBar();
    } catch (e) {
        console.error("Error opening file:", e);
    } finally {
        showEditorLoader(false);
    }
}

function showEditorLoader(show) {
    const loader = document.getElementById('edit-loader');
    if (loader) loader.style.display = show ? 'flex' : 'none';
}

function isEditorFileDirty() {
    if (!editEditor || !editOpenFile) return false;
    return editEditor.getValue() !== editOriginalContent;
}

// ---------------- SWITCHING MODES ----------------
function switchEditorMode(mode) {
    editActiveMode = mode;
    
    // Toggle active selector class
    document.querySelectorAll('.edit-mode-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`edit-btn-${mode}`);
    if (activeBtn) activeBtn.classList.add('active');
    
    // Toggle editor UI bars
    const vimBar = document.getElementById('edit-vim-container');
    const nanoBar = document.getElementById('edit-nano-container');
    
    if (mode === 'vim') {
        vimBar.style.display = 'flex';
        nanoBar.style.display = 'none';
        editVimSubMode = 'NORMAL';
        if (editEditor) {
            editEditor.updateOptions({ readOnly: true }); // Prevent typing in normal mode
        }
    } else if (mode === 'nano') {
        vimBar.style.display = 'none';
        nanoBar.style.display = 'flex';
        if (editEditor) {
            editEditor.updateOptions({ readOnly: false });
        }
    } else {
        // VS Code mode
        vimBar.style.display = 'none';
        nanoBar.style.display = 'none';
        if (editEditor) {
            editEditor.updateOptions({ readOnly: false });
        }
    }
    
    updateEditorStatusBar();
}

function updateEditorStatusBar() {
    const fileLabel = document.getElementById('edit-status-file');
    const cursorLabel = document.getElementById('edit-status-cursor');
    const modeLabel = document.getElementById('edit-status-mode');
    
    if (fileLabel) fileLabel.innerText = editOpenFile ? editOpenFile : 'No File Open';
    
    if (editEditor && cursorLabel) {
        const pos = editEditor.getPosition();
        cursorLabel.innerText = pos ? `Ln ${pos.lineNumber}, Col ${pos.column}` : 'Ln 1, Col 1';
    }
    
    if (modeLabel) {
        if (editActiveMode === 'vim') {
            modeLabel.innerText = `VIM - ${editVimSubMode}`;
        } else if (editActiveMode === 'nano') {
            modeLabel.innerText = 'NANO MODE';
        } else {
            modeLabel.innerText = 'VS CODE MODE';
        }
    }
}

// ---------------- KEYBOARD BINDINGS (VIM & NANO SIMULATION) ----------------
function registerEditorKeybindings() {
    window.addEventListener('keydown', (e) => {
        // Verify that the editor window is focused/active
        const editorWin = document.getElementById('win-editor');
        if (!editorWin || editorWin.style.display === 'none' || !editEditor) return;
        
        // NANO SHORTCUTS (e.g. Ctrl+O to write, Ctrl+X to exit/close)
        if (editActiveMode === 'nano') {
            if (e.ctrlKey && e.key.toLowerCase() === 'o') {
                e.preventDefault();
                saveEditorFile();
            } else if (e.ctrlKey && e.key.toLowerCase() === 'x') {
                e.preventDefault();
                closeEditorFile();
            } else if (e.ctrlKey && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                nanoCutTextLine();
            }
        }
        
        // VIM NORMAL KEYSTROKES
        if (editActiveMode === 'vim') {
            if (editVimSubMode === 'NORMAL') {
                // Intercept normal keys
                const key = e.key.toLowerCase();
                const pos = editEditor.getPosition();
                
                if (e.key === 'Escape') {
                    // Safety switch to NORMAL mode
                    return;
                }
                
                // If focus is inside the vim command bar input, don't intercept keys
                if (document.activeElement === document.getElementById('edit-vim-cmd')) {
                    return;
                }
                
                e.preventDefault();
                
                if (e.key === ':') {
                    openVimCommandBar();
                } else if (key === 'i') {
                    // Switch to insert mode
                    editVimSubMode = 'INSERT';
                    editEditor.updateOptions({ readOnly: false });
                    updateEditorStatusBar();
                } else if (key === 'h') {
                    // Cursor left
                    editEditor.setPosition({ lineNumber: pos.lineNumber, column: Math.max(1, pos.column - 1) });
                } else if (key === 'l') {
                    // Cursor right
                    editEditor.setPosition({ lineNumber: pos.lineNumber, column: pos.column + 1 });
                } else if (key === 'k') {
                    // Cursor up
                    editEditor.setPosition({ lineNumber: Math.max(1, pos.lineNumber - 1), column: pos.column });
                } else if (key === 'j') {
                    // Cursor down
                    editEditor.setPosition({ lineNumber: pos.lineNumber + 1, column: pos.column });
                } else if (key === 'x') {
                    // Delete character under cursor
                    const model = editEditor.getModel();
                    const range = new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column + 1);
                    editEditor.executeEdits('', [{ range: range, text: '' }]);
                }
            } else if (editVimSubMode === 'INSERT') {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    // Switch back to normal mode
                    editVimSubMode = 'NORMAL';
                    editEditor.updateOptions({ readOnly: true });
                    updateEditorStatusBar();
                }
            }
        }
    });
}

function openVimCommandBar() {
    const vimInput = document.getElementById('edit-vim-cmd');
    if (vimInput) {
        vimInput.value = '';
        vimInput.focus();
    }
}

function handleVimCommandSubmit(e) {
    if (e.key !== 'Enter') return;
    
    const input = document.getElementById('edit-vim-cmd');
    if (!input) return;
    
    const cmd = input.value.trim();
    input.value = '';
    input.blur();
    
    if (cmd === ':w' || cmd === 'w') {
        saveEditorFile();
    } else if (cmd === ':q' || cmd === 'q') {
        closeEditorFile();
    } else if (cmd === ':wq' || cmd === 'wq') {
        saveEditorFile().then(() => {
            closeEditorFile();
        });
    } else if (cmd === ':q!' || cmd === 'q!') {
        // Discard edits and close
        editOriginalContent = editEditor.getValue(); // Bypass dirty check
        closeEditorFile();
    } else {
        showAwsToast(`Vim command: ${cmd} is not mapped in this simulator. Try :w, :q, :wq`, "warning");
    }
}

// ---------------- SAVE AND CLOSE FILE ACTIONS ----------------
async function saveEditorFile() {
    if (!editEditor || !editOpenFile) {
        showAwsToast("No file is currently open to save.", "warning");
        return;
    }
    
    showEditorLoader(true);
    try {
        const content = editEditor.getValue();
        // Convert to base64 encoding to write safely
        const base64 = btoa(unescape(encodeURIComponent(content)));
        
        const res = await apiCommand('write_file_base64', { path: editOpenFile, b64: base64 });
        if (res.error) {
            alert(`Failed to save file: ${res.error}`);
            return;
        }
        
        editOriginalContent = content;
        showAwsToast("File saved successfully!", "success");
    } catch (e) {
        console.error("Failed to save file:", e);
    } finally {
        showEditorLoader(false);
    }
}

function closeEditorFile() {
    if (isEditorFileDirty()) {
        const discard = confirm("File has unsaved changes. Do you want to discard them?");
        if (!discard) return;
    }
    
    editOpenFile = null;
    editOriginalContent = '';
    
    if (editEditor) {
        editEditor.setValue('// Double-click a file in the sidebar explorer to open and edit.\n');
    }
    
    document.getElementById('edit-open-tab').style.display = 'none';
    loadEditorFileTree();
    updateEditorStatusBar();
}

// Nano Cut current line function helper
function nanoCutTextLine() {
    if (!editEditor) return;
    const pos = editEditor.getPosition();
    const model = editEditor.getModel();
    
    // Monaco command to delete current line
    editEditor.trigger('keyboard', 'editor.action.deleteLines', null);
    showAwsToast("Line cut", "info");
}
