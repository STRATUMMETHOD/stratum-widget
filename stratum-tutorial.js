/* stratum-tutorial.js — per-section, per-language YouTube tutorial button + player overlay.
 *
 * Usage from any dashboard module:
 *   var tut = StratumTutorial.attach(containerEl, {
 *     section: "profile",          // key used in the tutorial_videos table
 *     lang: currentLang,           // student's language code ("en", "ur", "de"...)
 *     label: t("tutorial.watch"),  // translated button text
 *     closeLabel: t("tutorial.close")
 *   });
 *   // on language switch:
 *   tut.update({ lang: newLang, label: t("tutorial.watch"), closeLabel: t("tutorial.close") });
 *
 * The button only renders when a video exists for that section in the
 * student's language or in English (fallback).
 */
(function () {
  "use strict";

  var API = "https://stratum-proxy.tedbaker0207.workers.dev";
  var ID_RE = /^[A-Za-z0-9_-]{11}$/;
  var videosPromise = null;
  var overlay = null;
  var lastFocus = null;

  function loadVideos() {
    if (!videosPromise) {
      videosPromise = fetch(API + "/tutorial-videos")
        .then(function (r) { return r.ok ? r.json() : { videos: {} }; })
        .then(function (d) { return (d && d.videos) || {}; })
        .catch(function () { return {}; });
    }
    return videosPromise;
  }

  function pickId(videos, section, lang) {
    var s = videos[section];
    if (!s) return null;
    var l = String(lang || "en").toLowerCase();
    var id = s[l] || s[l.split("-")[0]] || s.en || null;
    return id && ID_RE.test(id) ? id : null;
  }

  function injectStyles() {
    if (document.getElementById("sh-tut-styles")) return;
    var css =
      ".sh-tut-btn{display:inline-flex;align-items:center;gap:.45em;background:transparent;" +
      "border:1px solid rgba(201,164,108,.45);color:#C9A46C;font:inherit;font-size:.8rem;" +
      "letter-spacing:.02em;padding:.35em .8em .35em .6em;border-radius:999px;cursor:pointer;" +
      "transition:background .15s,border-color .15s;white-space:nowrap}" +
      ".sh-tut-btn:hover{background:rgba(201,164,108,.1);border-color:#C9A46C}" +
      ".sh-tut-btn:focus-visible{outline:2px solid #C9A46C;outline-offset:2px}" +
      ".sh-tut-btn svg{width:.95em;height:.95em;flex:none}" +
      ".sh-tut-overlay{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.86);" +
      "display:flex;align-items:center;justify-content:center;padding:4vh 4vw}" +
      ".sh-tut-frame{position:relative;width:100%;max-width:1040px}" +
      ".sh-tut-ratio{position:relative;width:100%;aspect-ratio:16/9;background:#000;" +
      "border:1px solid rgba(201,164,108,.3)}" +
      ".sh-tut-ratio iframe{position:absolute;inset:0;width:100%;height:100%;border:0}" +
      ".sh-tut-close{position:absolute;top:-2.6rem;inset-inline-end:0;background:transparent;" +
      "border:0;color:#F0E8D8;font:inherit;font-size:.85rem;cursor:pointer;padding:.4rem .2rem}" +
      ".sh-tut-close:hover{color:#C9A46C}" +
      ".sh-tut-close:focus-visible{outline:2px solid #C9A46C;outline-offset:2px}";
    var style = document.createElement("style");
    style.id = "sh-tut-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function playIcon() {
    return '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.25" ' +
      'fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M6.4 5.2v5.6L11 8z" ' +
      'fill="currentColor"/></svg>';
  }

  function onKey(e) { if (e.key === "Escape") close(); }

  function close() {
    if (!overlay) return;
    overlay.remove(); // removing the iframe stops playback
    overlay = null;
    document.documentElement.style.overflow = "";
    document.removeEventListener("keydown", onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function open(id, lang, closeLabel) {
    close();
    lastFocus = document.activeElement;
    var l = encodeURIComponent(String(lang || "en").split("-")[0]);
    overlay = document.createElement("div");
    overlay.className = "sh-tut-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML =
      '<div class="sh-tut-frame">' +
        '<button type="button" class="sh-tut-close"></button>' +
        '<div class="sh-tut-ratio"><iframe src="https://www.youtube-nocookie.com/embed/' + id +
        "?autoplay=1&rel=0&playsinline=1&hl=" + l + "&cc_lang_pref=" + l +
        '" title="Tutorial" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" ' +
        "allowfullscreen></iframe></div>" +
      "</div>";
    var btn = overlay.querySelector(".sh-tut-close");
    btn.textContent = "✕  " + (closeLabel || "Close");
    btn.addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    document.documentElement.style.overflow = "hidden";
    document.body.appendChild(overlay);
    btn.focus();
  }

  function attach(container, opts) {
    injectStyles();
    var state = {
      section: opts.section,
      lang: opts.lang || "en",
      label: opts.label || "Watch tutorial",
      closeLabel: opts.closeLabel || "Close"
    };
    var btn = null;

    function render() {
      loadVideos().then(function (videos) {
        var id = pickId(videos, state.section, state.lang);
        if (!id) {
          if (btn) { btn.remove(); btn = null; }
          return;
        }
        if (!btn) {
          btn = document.createElement("button");
          btn.type = "button";
          btn.className = "sh-tut-btn";
          btn.addEventListener("click", function () {
            var cur = pickId(videos, state.section, state.lang);
            if (cur) {
              // Sept 29 2026: reported to the admin Activity tab.
              try {
                if (window.StratumIdentity && typeof window.StratumIdentity.track === "function") {
                  window.StratumIdentity.track("tutorial_play", { title: state.section, section: state.section, lang: state.lang });
                }
              } catch (e) { /* tracking must never affect the page */ }
              open(cur, state.lang, state.closeLabel);
            }
          });
          container.appendChild(btn);
        }
        btn.innerHTML = playIcon() + "<span></span>";
        btn.querySelector("span").textContent = state.label;
      });
    }

    render();
    return {
      update: function (next) {
        next = next || {};
        if (next.lang) state.lang = next.lang;
        if (next.label) state.label = next.label;
        if (next.closeLabel) state.closeLabel = next.closeLabel;
        render();
      },
      remove: function () { if (btn) btn.remove(); btn = null; }
    };
  }

  window.StratumTutorial = {
    attach: attach,
    open: open,
    close: close,
    refresh: function () { videosPromise = null; }
  };
})();
