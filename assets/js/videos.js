/* Video spots: links come from the "Videos" tab of the Website Content sheet.
 * - Silent loops (home background, hands wrapping a handle, reviews reel) are always muted, never have controls,
 *   and are skipped (photo shown instead) on data-saver, very slow connections, or when the visitor prefers reduced motion.
 * - Talking videos never play by themselves and always come with captions.
 *   YouTube links load nothing from YouTube until the visitor presses play.
 */
(function () {
  "use strict";
  var GD = window.GD;

  function parse(link) {
    link = String(link || "").trim();
    if (!link) return null;
    var yt = link.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
    if (yt) return { type: "youtube", id: yt[1] };
    var drive = link.match(/drive\.google\.com\/.*(?:\/d\/|[?&]id=)([\w-]{20,})/);
    if (drive) return { type: "file", src: "https://drive.google.com/uc?export=download&id=" + drive[1] };
    if (/^(https:\/\/[^\s"'<>]+|[\w\-./]+)\.(mp4|webm)(\?[^\s"'<>]*)?$/i.test(link) && link.indexOf("..") === -1) return { type: "file", src: link };
    return null;
  }

  // Caption files must be .vtt files on this site (other sites block them).
  function captionFile(p) {
    p = String(p || "").trim();
    return /^[\w\-./]+\.vtt$/i.test(p) && p.indexOf("..") === -1 ? p : "";
  }

  function photo(spot, width) { return spot ? GD.driveImage(spot.photo, width) : ""; }

  // ---------- Silent loops ----------
  // Returns true when something (video or photo) was shown.
  function renderLoop(el, spot, opts) {
    opts = opts || {};
    var photoSrc = photo(spot, opts.width || 1600);
    var src = spot && parse(spot.video);
    var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var conn = navigator.connection || {};
    var slow = conn.saveData || /(^|-)2g$/.test(conn.effectiveType || "");
    var alt = opts.altKey ? GD.tx(opts.altKey) : "";
    var cls = opts.className || "loop-media";

    function showPhoto() {
      el.innerHTML = photoSrc ? '<img class="' + cls + '" src="' + GD.esc(photoSrc) + '" alt="' + GD.esc(alt) + '">' : "";
      return !!photoSrc;
    }
    if (el.querySelector("video")) return true; // already playing: don't restart on language switch
    if (!src || src.type !== "file" || reduced || slow) return showPhoto();

    var v = document.createElement("video");
    v.className = cls;
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    if (alt) { v.setAttribute("aria-label", alt); v.setAttribute("role", "img"); } else v.setAttribute("aria-hidden", "true");
    v.autoplay = true;
    v.loop = true;
    v.preload = opts.lazy ? "none" : "auto";
    v.disablePictureInPicture = true;
    if (photoSrc) v.poster = photoSrc;
    v.addEventListener("error", showPhoto);
    v.src = src.src;
    el.innerHTML = "";
    el.appendChild(v);

    // Anything that moves for more than 5 seconds needs a pause button.
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "loop-pause";
    function label() {
      btn.setAttribute("aria-label", GD.tx(v.paused ? "video.resume" : "video.pause"));
      btn.textContent = v.paused ? "▶" : "❚❚";
    }
    btn.addEventListener("click", function () { if (v.paused) v.play(); else v.pause(); });
    v.addEventListener("play", label);
    v.addEventListener("pause", label);
    document.addEventListener("gd:lang", label);
    el.appendChild(btn);
    label();

    function start() { var p = v.play(); if (p && p.catch) p.catch(label); }
    if (opts.lazy && "IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) { v.preload = "auto"; start(); io.disconnect(); }
      });
      io.observe(el);
    } else start();
    return true;
  }

  // ---------- Talking videos ----------
  function renderTalking(el, spot, text) {
    if (el.querySelector("iframe") || (el.querySelector("video") && !el.querySelector("video").paused)) return true;
    var title = GD.tx(text.titleKey);
    var src = spot && parse(spot.video);
    var photoSrc = photo(spot, 1000);
    var capEn = spot && captionFile(spot.captionsEn);
    var capAr = spot && captionFile(spot.captionsAr);
    el.classList.toggle("tall", !!(spot && spot.tall));

    if (src && src.type === "youtube") {
      var poster = photoSrc || "https://i.ytimg.com/vi/" + src.id + "/hqdefault.jpg";
      el.innerHTML = '<div class="video-frame"><button type="button" class="video-facade" aria-label="' +
        GD.esc(GD.tx("video.play") + title) + '">' +
        '<img src="' + GD.esc(poster) + '" alt="" loading="lazy"><span class="play-icon" aria-hidden="true"></span></button></div>' +
        '<p class="hint">' + GD.esc(GD.tx("video.hint")) + "</p>";
      el.querySelector(".video-facade").addEventListener("click", function () {
        var lang = GD.lang();
        var f = document.createElement("iframe");
        f.src = "https://www.youtube-nocookie.com/embed/" + src.id + "?autoplay=1&cc_load_policy=1&cc_lang_pref=" + lang + "&hl=" + lang + "&rel=0&playsinline=1";
        f.title = title;
        f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
        f.allowFullscreen = true;
        f.referrerPolicy = "strict-origin-when-cross-origin";
        var frame = el.querySelector(".video-frame");
        frame.innerHTML = "";
        frame.appendChild(f);
        f.focus();
      });
      return true;
    }

    if (src && src.type === "file" && (capEn || capAr)) {
      var lang = GD.lang();
      var defaultLang = (lang === "ar" && capAr) || !capEn ? "ar" : "en";
      var tracks = (capEn ? '<track kind="captions" srclang="en" label="English" src="' + GD.esc(capEn) + '"' + (defaultLang === "en" ? " default" : "") + ">" : "") +
        (capAr ? '<track kind="captions" srclang="ar" label="العربية" src="' + GD.esc(capAr) + '"' + (defaultLang === "ar" ? " default" : "") + ">" : "");
      el.innerHTML = '<div class="video-frame"><video controls preload="none" playsinline' + (photoSrc ? ' poster="' + GD.esc(photoSrc) + '"' : "") +
        ' aria-label="' + GD.esc(title) + '"><source src="' + GD.esc(src.src) + '">' + tracks + "</video></div>";
      return true;
    }

    // No usable video (or a video without captions): show the photo instead.
    if (photoSrc) {
      el.innerHTML = '<div class="video-frame photo"><img src="' + GD.esc(photoSrc) + '" alt="' + GD.esc(GD.tx(text.altKey)) + '" loading="lazy"></div>';
      return true;
    }
    el.innerHTML = "";
    return false;
  }

  // Fills a talking-video spot and shows or hides its wrapper.
  function mountTalking(wrapId, spotId, key, text) {
    var wrap = document.getElementById(wrapId);
    var el = document.getElementById(spotId);
    if (!wrap || !el) return;
    GD.onContent(function (c) {
      wrap.classList.toggle("hidden", !renderTalking(el, (c.videos || {})[key] || null, text));
    });
  }

  GD.renderLoop = renderLoop;
  GD.renderTalking = renderTalking;
  GD.mountTalking = mountTalking;
})();
