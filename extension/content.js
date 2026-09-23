// Monkeytype for TypeRacer
// Copyright (C) 2026 ngelkind (https://github.com/ngelkind/typeracer-monkeytype)
// SPDX-License-Identifier: AGPL-3.0-only
// Additional term (AGPL-3.0 section 7(b)): see the NOTICE file.
//
// The user keeps typing into TypeRacer's real <input> (focused, but invisible).
// We never synthesise input: we only read input.value + TypeRacer's per-char
// spans and draw a Monkeytype-style view of them.

(() => {
  "use strict";

  const settings = { enabled: true, stopOnLetter: false, full: true, fontSize: 54 };
  const FONT_MIN = 20, FONT_MAX = 110;

  let race = null;        // attached race state, see attach()
  let scheduled = false;
  let idleTimer = 0;

  // ---------- settings ----------

  function loadSettings(cb) {
    try {
      chrome.storage.local.get(settings, (s) => { Object.assign(settings, s); cb(); });
    } catch { cb(); }
  }
  function saveSettings() {
    try { chrome.storage.local.set(settings); } catch {}
  }

  function toast(msg) {
    let t = document.getElementById("mt-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "mt-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(t._h);
    t._h = setTimeout(() => (t.style.opacity = "0"), 1400);
  }

  // ---------- finding TypeRacer's race elements ----------

  function charSpans(textEl) {
    return textEl.querySelectorAll(":scope > span:not(.smooth-caret)");
  }

  function findRace() {
    for (const el of document.querySelectorAll("div.select-none")) {
      const spans = charSpans(el);
      if (spans.length < 20) continue;
      if (![...spans].slice(0, 20).every((s) => s.textContent.length === 1)) continue;
      // The card is the closest ancestor that also holds the typing input.
      let card = el.parentElement;
      while (card && !card.querySelector('input[type="text"]')) card = card.parentElement;
      if (!card) continue;
      return { textEl: el, inputEl: card.querySelector('input[type="text"]'), card };
    }
    return null;
  }

  function readText(textEl) {
    let s = "";
    for (const sp of charSpans(textEl)) s += sp.textContent;
    return s.replace(/ /g, " ");
  }

  // Index of the first char of the word TypeRacer is waiting on.
  function currentWordStart(textEl, len) {
    const spans = charSpans(textEl);
    for (let i = 0; i < spans.length; i++) {
      if (spans[i].classList.contains("underline")) return i;
    }
    // No underline: race finished (all success) or not rendered yet.
    let i = 0;
    while (i < spans.length && spans[i].classList.contains("text-success")) i++;
    return i >= spans.length ? len : 0;
  }

  // ---------- overlay ----------

  function buildOverlay(text) {
    const overlay = document.createElement("div");
    overlay.id = "mt-overlay";
    overlay.innerHTML =
      '<div class="mt-stats"><span class="mt-wpm"></span><span class="mt-prog"></span>' +
      '<span class="mt-mode"></span></div>' +
      '<div class="mt-viewport"><div class="mt-focus-msg">click here or press any key to focus</div>' +
      '<div class="mt-words"><div class="mt-caret"></div></div></div>';

    const wordsEl = overlay.querySelector(".mt-words");
    const letters = new Array(text.length).fill(null); // text index -> letter span (null for spaces)
    const wordOf = new Array(text.length).fill(-1);    // text index -> word index
    const wordEls = [];

    let i = 0;
    while (i < text.length) {
      if (text[i] === " ") { i++; continue; }
      const w = document.createElement("div");
      w.className = "mt-word";
      const wi = wordEls.length;
      while (i < text.length && text[i] !== " ") {
        const l = document.createElement("span");
        l.textContent = text[i];
        w.appendChild(l);
        letters[i] = l;
        wordOf[i] = wi;
        i++;
      }
      wordsEl.appendChild(w);
      wordEls.push(w);
    }
    // A space belongs to the word before it (that's where extras get drawn).
    for (let j = 0; j < text.length; j++) if (wordOf[j] === -1 && j > 0) wordOf[j] = wordOf[j - 1];

    return {
      overlay, wordsEl, letters, wordOf, wordEls,
      caret: overlay.querySelector(".mt-caret"),
      wpmEl: overlay.querySelector(".mt-wpm"),
      progEl: overlay.querySelector(".mt-prog"),
      modeEl: overlay.querySelector(".mt-mode"),
    };
  }

  function attach(found) {
    const text = readText(found.textEl);
    const ui = buildOverlay(text);
    race = {
      ...found, ...ui, text,
      prevLo: 0, prevHi: 0, extras: [], errWords: [], scrollY: -1,
      onInput: () => { markActive(); schedule(); },
      onKeydown: (e) => onInputKeydown(e),
      onFocus: () => schedule(),
      textObserver: new MutationObserver(schedule),
    };

    // The whole race card (status row, cars, text card) becomes the full-screen stage.
    let stage = found.card.parentElement;
    while (stage && !/bg-card-background/.test(stage.className)) stage = stage.parentElement;
    race.stage = stage || found.card.parentElement;
    race.stage.classList.add("mt-stage");

    found.card.classList.add("mt-card");
    for (const ch of found.card.children) ch.classList.add("mt-hidden");
    found.card.prepend(ui.overlay);

    ui.overlay.addEventListener("mousedown", (e) => {
      e.preventDefault();
      race.inputEl.focus({ preventScroll: true });
    });
    found.inputEl.addEventListener("input", race.onInput);
    found.inputEl.addEventListener("keydown", race.onKeydown, true);
    found.inputEl.addEventListener("focus", race.onFocus);
    found.inputEl.addEventListener("blur", race.onFocus);
    race.textObserver.observe(found.textEl, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true });

    applyLayout();
  }

  function applyLayout() {
    if (!race) return;
    document.documentElement.classList.toggle("mt-full", settings.full);
    race.overlay.style.setProperty("--mt-font-size", settings.full ? settings.fontSize + "px" : "");
    race.scrollY = -1;
    render();
  }

  function detach() {
    if (!race) return;
    race.textObserver.disconnect();
    race.inputEl.removeEventListener("input", race.onInput);
    race.inputEl.removeEventListener("keydown", race.onKeydown, true);
    race.inputEl.removeEventListener("focus", race.onFocus);
    race.inputEl.removeEventListener("blur", race.onFocus);
    race.overlay.remove();
    race.stage.classList.remove("mt-stage");
    document.documentElement.classList.remove("mt-full");
    race.card.classList.remove("mt-card");
    for (const ch of race.card.children) ch.classList.remove("mt-hidden");
    race = null;
  }

  // Render in a microtask, not rAF: it still lands before the next paint (no
  // extra frame of latency). TypeRacer's own DOM update after a keystroke
  // re-triggers us via textObserver, so the painted state is always consistent.
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (race) render(); });
  }

  function markActive() {
    if (!race) return;
    race.overlay.classList.remove("mt-idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => race && race.overlay.classList.add("mt-idle"), 600);
  }

  // ---------- rendering ----------

  function render() {
    const r = race;
    const { text, letters, wordOf, wordEls } = r;
    const wordStart = currentWordStart(r.textEl, text.length);
    const typed = r.inputEl.value;
    const hi = Math.min(text.length, wordStart + typed.length);

    // Reset whatever the previous render touched, plus everything up to the current word.
    const lo = Math.min(r.prevLo, wordStart);
    const resetHi = Math.max(r.prevHi, hi);
    for (let i = lo; i < resetHi; i++) {
      const l = letters[i];
      if (l) l.className = i < wordStart ? "c" : "";
    }
    for (const x of r.extras) x.remove();
    r.extras = [];
    for (const w of r.errWords) w.classList.remove("err");
    r.errWords = [];

    // TypeRacer compares the input against the text starting at the current word.
    let lastEl = null;      // element the caret sits right after
    let lastIdx = -1;
    for (let k = 0; k < typed.length; k++) {
      const idx = wordStart + k;
      const ch = typed[k];
      if (idx >= text.length) {
        lastEl = addExtra(wordEls[wordEls.length - 1], ch);
        continue;
      }
      const l = letters[idx];
      if (l) {
        l.className = ch === text[idx] ? "c" : "i";
        if (ch !== text[idx]) markErr(wordEls[wordOf[idx]]);
        lastEl = l;
      } else if (ch !== " ") {
        // Typed a letter where a space belongs: Monkeytype-style extra letter.
        lastEl = addExtra(wordEls[wordOf[idx]], ch);
        markErr(wordEls[wordOf[idx]]);
      } else {
        lastEl = null; // correct space: caret goes to the next word's first letter
      }
      lastIdx = idx;
    }
    r.prevLo = wordStart;
    r.prevHi = hi;

    placeCaret(lastEl, lastIdx >= 0 ? lastIdx + 1 : wordStart);
    updateStats(wordStart);
    r.overlay.classList.toggle("mt-blurred", document.activeElement !== r.inputEl);
  }

  function addExtra(wordEl, ch) {
    const x = document.createElement("span");
    x.className = "x";
    x.textContent = ch === " " ? "_" : ch;
    wordEl.appendChild(x);
    race.extras.push(x);
    return x;
  }

  function markErr(wordEl) {
    wordEl.classList.add("err");
    race.errWords.push(wordEl);
  }

  function placeCaret(afterEl, nextIdx) {
    const r = race;
    let x, el;
    if (afterEl) {
      el = afterEl;
      x = el.offsetLeft + el.offsetWidth;
    } else {
      let i = nextIdx;
      while (i < r.text.length && !r.letters[i]) i++;
      el = r.letters[i];
      if (el) {
        x = el.offsetLeft;
      } else {
        // End of text: after the last letter.
        el = r.wordEls[r.wordEls.length - 1].lastElementChild;
        x = el.offsetLeft + el.offsetWidth;
      }
    }
    // Word boxes are exactly one line tall, so their offsetTop is the line's top.
    const y = el.parentElement.offsetTop;
    r.caret.style.transform = `translate(${x}px, ${y}px)`;

    // Monkeytype line jump: keep the active line as the 2nd visible line.
    const lineH = r.wordEls[0].offsetHeight || 1;
    const line = Math.round(y / lineH);
    const scrollY = Math.max(0, line - 1) * lineH;
    if (scrollY !== r.scrollY) {
      r.scrollY = scrollY;
      r.wordsEl.style.transform = `translateY(${-scrollY}px)`;
    }
  }

  function updateStats(wordStart) {
    const r = race;
    const done = wordStart >= r.text.length ? r.wordEls.length : r.wordOf[wordStart];
    r.progEl.textContent = `${Math.max(0, done)}/${r.wordEls.length}`;
    r.wpmEl.textContent = readWpm() ?? "";
    r.modeEl.textContent = settings.stopOnLetter ? "stop on letter" : "";
  }

  // TypeRacer's own live WPM label ("67 WPM") from the race-track header above the card.
  function readWpm() {
    let panel = race.card.parentElement;
    for (let d = 0; panel && d < 4; d++, panel = panel.parentElement) {
      for (const el of panel.querySelectorAll("div, span")) {
        if (el.children.length === 0 && /^\d+\s*WPM$/.test(el.textContent.trim()) && !race.card.contains(el)) {
          return el.textContent.trim().replace(/\s*WPM$/, "");
        }
      }
    }
    return null;
  }

  // ---------- keyboard ----------

  function onInputKeydown(e) {
    if (!settings.stopOnLetter || !race) return;
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const input = race.inputEl;
    if (input.selectionStart !== input.value.length) return;
    const wordStart = currentWordStart(race.textEl, race.text.length);
    const expected = race.text[wordStart + input.value.length];
    // Only ever *blocks* a wrong key; never inserts anything.
    if (e.key !== expected) e.preventDefault();
  }

  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.code === "KeyM") {
      e.preventDefault();
      settings.enabled = !settings.enabled;
      saveSettings();
      if (!settings.enabled) detach();
      else check();
      toast(settings.enabled ? "Monkeytype skin on" : "Monkeytype skin off");
      return;
    }
    if (e.altKey && e.code === "KeyL") {
      e.preventDefault();
      settings.stopOnLetter = !settings.stopOnLetter;
      saveSettings();
      if (race) schedule();
      toast(`stop on letter: ${settings.stopOnLetter ? "on" : "off"}`);
      return;
    }
    if (e.altKey && e.code === "KeyF") {
      e.preventDefault();
      settings.full = !settings.full;
      saveSettings();
      applyLayout();
      toast(`full screen: ${settings.full ? "on" : "off"}`);
      return;
    }
    if (e.altKey && (e.code === "Equal" || e.code === "Minus")) {
      e.preventDefault();
      const step = e.code === "Equal" ? 4 : -4;
      settings.fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, settings.fontSize + step));
      saveSettings();
      applyLayout();
      toast(`font size: ${settings.fontSize}px`);
      return;
    }
    // Any printable key while the race input is blurred focuses it; Chrome then
    // delivers this same (real) keystroke to the input.
    if (!race || document.activeElement === race.inputEl) return;
    const a = document.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey) return;
    race.inputEl.focus({ preventScroll: true });
  }, true);

  // ---------- lifecycle ----------

  function check() {
    if (!settings.enabled) return;
    if (race) {
      const stillThere = race.textEl.isConnected && race.inputEl.isConnected && race.overlay.isConnected;
      if (stillThere && readText(race.textEl) === race.text) return;
      detach();
    }
    const found = findRace();
    if (found) attach(found);
  }

  let checkQueued = false;
  const bodyObserver = new MutationObserver(() => {
    if (checkQueued) return;
    checkQueued = true;
    setTimeout(() => { checkQueued = false; check(); }, 100);
  });

  window.addEventListener("resize", () => { if (race) { race.scrollY = -1; schedule(); } });

  setInterval(() => race && updateStats(currentWordStart(race.textEl, race.text.length)), 250);

  loadSettings(() => {
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    check();
  });
})();
