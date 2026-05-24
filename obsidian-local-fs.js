(() => {
  "use strict";

  const DB_NAME = "obsidian-local-notes";
  const DB_VERSION = 1;
  const STORE_NAME = "handles";
  const SELECTION_KEY = "vault-selection";
  const state = {
    db: null,
    documents: [],
    fileHandles: new Map(),
    notesFolderHandle: null,
    notesFolderName: null,
    vaultHandle: null,
    vaultName: null,
  };

  function iframeWindow() {
    const iframe = document.querySelector(".hover-editor iframe");
    return iframe && iframe.contentWindow;
  }

  function sendResponse(requestId, payload) {
    const target = iframeWindow();
    if (!target) return;
    target.postMessage(
      {
        action: "obsidian-fs:response",
        requestId,
        payload,
      },
      "*",
    );
  }

  function openDB() {
    if (state.db) return Promise.resolve(state.db);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        state.db = request.result;
        resolve(state.db);
      };
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });
  }

  async function dbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbSet(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const request = tx.objectStore(STORE_NAME).put(value, key);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbDelete(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const request = tx.objectStore(STORE_NAME).delete(key);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async function verifyPermission(handle, write = true) {
    if (!handle) return false;
    const options = write ? { mode: "readwrite" } : {};
    if ((await handle.queryPermission(options)) === "granted") return true;
    return (await handle.requestPermission(options)) === "granted";
  }

  function activeRoot() {
    return state.notesFolderHandle || state.vaultHandle;
  }

  function hash(value) {
    let result = 5381;
    for (let i = 0; i < value.length; i += 1) {
      result = (result << 5) + result + value.charCodeAt(i);
      result &= result;
    }
    return (result >>> 0).toString(36);
  }

  function sanitizeFileName(value) {
    const source = String(value || "Untitled").normalize("NFKC");
    const name = source
      .replace(/[<>:"/\\|?*\x00-\x1f#[\]^]/g, " ")
      .replace(/[^\p{L}\p{N}\s._()!-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+/, "")
      .replace(/[\s.]+$/, "")
      .slice(0, 140);
    if (!name || name === "." || name === "..") return "Untitled";
    return name;
  }

  function fallbackFileBase(title) {
    return `note-${hash(String(title || Date.now()))}`;
  }

  function isMissingFileError(error) {
    return !!(
      error &&
      (error.name === "NotFoundError" || /not\s*found/i.test(error.message || ""))
    );
  }

  function isInvalidFileNameError(error) {
    return !!(
      error &&
      (error.name === "TypeError" ||
        /name\s+is\s+not\s+allowed|not\s+allowed|invalid/i.test(error.message || ""))
    );
  }

  function parseFrontmatter(content) {
    const match = String(content || "").match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (!match) return {};
    const data = {};
    let currentKey = null;
    for (const rawLine of match[1].split("\n")) {
      const line = rawLine.trimEnd();
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const item = line.match(/^\s+-\s*(.+)$/);
      if (item && currentKey && Array.isArray(data[currentKey])) {
        data[currentKey].push(item[1].trim().replace(/^["']|["']$/g, ""));
        continue;
      }
      const pair = line.match(/^([\w-]+)\s*:\s*(.*)$/);
      if (!pair) continue;
      currentKey = pair[1].toLowerCase().replace(/-/g, "_");
      let value = pair[2].trim();
      if (!value) {
        data[currentKey] = [];
      } else if (value.startsWith("[") && value.endsWith("]")) {
        data[currentKey] = value
          .slice(1, -1)
          .split(",")
          .map((part) => part.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      } else {
        data[currentKey] = value.replace(/^["']|["']$/g, "");
      }
    }
    return data;
  }

  function metadataFromContent(content, fallback = {}) {
    const frontmatter = parseFrontmatter(content);
    const sourceUrl =
      frontmatter.source ||
      frontmatter.source_url ||
      frontmatter.url ||
      frontmatter.link ||
      fallback.sourceUrl ||
      null;
    return {
      createdWith: frontmatter.created_with || fallback.createdWith || "Obsidian YT Notes",
      frontmatter,
      sourceUrl,
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : fallback.tags || [],
      videoKey: frontmatter.video_key || fallback.videoKey || null,
      videoId: frontmatter.video_id || fallback.videoId || null,
    };
  }

  async function readFile(fileHandle) {
    const file = await fileHandle.getFile();
    return file.text();
  }

  async function scanDirectory(directoryHandle, prefix = "", output = []) {
    for await (const [name, handle] of directoryHandle.entries()) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "directory") {
        await scanDirectory(handle, path, output);
      } else if (handle.kind === "file" && name.toLowerCase().endsWith(".md")) {
        output.push({ path, handle });
      }
    }
    return output;
  }

  async function scanDocuments() {
    const root = activeRoot();
    if (!root) return [];
    state.fileHandles.clear();
    const files = await scanDirectory(root);
    const documents = [];
    for (const item of files) {
      try {
        const file = await item.handle.getFile();
        const content = await readFile(item.handle);
        const metadata = metadataFromContent(content);
        const id = `doc_${hash(item.path)}`;
        state.fileHandles.set(id, item.handle);
        documents.push({
          documentId: id,
          filename: item.path.split("/").pop(),
          originalFilename: item.path.split("/").pop(),
          path: item.path,
          title: metadata.frontmatter.title || item.path.replace(/\.md$/i, ""),
          createdAt: metadata.frontmatter.created || new Date(file.lastModified).toISOString(),
          updatedAt: new Date(file.lastModified).toISOString(),
          size: file.size,
          metadata,
        });
      } catch (_) {}
    }
    state.documents = documents;
    return documents;
  }

  async function uniqueFileName(title) {
    const root = activeRoot();
    let base = sanitizeFileName(title);
    let usedFallback = false;
    let candidate = `${base}.md`;
    let index = 2;
    for (;;) {
      try {
        await root.getFileHandle(candidate, { create: false });
        candidate = `${base} ${index}.md`;
        index += 1;
      } catch (error) {
        if (isMissingFileError(error)) {
          return candidate;
        }
        if (isInvalidFileNameError(error) && !usedFallback) {
          base = fallbackFileBase(title);
          candidate = `${base}.md`;
          index = 2;
          usedFallback = true;
          continue;
        }
        throw error;
      }
    }
  }

  async function getWritableFileHandle(root, filename, title) {
    try {
      return {
        filename,
        handle: await root.getFileHandle(filename, { create: true }),
      };
    } catch (error) {
      if (!isInvalidFileNameError(error)) throw error;
      const fallback = await uniqueFileName(fallbackFileBase(title));
      return {
        filename: fallback,
        handle: await root.getFileHandle(fallback, { create: true }),
      };
    }
  }

  async function findDocumentByFilename(filename) {
    await scanDocuments();
    return state.documents.find((doc) => doc.filename === filename || doc.path === filename) || null;
  }

  async function createDocument(payload) {
    const root = activeRoot();
    if (!root) throw new Error("No notes folder selected.");
    const filename = await uniqueFileName(payload.title || "Untitled");
    const file = await getWritableFileHandle(root, filename, payload.title || "Untitled");
    const writable = await file.handle.createWritable();
    await writable.write(payload.content || "");
    await writable.close();
    const document = await findDocumentByFilename(file.filename);
    return { success: true, document };
  }

  function selectionPayload(success = true) {
    return {
      success,
      vaultName: state.vaultName,
      notesFolderName: state.notesFolderName,
    };
  }

  async function storeSelection() {
    await dbSet(SELECTION_KEY, {
      notesFolderHandle: state.notesFolderHandle,
      notesFolderName: state.notesFolderName,
      storedAt: new Date().toISOString(),
      vaultHandle: state.vaultHandle || null,
      vaultName: state.vaultName || null,
    });
  }

  async function initialize() {
    const notesFolderHandle = await window.showDirectoryPicker({
      id: "obsidian-notes-folder",
      mode: "readwrite",
      startIn: "documents",
    });
    if (!(await verifyPermission(notesFolderHandle, true))) {
      throw new Error("Write permission was not granted for the notes folder.");
    }
    state.vaultHandle = null;
    state.vaultName = null;
    state.notesFolderHandle = notesFolderHandle;
    state.notesFolderName = notesFolderHandle.name;
    await storeSelection();
    await scanDocuments();
    return selectionPayload(true);
  }

  async function checkStored() {
    const stored = await dbGet(SELECTION_KEY);
    const storedFolder = stored && (stored.notesFolderHandle || stored.vaultHandle);
    return {
      success: true,
      hasStoredVault: !!storedFolder,
      notesFolderName:
        stored && (stored.notesFolderName || stored.vaultName || (storedFolder && storedFolder.name)),
      storedAt: stored && stored.storedAt,
      vaultName: stored && (stored.notesFolderName || stored.vaultName),
    };
  }

  async function reconnect() {
    const stored = await dbGet(SELECTION_KEY);
    const storedFolder = stored && (stored.notesFolderHandle || stored.vaultHandle);
    if (!storedFolder) {
      return { success: false, reason: "no_stored_handle" };
    }
    state.vaultHandle = null;
    state.vaultName = null;
    state.notesFolderHandle = storedFolder;
    state.notesFolderName = stored.notesFolderName || stored.vaultName || storedFolder.name;
    if (!(await verifyPermission(state.notesFolderHandle, true))) {
      return { success: false, reason: "notes_folder_permission_denied" };
    }
    await scanDocuments();
    return selectionPayload(true);
  }

  async function updateDocument(payload) {
    if (!payload.documentId) throw new Error("Document ID is required.");
    let handle = state.fileHandles.get(payload.documentId);
    if (!handle) {
      await scanDocuments();
      handle = state.fileHandles.get(payload.documentId);
    }
    if (!handle) throw new Error("Document was not found.");
    const writable = await handle.createWritable();
    await writable.write(payload.content || "");
    await writable.close();
    await scanDocuments();
    const document =
      state.documents.find((doc) => doc.documentId === payload.documentId) || null;
    return { success: true, document };
  }

  async function readDocument(payload) {
    if (!payload.documentId) throw new Error("Document ID is required.");
    let handle = state.fileHandles.get(payload.documentId);
    if (!handle) {
      await scanDocuments();
      handle = state.fileHandles.get(payload.documentId);
    }
    if (!handle) throw new Error("Document was not found.");
    const content = await readFile(handle);
    const document =
      state.documents.find((doc) => doc.documentId === payload.documentId) || null;
    return { success: true, content, document };
  }

  async function directoryForPath(path) {
    const root = activeRoot();
    if (!root) throw new Error("No notes folder selected.");
    const parts = String(path || "")
      .split("/")
      .filter(Boolean);
    const filename = parts.pop();
    if (!filename) throw new Error("Document path is invalid.");
    let directory = root;
    for (const part of parts) {
      directory = await directory.getDirectoryHandle(part, { create: false });
    }
    return { directory, filename };
  }

  async function deleteDocument(payload) {
    if (!payload.documentId) throw new Error("Document ID is required.");
    await scanDocuments();
    const document = state.documents.find((doc) => doc.documentId === payload.documentId);
    if (!document) throw new Error("Document was not found.");
    const { directory, filename } = await directoryForPath(document.path || document.filename);
    await directory.removeEntry(filename);
    state.fileHandles.delete(payload.documentId);
    await scanDocuments();
    return { success: true, document, documents: state.documents };
  }

  async function resetSelection() {
    await dbDelete(SELECTION_KEY);
    state.documents = [];
    state.fileHandles.clear();
    state.notesFolderHandle = null;
    state.notesFolderName = null;
    state.vaultHandle = null;
    state.vaultName = null;
    return { success: true };
  }

  const handlers = {
    "check-stored": checkStored,
    "create-document": createDocument,
    "delete-document": deleteDocument,
    initialize,
    "list-documents": async () => ({ success: true, documents: await scanDocuments() }),
    "read-document": readDocument,
    reconnect,
    reset: resetSelection,
    "update-document": updateDocument,
  };

  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (!message.action || !message.action.startsWith("obsidian-fs:")) return;
    const action = message.action.replace("obsidian-fs:", "");
    const requestId = message.payload && message.payload.requestId;
    const payload = (message.payload && message.payload.payload) || {};
    const handler = handlers[action];
    if (!handler) {
      sendResponse(requestId, {
        success: false,
        error: `Unknown file system action: ${action}`,
      });
      return;
    }
    Promise.resolve()
      .then(() => handler(payload))
      .then((response) => sendResponse(requestId, response || { success: true }))
      .catch((error) =>
        sendResponse(requestId, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
  });
})();
