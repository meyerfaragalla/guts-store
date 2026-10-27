/* Video spots: links come from the "Videos" tab of the Website Content sheet.
 * - The home background loop is always muted, never has controls, and is skipped (photo shown instead)
 *   on data-saver, very slow connections, or when the visitor prefers reduced motion.
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

  // ---------- Home background loop ----------
  function renderHero(el, spot) {
    var photoSrc = photo(spot, 1600);
    var src = spot && parse(spot.video);
    var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var conn = navigator.connection || {};
    var slow = conn.saveData || /(^|-)2g$/.test(conn.effectiveType || "");

    function showPhoto() {
      el.innerHTML = photoSrc ? '<img class="hero-media" src="' + GD.esc(photoSrc) + '" alt="">' : "";
    }
    if (!src || src.type !== "file" || reduced || slow) return showPhoto();

    var v = document.createElement("video");
    v.className = "hero-media";
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("aria-hidden", "true");
    v.autoplay = true;
    v.loop = true;
    v.preload = "auto";
    v.disablePictureInPicture = true;
    if (photoSrc) v.poster = photoSrc;
    v.addEventListener("error", showPhoto);
    v.src = src.src;
    el.innerHTML = "";
    el.appendChild(v);

    // Anything that moves for more than 5 seconds needs a pause button.
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hero-pause";
    function label() {
      var paused = v.paused;
      btn.setAttribute("aria-label", paused ? GD.t("Play background video", "شغّل فيديو الخلفية") : GD.t("Pause background video", "أوقف فيديو الخلفية"));
      btn.textContent = paused ? "▶" : "❚❚";
    }
    btn.addEventListener("click", function () { if (v.paused) v.play(); else v.pause(); });
    v.addEventListener("play", label);
    v.addEventListener("pause", label);
    document.addEventListener("gd:lang", label);
    el.appendChild(btn);
    label();
    var p = v.play();
    if (p && p.catch) p.catch(label);
  }

  // ---------- Talking videos ----------
  function renderTalking(el, spot, text) {
    if (el.querySelector("iframe") || (el.querySelector("video") && !el.querySelector("video").paused)) return true;
    var title = GD.t(text.en, text.ar);
    var src = spot && parse(spot.video);
    var photoSrc = photo(spot, 1000);
    var capEn = spot && captionFile(spot.captionsEn);
    var capAr = spot && captionFile(spot.captionsAr);
    el.classList.toggle("tall", !!(spot && spot.tall));

    if (src && src.type === "youtube") {
      var poster = photoSrc || "https://i.ytimg.com/vi/" + src.id + "/hqdefault.jpg";
      el.innerHTML = '<div class="video-frame"><button type="button" class="video-facade" aria-label="' +
        GD.esc(GD.t("Play video with captions: ", "شغّل الفيديو بالترجمة: ") + title) + '">' +
        '<img src="' + GD.esc(poster) + '" alt="" loading="lazy"><span class="play-icon" aria-hidden="true"></span></button></div>' +
        '<p class="hint">' + GD.t("Captions on. It only plays when you press play.", "بالترجمة. مش بيشتغل غير لما تدوس تشغيل.") + "</p>";
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
      el.innerHTML = '<div class="video-frame photo"><img src="' + GD.esc(photoSrc) + '" alt="' + GD.esc(GD.t(text.altEn, text.altAr)) + '" loading="lazy"></div>';
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
    var current = null;
    function draw() { wrap.classList.toggle("hidden", !renderTalking(el, current, text)); }
    GD.getContent().then(function (c) {
      current = (c.videos || {})[key] || null;
      draw();
    }).catch(function () { wrap.classList.add("hidden"); });
    document.addEventListener("gd:lang", function () { if (current) draw(); });
  }

  GD.renderHero = renderHero;
  GD.mountTalking = mountTalking;
})();
