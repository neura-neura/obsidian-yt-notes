(() => {
  "use strict";

  const TRIM_LINES = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
  const VALUELESS_ACTIONS = new Set([
    "pause",
    "muted",
    "mark",
    "jump",
    "display",
    "open-notes-folder",
    "open-video-note",
    "open-floating-note",
  ]);

  const DEFAULT_SETTINGS = {
    speed: 1,
    displayKeyCode: 86,
    rememberSpeed: false,
    audioBoolean: false,
    startHidden: false,
    forceLastSavedSpeed: false,
    enabled: true,
    controllerOpacity: 0.3,
    timestampListMode: "list",
    keyBindings: [
      { action: "display", key: 86, shortcut: "V", value: 0, force: false, predefined: true },
      { action: "open-notes-folder", key: null, shortcut: null, value: 0, force: false, predefined: true },
      { action: "open-video-note", key: null, shortcut: null, value: 0, force: false, predefined: true },
      { action: "open-floating-note", key: null, shortcut: null, value: 0, force: false, predefined: true },
      { action: "slower", key: 83, shortcut: "S", value: 0.1, force: false, predefined: true },
      { action: "faster", key: 68, shortcut: "D", value: 0.1, force: false, predefined: true },
      { action: "rewind", key: 90, shortcut: "Z", value: 10, force: false, predefined: true },
      { action: "advance", key: 88, shortcut: "X", value: 10, force: false, predefined: true },
      { action: "reset", key: 82, shortcut: "R", value: 1, force: false, predefined: true },
      { action: "fast", key: 71, shortcut: "G", value: 1.8, force: false, predefined: true },
    ],
    blacklist: "imgur.com\n    teams.microsoft.com\n    google.com\n    netflix.com\n  ".replace(
      TRIM_LINES,
      "",
    ),
  };

  const KEY_LABELS = {
    8: "Backspace",
    9: "Tab",
    13: "Enter",
    27: "Esc",
    32: "Space",
    37: "Left",
    38: "Up",
    39: "Right",
    40: "Down",
    46: "Delete",
    96: "Num 0",
    97: "Num 1",
    98: "Num 2",
    99: "Num 3",
    100: "Num 4",
    101: "Num 5",
    102: "Num 6",
    103: "Num 7",
    104: "Num 8",
    105: "Num 9",
    106: "Num *",
    107: "Num +",
    109: "Num -",
    110: "Num .",
    111: "Num /",
    112: "F1",
    113: "F2",
    114: "F3",
    115: "F4",
    116: "F5",
    117: "F6",
    118: "F7",
    119: "F8",
    120: "F9",
    121: "F10",
    122: "F11",
    123: "F12",
    186: ";",
    187: "+",
    188: "<",
    189: "-",
    190: ">",
    191: "/",
    192: "~",
    219: "[",
    220: "\\",
    221: "]",
    222: "'",
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function keyCodeToLabel(keyCode) {
    const code = Number(keyCode);
    if (!Number.isFinite(code) || code <= 0) return "";
    if (KEY_LABELS[code]) return KEY_LABELS[code];
    if (code >= 48 && code <= 57) return String.fromCharCode(code);
    if (code >= 65 && code <= 90) return String.fromCharCode(code);
    return "";
  }

  function normalizeKeyName(event) {
    if (event.code && event.code.startsWith("Key")) return event.code.slice(3).toUpperCase();
    if (event.code && event.code.startsWith("Digit")) return event.code.slice(5);
    if (event.code && event.code.startsWith("Numpad")) return `Num ${event.code.slice(6)}`;

    const key = event.key || keyCodeToLabel(event.keyCode);
    if (!key || key === "Unidentified") return "";
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
    const key = normalizeKeyName(event);
    if (!key || ["Alt", "Control", "Ctrl", "Shift", "Meta", "OS"].includes(key)) return "";

    const parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Meta");
    parts.push(key);
    return parts.join("+");
  }

  function validateBlacklist(value) {
    const status = document.getElementById("status");
    let valid = true;
    String(value || "")
      .split("\n")
      .forEach((line) => {
        const trimmed = line.replace(TRIM_LINES, "");
        if (!trimmed.startsWith("/")) return;
        try {
          const parts = trimmed.split("/");
          if (parts.length < 3) throw new Error("invalid regex");
          const flags = parts.pop();
          const pattern = parts.slice(1).join("/");
          new RegExp(pattern, flags);
        } catch (_) {
          status.textContent = `Error: Invalid blacklist regex: "${trimmed}". Unable to save. Try wrapping it in forward slashes.`;
          valid = false;
        }
      });
    return valid;
  }

  function showStatus(text) {
    const status = document.getElementById("status");
    status.textContent = text;
    setTimeout(() => {
      status.textContent = "";
    }, 1200);
  }

  function updateValueState(row) {
    const action = row.querySelector(".customDo").value;
    const valueInput = row.querySelector(".customValue");
    if (!valueInput) return;
    valueInput.disabled = VALUELESS_ACTIONS.has(action);
    if (valueInput.disabled && !valueInput.value) valueInput.value = 0;
  }

  function setShortcutInput(input, binding) {
    const shortcut = binding.shortcut || keyCodeToLabel(binding.key);
    input.value = shortcut || "";
    input.dataset.shortcut = shortcut || "";
    input.keyCode = binding.key || null;
  }

  function readShortcutInput(input) {
    const shortcut = input.dataset.shortcut || "";
    return {
      shortcut: shortcut || null,
      key: shortcut ? input.keyCode || null : null,
    };
  }

  function defaultBinding(action) {
    return DEFAULT_SETTINGS.keyBindings.find((binding) => binding.action === action);
  }

  function ensureBindings(settings) {
    const incoming = Array.isArray(settings.keyBindings) ? settings.keyBindings : [];
    const byAction = new Map();
    const custom = [];

    incoming.forEach((binding) => {
      if (!binding || !binding.action) return;
      if (!binding.predefined) {
        custom.push(binding);
        return;
      }
      const current = byAction.get(binding.action);
      const bindingHasShortcut = !!(binding.shortcut || binding.key);
      const currentHasShortcut = !!(current && (current.shortcut || current.key));
      if (!current || (bindingHasShortcut && !currentHasShortcut)) {
        byAction.set(binding.action, binding);
      }
    });

    DEFAULT_SETTINGS.keyBindings.forEach((binding) => {
      if (!byAction.has(binding.action)) byAction.set(binding.action, clone(binding));
    });

    return [...byAction.values(), ...custom];
  }

  function readBinding(row) {
    const shortcut = readShortcutInput(row.querySelector(".customKey"));
    return {
      action: row.querySelector(".customDo").value,
      key: shortcut.key,
      shortcut: shortcut.shortcut,
      value: Number(row.querySelector(".customValue").value),
      force: row.querySelector(".customForce").value,
      predefined: !!row.id,
    };
  }

  function saveOptions() {
    const blacklist = document.getElementById("blacklist").value;
    if (!validateBlacklist(blacklist)) return;

    const keyBindings = Array.from(document.querySelectorAll(".customs")).map(readBinding);
    const seenPredefined = new Set();
    const deduped = keyBindings.filter((binding) => {
      if (!binding.predefined) return true;
      if (seenPredefined.has(binding.action)) return false;
      seenPredefined.add(binding.action);
      return true;
    });

    chrome.storage.sync.remove(
      [
        "resetSpeed",
        "speedStep",
        "fastSpeed",
        "rewindTime",
        "advanceTime",
        "resetKeyCode",
        "slowerKeyCode",
        "fasterKeyCode",
        "rewindKeyCode",
        "advanceKeyCode",
        "fastKeyCode",
      ],
      () => {
        chrome.storage.sync.set(
          {
            audioBoolean: document.getElementById("audioBoolean").checked,
            enabled: document.getElementById("enabled").checked,
            startHidden: document.getElementById("startHidden").checked,
            controllerOpacity: document.getElementById("controllerOpacity").value,
            timestampListMode: document.getElementById("timestampListMode").value,
            keyBindings: deduped,
            blacklist: blacklist.replace(TRIM_LINES, ""),
          },
          () => showStatus("Options saved"),
        );
      },
    );
  }

  function addShortcutRow() {
    const row = document.createElement("div");
    row.className = "row customs";
    row.innerHTML = `
      <select class="ui-select customDo">
        <option value="slower">Decrease speed</option>
        <option value="faster">Increase speed</option>
        <option value="rewind">Rewind</option>
        <option value="advance">Advance</option>
        <option value="reset">Reset speed</option>
        <option value="fast">Preferred speed</option>
        <option value="muted">Mute</option>
        <option value="softer">Decrease volume</option>
        <option value="louder">Increase volume</option>
        <option value="pause">Pause</option>
        <option value="mark">Set marker</option>
        <option value="jump">Jump to marker</option>
        <option value="display">Show/hide notes button</option>
        <option value="open-notes-folder">Open notes folder</option>
        <option value="open-video-note">Open notes panel</option>
        <option value="open-floating-note">Open floating notes panel</option>
      </select>
      <input class="ui-input customKey" type="text" placeholder="press shortcut" />
      <input class="ui-input customValue" type="text" placeholder="value (0.10)" />
      <select class="ui-select customForce">
        <option value="false">Do not disable website key bindings</option>
        <option value="true">Disable website key bindings</option>
      </select>
      <button class="ui-button ui-button-destructive ui-button-icon removeParent" type="button" aria-label="Remove shortcut">X</button>
    `;
    document.querySelector("#customs .shortcut-grid").appendChild(row);
    updateValueState(row);
  }

  function loadOptions() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
      const keyBindings = ensureBindings(settings);
      document.getElementById("audioBoolean").checked = !!settings.audioBoolean;
      document.getElementById("enabled").checked = settings.enabled !== false;
      document.getElementById("startHidden").checked = !!settings.startHidden;
      document.getElementById("controllerOpacity").value = settings.controllerOpacity;
      document.getElementById("timestampListMode").value =
        settings.timestampListMode === "plain" ? "plain" : "list";
      document.getElementById("blacklist").value = settings.blacklist;

      document.querySelectorAll(".customs:not([id])").forEach((row) => row.remove());

      keyBindings.forEach((binding) => {
        if (binding.predefined) {
          const row = document.getElementById(binding.action);
          if (!row) return;
          const merged = { ...defaultBinding(binding.action), ...binding };
          setShortcutInput(row.querySelector(".customKey"), merged);
          row.querySelector(".customValue").value = merged.value;
          row.querySelector(".customForce").value = String(merged.force);
          updateValueState(row);
          return;
        }

        addShortcutRow();
        const row = document.querySelector("#customs .shortcut-grid .customs:not([id]):last-child");
        row.querySelector(".customDo").value = binding.action;
        setShortcutInput(row.querySelector(".customKey"), binding);
        row.querySelector(".customValue").value = binding.value;
        row.querySelector(".customForce").value = String(binding.force);
        updateValueState(row);
      });
    });
  }

  function restoreDefaults() {
    chrome.storage.sync.set(clone(DEFAULT_SETTINGS), () => {
      loadOptions();
      showStatus("Default options restored");
    });
  }

  function showForceControls() {
    document.querySelectorAll(".customForce").forEach((select) => {
      select.style.display = "inline-block";
    });
  }

  function handleShortcutKeydown(event) {
    if (!event.target.classList.contains("customKey")) return;
    event.preventDefault();
    event.stopPropagation();

    if (["Backspace", "Delete", "Escape"].includes(event.key)) {
      event.target.value = "";
      event.target.dataset.shortcut = "";
      event.target.keyCode = null;
      return;
    }

    const shortcut = shortcutFromEvent(event);
    if (!shortcut) return;
    event.target.value = shortcut;
    event.target.dataset.shortcut = shortcut;
    event.target.keyCode = event.keyCode || null;
  }

  function handleNumericInput(event) {
    if (!event.target.classList.contains("customValue")) return;
    const cleaned = event.target.value.replace(/[^\d.]/g, "");
    const parts = cleaned.split(".");
    event.target.value = parts.length > 1 ? `${parts.shift()}.${parts.join("")}` : cleaned;
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadOptions();
    document.getElementById("save").addEventListener("click", saveOptions);
    document.getElementById("restore").addEventListener("click", restoreDefaults);

    const addButton = document.getElementById("add");
    if (addButton) addButton.addEventListener("click", addShortcutRow);

    const experimental = document.getElementById("experimental");
    if (experimental) experimental.addEventListener("click", showForceControls);

    document.addEventListener("keydown", handleShortcutKeydown);
    document.addEventListener("input", handleNumericInput);
    document.addEventListener(
      "focus",
      (event) => {
        if (event.target.classList.contains("customKey")) event.target.select();
      },
      true,
    );
    document.addEventListener("click", (event) => {
      if (event.target.classList.contains("removeParent")) event.target.parentNode.remove();
    });
    document.addEventListener("change", (event) => {
      if (event.target.classList.contains("customDo")) updateValueState(event.target.closest(".customs"));
    });
  });
})();
