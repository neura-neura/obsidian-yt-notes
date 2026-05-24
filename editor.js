(() => {
  "use strict";

  const els = {
    activeFile: document.getElementById("activeFile"),
    closePanel: document.getElementById("closePanel"),
    connectVault: document.getElementById("connectVault"),
    contextLabel: document.getElementById("contextLabel"),
    folderStatus: document.getElementById("folderStatus"),
    newNote: document.getElementById("newNote"),
    noteBody: document.getElementById("noteBody"),
    noteEditor: document.getElementById("noteEditor"),
    noteSource: document.getElementById("noteSource"),
    noteTitle: document.getElementById("noteTitle"),
    notesListTitle: document.getElementById("notesListTitle"),
    notesList: document.getElementById("notesList"),
    refreshNotes: document.getElementById("refreshNotes"),
    saveStatus: document.getElementById("saveStatus"),
    shell: document.querySelector(".shell"),
    toggleCompact: document.getElementById("toggleCompact"),
    toggleDockMode: document.getElementById("toggleDockMode"),
    vaultStatus: document.getElementById("vaultStatus"),
    charCount: document.getElementById("charCount"),
    wordCount: document.getElementById("wordCount"),
  };

  const state = {
    activeDocument: null,
    activeFrontmatter: "",
    activeSource: "",
    activeTitle: "",
    compactMode: false,
    connected: false,
    floatingMode: false,
    contextResolvers: [],
    documents: [],
    pageInfo: null,
    pending: new Map(),
    related: [],
    editor: null,
    fallbackEditor: false,
    fallbackInputHandler: null,
    markdownRenderTimer: null,
    markerNodes: [],
    normalizingMarkdown: false,
    saveTimer: null,
    suppressSave: false,
    keyBindings: [],
    timestampListMode: "list",
    uiStateFrame: 0,
    videoInfo: null,
    viewMode: new URLSearchParams(window.location.search).get("view") === "all" ? "all" : "video",
    bootedAt: Date.now(),
  };

  const LINE_CURSOR_MARKER = "\u200B";

  function cleanEditorMarkers(content) {
    return String(content || "").replace(/\u200B/g, "");
  }

  function hasPageContext() {
    return !!(state.pageInfo || state.videoInfo);
  }

  function resolveContextWaiters() {
    while (state.contextResolvers.length) {
      state.contextResolvers.shift()();
    }
  }

  function waitForPageContext() {
    if (hasPageContext()) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 1200);
      state.contextResolvers.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  function requestId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function post(action, payload = {}) {
    window.parent.postMessage({ action, payload }, "*");
  }

  function fs(action, payload = {}) {
    const id = requestId();
    post(`obsidian-fs:${action}`, { requestId: id, payload });
    return new Promise((resolve, reject) => {
      state.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!state.pending.has(id)) return;
        state.pending.delete(id);
        reject(new Error("Request timed out"));
      }, 30000);
    });
  }

  function setStatus(text, kind = "") {
    els.saveStatus.textContent = text;
    els.saveStatus.className = kind;
  }

  function updateDocumentStats(content = null) {
    const text = cleanEditorMarkers(
      content === null ? els.noteBody.value || "" : String(content || ""),
    );
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = Array.from(text).length;
    els.wordCount.textContent = `${words} ${words === 1 ? "word" : "words"}`;
    els.charCount.textContent = `${chars} ${chars === 1 ? "char" : "chars"}`;
  }

  function storageGet(areaName, defaults) {
    return new Promise((resolve) => {
      try {
        const area = chrome && chrome.storage && chrome.storage[areaName];
        if (!area) {
          resolve(defaults);
          return;
        }
        area.get(defaults, (values) => resolve(values || defaults));
      } catch (_) {
        resolve(defaults);
      }
    });
  }

  function storageSet(areaName, values) {
    return new Promise((resolve) => {
      try {
        const area = chrome && chrome.storage && chrome.storage[areaName];
        if (!area) {
          resolve();
          return;
        }
        area.set(values, resolve);
      } catch (_) {
        resolve();
      }
    });
  }

  function applyCompactMode() {
    els.shell.classList.toggle("compact-mode", state.compactMode);
    if (els.toggleCompact) {
      els.toggleCompact.classList.toggle("active", state.compactMode);
      els.toggleCompact.setAttribute("aria-pressed", state.compactMode ? "true" : "false");
      els.toggleCompact.title = state.compactMode ? "Expand editor" : "Compact editor";
      els.toggleCompact.setAttribute(
        "aria-label",
        state.compactMode ? "Expand editor" : "Compact editor",
      );
    }
  }

  function setCompactMode(value) {
    state.compactMode = !!value;
    applyCompactMode();
    storageSet("local", { compactMode: state.compactMode });
  }

  function applyDockMode() {
    if (!els.toggleDockMode) return;
    const label = state.floatingMode ? "Open notes panel" : "Open floating notes panel";
    els.toggleDockMode.classList.toggle("active", state.floatingMode);
    els.toggleDockMode.classList.toggle("is-floating", state.floatingMode);
    els.toggleDockMode.setAttribute("aria-pressed", state.floatingMode ? "true" : "false");
    els.toggleDockMode.title = label;
    els.toggleDockMode.setAttribute("aria-label", label);
  }

  function setFloatingMode(value) {
    state.floatingMode = !!value;
    applyDockMode();
  }

  async function loadEditorPreferences() {
    const sync = await storageGet("sync", { keyBindings: [], timestampListMode: "list" });
    state.keyBindings = Array.isArray(sync.keyBindings) ? sync.keyBindings : [];
    state.timestampListMode = sync.timestampListMode === "plain" ? "plain" : "list";
    const local = await storageGet("local", { compactMode: false });
    state.compactMode = !!local.compactMode;
    applyCompactMode();
  }

  function yamlValue(value) {
    return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  function getYouTubeId(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("youtu.be")) {
        return parsed.pathname.split("/").filter(Boolean)[0] || null;
      }
      if (parsed.hostname.includes("youtube.com")) {
        if (parsed.pathname.startsWith("/watch")) return parsed.searchParams.get("v");
        const embed = parsed.pathname.match(/\/embed\/([^/?]+)/);
        if (embed) return embed[1];
        const shorts = parsed.pathname.match(/\/shorts\/([^/?]+)/);
        if (shorts) return shorts[1];
      }
    } catch (_) {}
    return null;
  }

  function normalizeUrl(url) {
    if (!url) return "";
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      ["t", "time_continue", "start", "feature", "ab_channel"].forEach((key) =>
        parsed.searchParams.delete(key),
      );
      if (parsed.hostname.includes("youtube.com")) {
        const id = parsed.searchParams.get("v") || getYouTubeId(url);
        return id ? `https://www.youtube.com/watch?v=${id}` : parsed.toString();
      }
      if (parsed.hostname.includes("youtu.be")) {
        const id = getYouTubeId(url);
        return id ? `https://www.youtube.com/watch?v=${id}` : parsed.toString();
      }
      return parsed.toString();
    } catch (_) {
      return String(url);
    }
  }

  function sourceUrl() {
    return (
      (state.pageInfo && (state.pageInfo.ogUrl || state.pageInfo.pageUrl)) ||
      (state.videoInfo && state.videoInfo.url) ||
      ""
    );
  }

  function noteSourceUrl() {
    return normalizeUrl((els.noteSource && els.noteSource.value) || sourceUrl());
  }

  function videoKey() {
    const candidates = [
      sourceUrl(),
      state.videoInfo && state.videoInfo.url,
      state.pageInfo && state.pageInfo.pageUrl,
    ];
    for (const url of candidates) {
      const id = getYouTubeId(url);
      if (id) return `youtube:${id}`;
    }
    return `url:${normalizeUrl(sourceUrl() || location.href)}`;
  }

  function pageTitle() {
    return (
      (state.pageInfo && (state.pageInfo.ogTitle || state.pageInfo.pageTitle)) ||
      document.title ||
      "Video notes"
    );
  }

  function baseTitle(extra = "") {
    const clean = pageTitle().replace(/\s+/g, " ").trim() || "Video notes";
    return extra ? `${clean} ${extra}` : clean;
  }

  function buildTemplate(title, source = noteSourceUrl()) {
    const url = normalizeUrl(source);
    const yt = getYouTubeId(url);
    const key = yt ? `youtube:${yt}` : `url:${normalizeUrl(url || sourceUrl() || location.href)}`;
    const now = new Date().toISOString();
    return `---\ntitle: ${yamlValue(title)}\nsource: ${yamlValue(url)}\nvideo_key: ${yamlValue(key)}\nvideo_id: ${yamlValue(yt || "")}\ncreated: ${yamlValue(now)}\ncreated_with: "Obsidian YT Notes"\ntags:\n  - video-notes\n---\n\n`;
  }

  function splitDocument(content) {
    const text = String(content || "");
    const match = text.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n*)([\s\S]*)$/);
    if (!match) return { frontmatter: "", body: text };
    return { frontmatter: match[1], body: match[2] || "" };
  }

  function unquoteYamlValue(value) {
    const text = String(value || "").trim();
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      return text
        .slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
    return text;
  }

  function frontmatterValue(frontmatter, key) {
    const body = String(frontmatter || "")
      .replace(/^---\r?\n/, "")
      .replace(/\r?\n---\r?\n?$/, "");
    const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:\\s*(.*)$`, "m");
    const match = body.match(pattern);
    return match ? unquoteYamlValue(match[1]) : "";
  }

  function updateFrontmatterField(content, key, value) {
    const text = String(content || "");
    const line = `${key}: ${yamlValue(value)}`;
    if (!/^---\r?\n/.test(text)) {
      return `---\n${line}\n---\n\n${text}`;
    }
    return text.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (_block, body) => {
      const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:.*$`, "m");
      const nextBody = pattern.test(body)
        ? body.replace(pattern, line)
        : `${line}\n${body}`;
      return `---\n${nextBody.replace(/\s*$/, "")}\n---`;
    });
  }

  function extractSourceFromLine(line) {
    const match = String(line || "").match(
      /^Source:\s*(?:\[([^\]]*)\]\(([^)]+)\)|(.+))\s*$/i,
    );
    if (!match) return "";
    return normalizeUrl(match[2] || match[3] || "");
  }

  function stripTemplatePrelude(body, title, source) {
    const lines = String(body || "")
      .replace(/^\s+/, "")
      .split(/\r?\n/);
    let nextSource = source || "";
    const first = lines[0] || "";
    const heading = first.match(/^#\s+(.+)$/);
    const hasSourceNearTop = lines.slice(1, 4).some((line) => /^Source:/i.test(line.trim()));
    if (heading && (heading[1].trim() === String(title || "").trim() || hasSourceNearTop)) {
      lines.shift();
      while (lines.length && !lines[0].trim()) lines.shift();
    }
    if (lines.length && /^Source:/i.test(lines[0].trim())) {
      nextSource = extractSourceFromLine(lines[0]) || nextSource;
      lines.shift();
      while (lines.length && !lines[0].trim()) lines.shift();
    }
    return {
      body: lines.join("\n"),
      source: nextSource ? normalizeUrl(nextSource) : "",
    };
  }

  function composeDocument(body) {
    const frontmatter = state.activeFrontmatter || "";
    if (!frontmatter) return body || "";
    return `${frontmatter.replace(/\s*$/, "\n\n")}${body || ""}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function renderInlineMarkdown(value) {
    let text = escapeHtml(value);
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<span>$1</span>');
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
      return `<a href="${escapeAttribute(href)}" target="_blank" rel="noreferrer">${label}</a>`;
    });
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    text = text.replace(/~~([^~]+)~~/g, "<s>$1</s>");
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    return text;
  }

  function markdownToHtml(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const html = [];
    let paragraph = [];
    let listOpen = false;

    const closeList = () => {
      if (!listOpen) return;
      html.push("</ul>");
      listOpen = false;
    };

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(`<p>${paragraph.map(renderInlineMarkdown).join("<br>")}</p>`);
      paragraph = [];
    };

    lines.forEach((line) => {
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        closeList();
        const level = heading[1].length;
        html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        return;
      }

      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      if (bullet) {
        flushParagraph();
        if (!listOpen) {
          html.push("<ul>");
          listOpen = true;
        }
        html.push(`<li>${renderInlineMarkdown(bullet[1])}</li>`);
        return;
      }

      if (!line.trim()) {
        flushParagraph();
        closeList();
        html.push("<p><br></p>");
        return;
      }

      closeList();
      paragraph.push(line);
    });

    flushParagraph();
    closeList();
    return html.join("") || "<p><br></p>";
  }

  function inlineNodeToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";

    const content = Array.from(node.childNodes).map(inlineNodeToMarkdown).join("");
    if (tag === "strong" || tag === "b") return content ? `**${content}**` : "";
    if (tag === "em" || tag === "i") return content ? `*${content}*` : "";
    if (tag === "s" || tag === "del") return content ? `~~${content}~~` : "";
    if (tag === "code") return content ? `\`${content}\`` : "";
    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      return href ? `[${content || href}](${href})` : content;
    }
    return content;
  }

  function blockNodeToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      return `${"#".repeat(Number(tag.slice(1)))} ${inlineNodeToMarkdown(node).trim()}`;
    }
    if (tag === "ul" || tag === "ol") {
      return Array.from(node.children)
        .filter((child) => child.tagName && child.tagName.toLowerCase() === "li")
        .map((child) => `- ${inlineNodeToMarkdown(child).trim()}`)
        .join("\n");
    }
    if (tag === "blockquote") {
      return inlineNodeToMarkdown(node)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }
    if (tag === "br") return "";
    return inlineNodeToMarkdown(node).trim();
  }

  function renderedEditorMarkdown() {
    return Array.from(els.noteEditor.childNodes)
      .map(blockNodeToMarkdown)
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimStart();
  }

  function fallbackEditorContent() {
    return renderedEditorMarkdown();
  }

  function setFallbackEditorContent(content) {
    els.noteEditor.innerHTML = markdownToHtml(content);
    els.noteBody.value = content || "";
  }

  function insertRenderedHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const fragment = template.content;
    els.noteEditor.focus();
    const selection = window.getSelection();
    if (selection && selection.rangeCount && els.noteEditor.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(fragment);
      selection.removeAllRanges();
      return;
    }
    els.noteEditor.appendChild(fragment);
  }

  function insertIntoFallbackEditor(text) {
    insertRenderedHtml(markdownToHtml(text));
    els.noteBody.value = fallbackEditorContent();
    scheduleSave();
  }

  function initializeFallbackEditor(content = "") {
    const nextContent = content || els.noteBody.value || "";
    if (state.editor && typeof state.editor.destroy === "function") {
      try {
        state.editor.destroy();
      } catch (_) {}
    }
    state.editor = null;
    state.fallbackEditor = true;
    els.noteEditor.innerHTML = "";
    els.noteEditor.classList.add("fallback-editor");
    els.noteEditor.setAttribute("contenteditable", "true");
    els.noteEditor.setAttribute("role", "textbox");
    els.noteEditor.setAttribute("aria-multiline", "true");
    els.noteEditor.setAttribute("spellcheck", "true");
    setFallbackEditorContent(nextContent);

    if (!state.fallbackInputHandler) {
      state.fallbackInputHandler = () => {
        if (state.suppressSave) return;
        els.noteBody.value = fallbackEditorContent();
        updateDocumentStats(els.noteBody.value);
        scheduleSave();
      };
      els.noteEditor.addEventListener("input", state.fallbackInputHandler);
    }
  }

  function currentToastMarkdown() {
    try {
      return cleanEditorMarkers(state.editor ? state.editor.getMarkdown() : els.noteBody.value || "");
    } catch (_) {
      return cleanEditorMarkers(els.noteBody.value || "");
    }
  }

  function getWysiwygView() {
    return state.editor && state.editor.wwEditor && state.editor.wwEditor.view;
  }

  function currentTextblock() {
    const view = getWysiwygView();
    if (!view || !view.state || !view.state.selection || !view.state.selection.empty) {
      return null;
    }
    const { $from } = view.state.selection;
    const parent = $from.parent;
    if (!parent || !parent.isTextblock) return null;
    return {
      after: $from.after($from.depth),
      depth: $from.depth,
      end: $from.end(),
      parent,
      start: $from.start(),
      text: parent.textContent || "",
      view,
    };
  }

  function setCurrentTextblockType(block, typeName, attrs, prefixLength) {
    const type = block.view.state.schema.nodes[typeName];
    if (!type) return false;
    let transaction = block.view.state.tr.delete(block.start, block.start + prefixLength);
    transaction = transaction.setBlockType(
      transaction.mapping.map(block.start),
      transaction.mapping.map(block.end),
      type,
      attrs,
    );
    block.view.dispatch(transaction);
    return true;
  }

  function applyHeadingShortcut(block) {
    if (!block || block.parent.type.name !== "paragraph") return false;
    const heading = block.text.match(/^(#{1,6})\s+(.+)$/);
    if (!heading) return false;
    return setCurrentTextblockType(block, "heading", { level: heading[1].length }, heading[1].length + 1);
  }

  function applyListShortcut(block) {
    if (!block || block.parent.type.name !== "paragraph") return false;
    const bullet = block.text.match(/^[-*]\s+(.+)$/);
    if (!bullet || typeof state.editor.exec !== "function") return false;
    const transaction = block.view.state.tr.delete(block.start, block.start + 2);
    block.view.dispatch(transaction);
    state.editor.exec("bulletList");
    return true;
  }

  function applyInlineMarkdownShortcut(block) {
    if (!block || block.parent.type.name !== "paragraph") return false;
    const schema = block.view.state.schema;
    const transforms = [
      {
        pattern: /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+[^)]*)\)/,
        create: (match) => {
          const mark = schema.marks.link;
          return mark ? schema.text(match[1], [mark.create({ linkUrl: match[2] })]) : null;
        },
      },
      {
        pattern: /\*\*([^*\n]+)\*\*/,
        create: (match) => {
          const mark = schema.marks.strong;
          return mark ? schema.text(match[1], [mark.create()]) : null;
        },
      },
      {
        pattern: /~~([^~\n]+)~~/,
        create: (match) => {
          const mark = schema.marks.strike;
          return mark ? schema.text(match[1], [mark.create()]) : null;
        },
      },
      {
        pattern: /(^|\s)\*([^*\n]+)\*/,
        create: (match) => {
          const mark = schema.marks.emph;
          return mark ? schema.text(match[2], [mark.create()]) : null;
        },
        markerOffset: (match) => match[1].length,
      },
    ];

    for (const transform of transforms) {
      const match = block.text.match(transform.pattern);
      if (!match || typeof match.index !== "number") continue;
      const markerOffset = transform.markerOffset ? transform.markerOffset(match) : 0;
      const from = block.start + match.index + markerOffset;
      const to = block.start + match.index + match[0].length;
      const node = transform.create(match);
      if (!node) continue;
      const transaction = block.view.state.tr.replaceWith(from, to, node);
      block.view.dispatch(transaction);
      return true;
    }
    return false;
  }

  function scheduleMarkdownRenderCheck() {
    if (state.fallbackEditor || state.normalizingMarkdown) return;
    clearTimeout(state.markdownRenderTimer);
    state.markdownRenderTimer = setTimeout(() => {
      const block = currentTextblock();
      if (applyHeadingShortcut(block)) {
        els.noteBody.value = currentToastMarkdown();
        updateDocumentStats(els.noteBody.value);
        queueUiStateUpdate();
        return;
      }
      if (applyListShortcut(block)) {
        els.noteBody.value = currentToastMarkdown();
        updateDocumentStats(els.noteBody.value);
        queueUiStateUpdate();
        setTimeout(scheduleMarkdownRenderCheck, 0);
        return;
      }
      if (applyInlineMarkdownShortcut(block)) {
        els.noteBody.value = currentToastMarkdown();
        updateDocumentStats(els.noteBody.value);
        queueUiStateUpdate();
      }
    }, 80);
  }

  function ensureToastEditorSurface(attempt = 0) {
    if (state.fallbackEditor) return;
    const root = els.noteEditor.querySelector(".toastui-editor-defaultUI");
    const editable = els.noteEditor.querySelector(".toastui-editor-ww-container .ProseMirror");
    if (!root || !editable) {
      if (state.editor && typeof state.editor.changeMode === "function") {
        try {
          state.editor.changeMode("wysiwyg", true);
        } catch (_) {}
      }
      if (attempt < 20) {
        setTimeout(() => ensureToastEditorSurface(attempt + 1), 100);
        return;
      }
      initializeFallbackEditor(currentToastMarkdown());
      setStatus("Visual editor loaded in fallback mode", "warning");
      return;
    }

    editable.setAttribute("aria-label", "Note body");
    editable.setAttribute("spellcheck", "true");
    queueUiStateUpdate();
  }

  function setToolbarButtonState(className, active) {
    const controls = els.noteEditor.querySelectorAll(`.${className}`);
    controls.forEach((control) => {
      const button = control.matches("button") ? control : control.querySelector("button") || control;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      const wrapper = button.closest(".toolbar-item-wrapper");
      if (wrapper) {
        wrapper.classList.toggle("active", active);
        wrapper.setAttribute("aria-pressed", active ? "true" : "false");
      }
    });
  }

  function markActive(view, markName) {
    const mark = view.state.schema.marks[markName];
    if (!mark) return false;
    const { from, to, empty, $from } = view.state.selection;
    if (empty) {
      const stored = view.state.storedMarks || $from.marks();
      return !!mark.isInSet(stored);
    }
    return view.state.doc.rangeHasMark(from, to, mark);
  }

  function nodeActive(view, typeName) {
    const { $from } = view.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type.name === typeName) return true;
    }
    return false;
  }

  function shortcutKeyName(event) {
    if (event.code && event.code.startsWith("Key")) return event.code.slice(3).toUpperCase();
    if (event.code && event.code.startsWith("Digit")) return event.code.slice(5);
    if (event.code && event.code.startsWith("Numpad")) return `Num ${event.code.slice(6)}`;

    const key = event.key || "";
    if (key === " ") return "Space";
    if (key === "Escape") return "Esc";
    if (key === "ArrowLeft") return "Left";
    if (key === "ArrowRight") return "Right";
    if (key === "ArrowUp") return "Up";
    if (key === "ArrowDown") return "Down";
    if (key.length === 1) return key.toUpperCase();
    return key;
  }

  function shortcutFromEvent(event) {
    const key = shortcutKeyName(event);
    if (!key || ["Alt", "Control", "Ctrl", "Shift", "Meta", "OS"].includes(key)) return "";
    const parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Meta");
    parts.push(key);
    return parts.join("+");
  }

  function shortcutMatches(binding, event) {
    if (!binding) return false;
    const shortcut = shortcutFromEvent(event);
    if (binding.shortcut) return binding.shortcut === shortcut;
    return !!(
      binding.key &&
      binding.key === event.keyCode &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey
    );
  }

  function isTextEditingTarget(target) {
    return !!(
      target &&
      (target.isContentEditable ||
        target.closest('[contenteditable="true"]') ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT")
    );
  }

  function handleConfiguredPanelShortcut(event) {
    if (event.repeat || Date.now() - state.bootedAt < 200) return;

    const panelActions = new Set([
      "display",
      "open-notes-folder",
      "open-video-note",
      "open-floating-note",
    ]);
    const binding = state.keyBindings.find(
      (item) => panelActions.has(item.action) && shortcutMatches(item, event),
    );
    if (!binding) return;

    const hasModifier = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
    if (!hasModifier && isTextEditingTarget(event.target)) return;

    event.preventDefault();
    event.stopPropagation();

    if (binding.action === "open-notes-folder") {
      if (state.viewMode === "all") {
        post("closeEditor");
        return;
      }
      setViewMode("all", { openFirst: true }).catch((error) =>
        setStatus(error.message, "warning"),
      );
      return;
    }

    if (binding.action === "open-video-note") {
      if (state.viewMode === "video") {
        post("closeEditor");
        return;
      }
      setViewMode("video", { openFirst: true }).catch((error) =>
        setStatus(error.message, "warning"),
      );
      return;
    }

    post("closeEditor");
  }

  function updateToolbarState() {
    const view = getWysiwygView();
    if (!view || state.fallbackEditor) return;
    const block = currentTextblock();
    setToolbarButtonState("heading", !!(block && block.parent.type.name === "heading"));
    setToolbarButtonState("bold", markActive(view, "strong"));
    setToolbarButtonState("italic", markActive(view, "emph"));
    setToolbarButtonState("strike", markActive(view, "strike"));
    setToolbarButtonState("quote", nodeActive(view, "blockQuote"));
  }

  function clearMarkdownMarkerHints() {
    state.markerNodes.forEach((node) => {
      node.classList.remove("markdown-marker-active");
      delete node.dataset.markdownPrefix;
    });
    state.markerNodes = [];
  }

  function markerForSelection(view) {
    const { $from } = view.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      const type = node.type.name;
      if (type === "heading") {
        return {
          position: $from.before(depth),
          prefix: `${"#".repeat(node.attrs.level || 1)} `,
        };
      }
      if (type === "blockQuote") {
        return { position: $from.before(depth), prefix: "> " };
      }
      if (type === "listItem" || type === "item") {
        return { position: $from.before(depth), prefix: "- " };
      }
    }
    return null;
  }

  function updateMarkdownMarkerHints() {
    clearMarkdownMarkerHints();
    const view = getWysiwygView();
    if (!view || state.fallbackEditor) return;
    const marker = markerForSelection(view);
    if (!marker) return;
    let node = null;
    try {
      node = view.nodeDOM(marker.position);
    } catch (_) {
      return;
    }
    if (!(node instanceof HTMLElement) || node === view.dom) return;
    node.classList.add("markdown-marker-active");
    node.dataset.markdownPrefix = marker.prefix;
    state.markerNodes = [node];
  }

  function queueUiStateUpdate() {
    cancelAnimationFrame(state.uiStateFrame);
    state.uiStateFrame = requestAnimationFrame(() => {
      updateToolbarState();
      updateMarkdownMarkerHints();
    });
  }

  function createTimestampToolbarButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toastui-editor-toolbar-icons timestamp";
    button.setAttribute("aria-label", "Timestamp");
    button.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8"></circle>
        <path d="M12 8v4l3 2"></path>
        <path d="M19 17v4"></path>
        <path d="M17 19h4"></path>
      </svg>
    `;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      post("captureTimestamp");
    });
    return button;
  }

  function syncEditorAfterToolbarInsert() {
    els.noteBody.value = cleanEditorMarkers(currentToastMarkdown());
    updateDocumentStats(els.noteBody.value);
    queueUiStateUpdate();
    scheduleSave();
  }

  function insertHorizontalLineAfter() {
    if (state.fallbackEditor) {
      insertIntoFallbackEditor("\n---\n\n");
      return;
    }

    const view = getWysiwygView();
    const schema = view && view.state && view.state.schema;
    const lineType =
      schema &&
      (schema.nodes.thematicBreak || schema.nodes.horizontalRule || schema.nodes.hr);
    const paragraphType = schema && schema.nodes.paragraph;

    if (view && lineType && paragraphType) {
      try {
        const { state: pmState } = view;
        const block = currentTextblock();
        const lineNode = lineType.create();
        const paragraphNode = paragraphType.create();
        const insertPos = block ? block.after : pmState.selection.to;
        let transaction = pmState.tr.insert(insertPos, [lineNode, paragraphNode]);
        const cursorPos = Math.min(
          transaction.mapping.map(insertPos) + lineNode.nodeSize + 1,
          transaction.doc.content.size,
        );

        const Selection = pmState.selection.constructor;
        if (Selection && typeof Selection.near === "function") {
          transaction = transaction.setSelection(
            Selection.near(transaction.doc.resolve(cursorPos), 1),
          );
        }

        view.dispatch(transaction.scrollIntoView());
        view.focus();
        syncEditorAfterToolbarInsert();
        return;
      } catch (_) {}
    }

    if (state.editor && typeof state.editor.exec === "function") {
      try {
        state.editor.insertText(`\n\n---\n\n${LINE_CURSOR_MARKER}`);
        if (typeof state.editor.focus === "function") state.editor.focus();
        syncEditorAfterToolbarInsert();
        return;
      } catch (_) {}
    }

    insertAtCursor("\n---\n\n");
  }

  function createLineToolbarButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toastui-editor-toolbar-icons line-after";
    button.title = "Line";
    button.setAttribute("aria-label", "Line");
    button.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M5 12h14"></path>
      </svg>
    `;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      insertHorizontalLineAfter();
    });
    return button;
  }

  function initializeMarkdownEditor() {
    if (!window.toastui || !window.toastui.Editor) {
      initializeFallbackEditor();
      setStatus("Visual editor loaded in fallback mode", "warning");
      return;
    }

    try {
      state.fallbackEditor = false;
      state.editor = new window.toastui.Editor({
        el: els.noteEditor,
        height: "100%",
        initialEditType: "wysiwyg",
        initialValue: "",
        hideModeSwitch: true,
        previewStyle: "vertical",
        usageStatistics: false,
        toolbarItems: [
          [
            "heading",
            "bold",
            "italic",
            "strike",
            "quote",
            { name: "lineAfter", el: createLineToolbarButton() },
            { name: "timestamp", el: createTimestampToolbarButton() },
          ],
        ],
      });
    } catch (_) {
      initializeFallbackEditor();
      setStatus("Visual editor loaded in fallback mode", "warning");
      return;
    }

    state.editor.on("change", () => {
      if (state.suppressSave) return;
      els.noteBody.value = cleanEditorMarkers(state.editor.getMarkdown());
      updateDocumentStats(els.noteBody.value);
      scheduleMarkdownRenderCheck();
      queueUiStateUpdate();
      scheduleSave();
    });

    els.noteEditor.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
      }
      if (event.key === " " || event.key === "Enter" || event.key === ")") {
        scheduleMarkdownRenderCheck();
      }
      queueUiStateUpdate();
    });

    els.noteEditor.addEventListener("keyup", queueUiStateUpdate);
    els.noteEditor.addEventListener("mouseup", queueUiStateUpdate);
    document.addEventListener("selectionchange", queueUiStateUpdate);

    requestAnimationFrame(() => setTimeout(() => ensureToastEditorSurface(), 150));
  }

  function updatePreview() {
    if (state.fallbackEditor) {
      els.noteBody.value = fallbackEditorContent();
      updateDocumentStats(els.noteBody.value);
      return;
    }
    if (state.editor) {
      els.noteBody.value = cleanEditorMarkers(state.editor.getMarkdown());
      updateDocumentStats(els.noteBody.value);
    }
  }

  function setEditorContent(content) {
    const next = content || "";
    const wasSuppressing = state.suppressSave;
    state.suppressSave = true;
    els.noteBody.value = next;
    if (state.fallbackEditor) {
      setFallbackEditorContent(next);
    } else if (state.editor && state.editor.getMarkdown() !== next) {
      state.editor.setMarkdown(next, false);
      state.editor.changeMode("wysiwyg", true);
    }
    updateDocumentStats(next);
    state.suppressSave = wasSuppressing;
    queueUiStateUpdate();
  }

  function getEditorContent() {
    if (state.fallbackEditor) return cleanEditorMarkers(fallbackEditorContent());
    if (state.editor) return cleanEditorMarkers(state.editor.getMarkdown());
    return cleanEditorMarkers(els.noteBody.value || "");
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function updateFrontmatterTitle(content, title) {
    return updateFrontmatterField(content, "title", title);
  }

  function updateFrontmatterSource(content, source) {
    return updateFrontmatterField(content, "source", source);
  }

  function updateFrontmatterVideoFields(content, source) {
    const url = normalizeUrl(source);
    const id = getYouTubeId(url) || "";
    let next = updateFrontmatterField(
      content,
      "video_key",
      id ? `youtube:${id}` : `url:${normalizeUrl(url || sourceUrl() || location.href)}`,
    );
    next = updateFrontmatterField(next, "video_id", id);
    return next;
  }

  function applyTitleToContent(content, title, previousTitle) {
    let next = updateFrontmatterTitle(String(content || ""), title);
    const oldTitle = String(previousTitle || "").trim();
    if (oldTitle) {
      const heading = new RegExp(`^(#\\s+)${escapeRegExp(oldTitle)}\\s*$`, "m");
      next = next.replace(heading, `$1${title}`);
    }
    return next;
  }

  function docVideoKey(doc) {
    const metadata = doc.metadata || {};
    const frontmatter = metadata.frontmatter || {};
    if (frontmatter.video_key) return frontmatter.video_key;
    if (frontmatter.video_id) return `youtube:${frontmatter.video_id}`;
    const url = metadata.sourceUrl || frontmatter.source || frontmatter.url || frontmatter.link;
    const id = getYouTubeId(url);
    if (id) return `youtube:${id}`;
    return url ? `url:${normalizeUrl(url)}` : null;
  }

  function formatDate(value) {
    if (!value) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value));
    } catch (_) {
      return "";
    }
  }

  function sortDocuments(documents) {
    return [...documents].sort(
      (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt),
    );
  }

  function visibleDocuments() {
    return state.viewMode === "all" ? sortDocuments(state.documents) : state.related;
  }

  function updateNotesListTitle() {
    els.notesListTitle.textContent =
      state.viewMode === "all" ? "Notes in selected folder" : "Notes for this video";
  }

  function renderNotes() {
    els.notesList.innerHTML = "";
    updateNotesListTitle();
    const documents = visibleDocuments();
    if (!documents.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = state.connected
        ? state.viewMode === "all"
          ? "No notes in the selected folder yet."
          : "No notes linked to this video yet."
        : "Connect your notes folder to load notes.";
      els.notesList.appendChild(empty);
      return;
    }

    documents.forEach((doc) => {
      const row = document.createElement("div");
      row.className = "note-item-row";

      const button = document.createElement("button");
      button.className = `ui-button ui-button-ghost note-item ${
        state.activeDocument && state.activeDocument.documentId === doc.documentId ? "active" : ""
      }`;
      button.type = "button";
      button.addEventListener("click", () => loadDocument(doc.documentId));

      const title = document.createElement("span");
      title.className = "note-title";
      title.textContent = doc.title || doc.filename || "Untitled";

      const meta = document.createElement("span");
      meta.className = "note-meta";
      meta.textContent = formatDate(doc.updatedAt || doc.createdAt);

      button.append(title, meta);

      const deleteButton = document.createElement("button");
      deleteButton.className = "ui-button ui-button-ghost ui-button-icon icon-btn delete-note-btn";
      deleteButton.type = "button";
      deleteButton.title = "Delete note";
      deleteButton.setAttribute("aria-label", `Delete ${title.textContent}`);
      deleteButton.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      `;
      deleteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteNote(doc.documentId).catch((error) => setStatus(error.message, "warning"));
      });

      row.append(button, deleteButton);
      els.notesList.appendChild(row);
    });
  }

  function updateContext() {
    const title = pageTitle();
    els.contextLabel.textContent = title;
    if (!els.noteTitle.value) els.noteTitle.value = title;
    if (!els.noteSource.value) els.noteSource.value = normalizeUrl(sourceUrl());
  }

  function setConnected(payload) {
    state.connected = !!payload.success;
    if (state.connected) {
      const folderName = payload.notesFolderName || payload.vaultName || "selected";
      els.vaultStatus.textContent = `Notes folder: ${folderName}`;
      els.folderStatus.textContent = "Markdown notes are saved in this folder.";
      els.connectVault.textContent = "Change folder";
      setStatus("Folder connected", "saved");
    } else {
      els.vaultStatus.textContent = "Notes folder not connected";
      els.folderStatus.textContent =
        payload.error || "Select the folder where video notes should be saved.";
      els.connectVault.textContent = "Select folder";
    }
  }

  function refreshRelated() {
    const currentKey = videoKey();
    state.related = sortDocuments(state.documents.filter((doc) => docVideoKey(doc) === currentKey));
    renderNotes();
  }

  async function refreshDocuments({ openFirst = false } = {}) {
    if (!state.connected) return;
    if (openFirst) await waitForPageContext();
    const result = await fs("list-documents");
    state.documents = result.documents || [];
    refreshRelated();
    const documents = visibleDocuments();
    if (openFirst && documents.length) {
      await loadDocument(documents[0].documentId);
    } else if (openFirst && state.viewMode !== "all" && !documents.length) {
      await createNewNote();
    }
  }

  async function setViewMode(mode, { openFirst = false } = {}) {
    const nextMode = mode === "all" ? "all" : "video";
    const changed = state.viewMode !== nextMode;
    state.viewMode = nextMode;
    updateNotesListTitle();
    renderNotes();
    if (state.connected && (changed || openFirst)) {
      await refreshDocuments({ openFirst });
    }
  }

  async function loadDocument(documentId) {
    setStatus("Loading...", "saving");
    const result = await fs("read-document", { documentId });
    const doc = result.document;
    state.suppressSave = true;
    state.activeDocument = doc;
    els.noteTitle.value = (doc && doc.title) || (doc && doc.filename.replace(/\.md$/, "")) || pageTitle();
    state.activeTitle = els.noteTitle.value;
    const parts = splitDocument(result.content || "");
    state.activeFrontmatter = parts.frontmatter;
    const source =
      frontmatterValue(parts.frontmatter, "source") ||
      (doc && doc.metadata && doc.metadata.sourceUrl) ||
      normalizeUrl(sourceUrl());
    const stripped = stripTemplatePrelude(parts.body, els.noteTitle.value, source);
    els.noteSource.value = stripped.source || source || "";
    state.activeSource = els.noteSource.value;
    setEditorContent(stripped.body);
    els.activeFile.textContent = doc ? doc.path || doc.filename : "";
    state.suppressSave = false;
    setStatus("Loaded", "saved");
    renderNotes();
  }

  async function createNewNote(options = {}) {
    if (!state.connected) {
      setStatus("Connect a notes folder first", "warning");
      return;
    }
    const suffix = state.related.length ? `note ${state.related.length + 1}` : "";
    const title = options.title || baseTitle(suffix);
    const source = normalizeUrl(options.source || noteSourceUrl() || sourceUrl());
    const body = options.body || "";
    const content = `${buildTemplate(title, source)}${body}`;
    setStatus("Creating note...", "saving");
    const result = await fs("create-document", {
      title,
      content,
      metadata: {
        sourceUrl: source,
        videoKey: getYouTubeId(source)
          ? `youtube:${getYouTubeId(source)}`
          : `url:${normalizeUrl(source || sourceUrl() || location.href)}`,
        videoId: getYouTubeId(source) || "",
      },
    });
    state.activeDocument = result.document;
    state.suppressSave = true;
    els.noteTitle.value = title;
    els.noteSource.value = source;
    state.activeTitle = title;
    state.activeSource = source;
    const parts = splitDocument(content);
    state.activeFrontmatter = parts.frontmatter;
    setEditorContent(body);
    els.activeFile.textContent = result.document.path || result.document.filename;
    state.suppressSave = false;
    await refreshDocuments();
    setStatus("Created", "saved");
  }

  function clearActiveDocument() {
    state.suppressSave = true;
    state.activeDocument = null;
    state.activeFrontmatter = "";
    state.activeSource = normalizeUrl(sourceUrl());
    state.activeTitle = pageTitle();
    els.noteTitle.value = state.activeTitle;
    els.noteSource.value = state.activeSource;
    els.activeFile.textContent = "";
    setEditorContent("");
    state.suppressSave = false;
  }

  async function deleteNote(documentId) {
    const doc = state.documents.find((item) => item.documentId === documentId);
    const label = (doc && (doc.title || doc.filename)) || "this note";
    if (!window.confirm(`Delete "${label}" from the notes folder?`)) return;

    const wasActive =
      state.activeDocument && state.activeDocument.documentId === documentId;
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    setStatus("Deleting...", "saving");
    await fs("delete-document", { documentId });
    if (wasActive) clearActiveDocument();
    await refreshDocuments();

    const next = visibleDocuments()[0];
    if (wasActive && next) {
      await loadDocument(next.documentId);
    } else {
      renderNotes();
      setStatus("Deleted", "saved");
    }
  }

  async function saveNow() {
    if (state.suppressSave || !state.connected) return;
    const title = (els.noteTitle.value || pageTitle()).trim();
    const source = noteSourceUrl();
    let content = composeDocument(getEditorContent());
    if (!state.activeDocument) {
      await createNewNote({ title, source, body: getEditorContent() });
      return;
    }
    content = applyTitleToContent(content, title, state.activeTitle || state.activeDocument.title);
    content = updateFrontmatterSource(content, source);
    content = updateFrontmatterVideoFields(content, source);
    state.activeFrontmatter = splitDocument(content).frontmatter;
    setStatus("Saving...", "saving");
    const result = await fs("update-document", {
      documentId: state.activeDocument.documentId,
      content,
      title,
    });
    state.activeDocument = result.document || state.activeDocument;
    state.activeTitle = title;
    state.activeSource = source;
    els.activeFile.textContent =
      state.activeDocument.path || state.activeDocument.filename || "";
    setStatus("Saved", "saved");
    await refreshDocuments();
  }

  function scheduleSave() {
    if (state.suppressSave) return;
    clearTimeout(state.saveTimer);
    setStatus("Unsaved changes", "warning");
    state.saveTimer = setTimeout(() => {
      saveNow().catch((error) => setStatus(error.message, "warning"));
    }, 700);
  }

  function insertAtCursor(text) {
    if (state.fallbackEditor) {
      insertIntoFallbackEditor(text);
      return;
    }
    if (state.editor && typeof state.editor.insertText === "function") {
      state.editor.insertText(text);
      els.noteBody.value = cleanEditorMarkers(state.editor.getMarkdown());
      updateDocumentStats(els.noteBody.value);
      scheduleMarkdownRenderCheck();
      queueUiStateUpdate();
      scheduleSave();
      return;
    }
    const el = els.noteBody;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || start;
    el.value = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`;
    el.selectionStart = el.selectionEnd = start + text.length;
    el.focus();
    updatePreview();
    scheduleSave();
  }

  function insertTimestampLink(label, url) {
    if (state.fallbackEditor) {
      const prefix = state.timestampListMode === "list" ? "\n- " : "\n";
      insertIntoFallbackEditor(`${prefix}[${label}](${url}) `);
      return;
    }
    if (state.editor && typeof state.editor.exec === "function") {
      try {
        const block = currentTextblock();
        if (block && block.text.trim()) {
          state.editor.insertText("\n");
        }
        const view = getWysiwygView();
        if (
          state.timestampListMode === "list" &&
          view &&
          !nodeActive(view, "listItem") &&
          !nodeActive(view, "item")
        ) {
          state.editor.exec("bulletList");
        }
        state.editor.exec("addLink", { linkUrl: url, linkText: label });
        state.editor.insertText(" ");
        els.noteBody.value = cleanEditorMarkers(state.editor.getMarkdown());
        updateDocumentStats(els.noteBody.value);
        queueUiStateUpdate();
        scheduleSave();
        return;
      } catch (_) {}
    }
    insertAtCursor(`${state.timestampListMode === "list" ? "\n- " : "\n"}[${label}](${url}) `);
  }

  function handleTimestamp(data) {
    const seconds = Math.max(0, Math.floor(data.timestamp || 0));
    const label = data.formattedTime || new Date(seconds * 1000).toISOString().slice(11, 19);
    let url = normalizeUrl(data.pageUrl || sourceUrl());
    if (url && seconds) {
      try {
        const parsed = new URL(url);
        parsed.searchParams.set("t", `${seconds}s`);
        url = parsed.toString();
      } catch (_) {}
    }
    insertTimestampLink(label, url);
  }

  async function connectVault() {
    setStatus("Waiting for folder selection...", "saving");
    try {
      const result = await fs("initialize");
      setConnected(result);
      try {
        await refreshDocuments({ openFirst: true });
      } catch (error) {
        setStatus(error.message, "warning");
      }
    } catch (error) {
      setConnected({ success: false, error: error.message });
      setStatus(error.message, "warning");
    }
  }

  async function boot() {
    await loadEditorPreferences();
    updateNotesListTitle();
    els.noteTitle.value = pageTitle();
    els.noteSource.value = normalizeUrl(sourceUrl());
    updateDocumentStats("");
    post("getPageInfo");
    post("requestVideoInfo");
    post("getDockMode");
    try {
      const stored = await fs("check-stored");
      if (stored.hasStoredVault) {
        const reconnect = await fs("reconnect");
        setConnected(reconnect);
        if (reconnect.success) await refreshDocuments({ openFirst: true });
      } else {
        setConnected({ success: false });
      }
    } catch (error) {
      setConnected({ success: false, error: error.message });
    }
  }

  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.action === "obsidian-fs:response") {
      const pending = state.pending.get(data.requestId);
      if (!pending) return;
      state.pending.delete(data.requestId);
      if (data.payload && data.payload.success === false) {
        pending.reject(new Error(data.payload.error || "File system request failed"));
      } else {
        pending.resolve(data.payload || {});
      }
      return;
    }

    if (data.action === "getPageInfo") {
      state.pageInfo = data.pageInfo || null;
      resolveContextWaiters();
      updateContext();
      refreshRelated();
      return;
    }

    if (data.action === "requestVideoInfo") {
      state.videoInfo = data.payload ? data.payload.videoInfo : null;
      resolveContextWaiters();
      refreshRelated();
      return;
    }

    if (data.action === "timestampCaptured") {
      handleTimestamp(data.timestampData || {});
      return;
    }

    if (data.action === "setNotesViewMode") {
      setViewMode(data.mode, { openFirst: true }).catch((error) =>
        setStatus(error.message, "warning"),
      );
      return;
    }

    if (data.action === "editorDockModeChanged") {
      setFloatingMode(data.floating);
    }
  });

  els.closePanel.addEventListener("click", () => post("closeEditor"));
  els.connectVault.addEventListener("click", connectVault);
  els.newNote.addEventListener("click", () => createNewNote().catch((e) => setStatus(e.message, "warning")));
  els.toggleCompact.addEventListener("click", () => setCompactMode(!state.compactMode));
  if (els.toggleDockMode) {
    els.toggleDockMode.addEventListener("click", () => post("toggleDockMode"));
  }
  els.noteTitle.addEventListener("input", scheduleSave);
  els.noteSource.addEventListener("input", scheduleSave);
  els.refreshNotes.addEventListener("click", () =>
    refreshDocuments({ openFirst: !state.activeDocument }).catch((e) =>
      setStatus(e.message, "warning"),
    ),
  );

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") return;
      if (changes.timestampListMode) {
        state.timestampListMode =
          changes.timestampListMode.newValue === "plain" ? "plain" : "list";
      }
      if (changes.keyBindings) {
        state.keyBindings = Array.isArray(changes.keyBindings.newValue)
          ? changes.keyBindings.newValue
          : [];
      }
    });
  } catch (_) {}

  window.addEventListener("keydown", handleConfiguredPanelShortcut, true);

  initializeMarkdownEditor();
  boot();
})();
