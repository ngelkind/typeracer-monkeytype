// Monkeytype for TypeRacer
// Copyright (C) 2026 ngelkind (https://github.com/ngelkind/typeracer-monkeytype)
// SPDX-License-Identifier: AGPL-3.0-only
//
// Toolbar popup. It only writes chrome.storage.local; open TypeRacer tabs pick
// the change up through chrome.storage.onChanged in content.js.

const DEFAULTS = { mode: "full", fontSize: 54, stopOnLetter: false };
const FONT_MIN = 20, FONT_MAX = 110;

const MODE_HINTS = {
  focus: "pure monkeytype, typeracer shows up when you finish",
  full: "full screen with a small race track on top",
  classic: "monkeytype box inside the normal typeracer page",
};

const sizeInput = document.getElementById("size");
const sizeValue = document.getElementById("size-value");

let settings = { ...DEFAULTS };

function save(patch) {
  Object.assign(settings, patch);
  chrome.storage.local.set(patch);
  render();
}

function render() {
  for (const b of document.querySelectorAll("#mode button")) {
    b.classList.toggle("active", b.dataset.value === settings.mode);
  }
  for (const b of document.querySelectorAll("#stopOnLetter button")) {
    b.classList.toggle("active", b.dataset.value === String(settings.stopOnLetter));
  }
  document.getElementById("mode-hint").textContent = MODE_HINTS[settings.mode] || "";
  sizeInput.value = settings.fontSize;
  sizeValue.textContent = settings.fontSize + "px";
}

function setSize(px) {
  save({ fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(px))) });
}

document.getElementById("mode").addEventListener("click", (e) => {
  const v = e.target.dataset.value;
  if (v) save({ mode: v });
});
document.getElementById("stopOnLetter").addEventListener("click", (e) => {
  const v = e.target.dataset.value;
  if (v) save({ stopOnLetter: v === "true" });
});
sizeInput.addEventListener("input", () => setSize(+sizeInput.value));
document.getElementById("size-down").addEventListener("click", () => setSize(settings.fontSize - 4));
document.getElementById("size-up").addEventListener("click", () => setSize(settings.fontSize + 4));

chrome.storage.local.get(DEFAULTS, (s) => {
  settings = { ...DEFAULTS, ...s };
  if (!(settings.mode in MODE_HINTS)) settings.mode = DEFAULTS.mode;
  render();
});
