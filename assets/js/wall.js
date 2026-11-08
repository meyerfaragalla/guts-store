/* "See it on your wall" (Hormozi attraction offer + Meyer's "let them see it in their own space").
   The customer takes or picks a photo of their wall; the sword is drawn on it in the browser.
   The photo NEVER leaves the phone: it is read with an object URL and drawn on a canvas, nothing is sent.
   Opened by any element with [data-wall]. On a product page the current sword is chosen automatically. */
(function () {
  "use strict";
  var CUTS = ["frostmourne", "anduril", "tensa-zangetsu", "yone", "zangetsu", "talon-s-sword", "enma", "shusui"];
  var TIER_DEFAULT = { "t-classic": "yone", "t-premium": "tensa-zangetsu", "t-collector-s": "frostmourne" };
  var BLACK = "#18151a", WOOD = "#c28a54";
  var content = null, el = {}, st = null;

  function t(key, en, ar) { var s = GD.tx(key); return s || GD.t(en, ar); }
  function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function esc(s) { return GD.esc(s); }

  function swords() {
    var list = [];
    (content && content.designs || []).forEach(function (d) {
      var s = slug(d.name);
      if (CUTS.indexOf(s) < 0) return;
      var m = String(d.sizes || "").match(/(\d{2,3})\s*cm/i);
      list.push({ slug: s, name: GD.lang() === "ar" ? (d.nameAr || d.name) : d.name, cm: m ? Number(m[1]) : 120, id: "d-" + s });
    });
    return list;
  }

  function startSword(list) {
    var id = new URLSearchParams(location.search).get("id") || "";
    var want = id.indexOf("d-") === 0 ? id.slice(2) : TIER_DEFAULT[id] || "frostmourne";
    var hit = list.filter(function (s) { return s.slug === want; })[0];
    return hit || list[0];
  }

  // ---------- UI ----------
  function build() {
    var wrap = document.createElement("div");
    wrap.className = "wall-modal hidden";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "wall-title");
    wrap.innerHTML =
      '<div class="wall-box">' +
        '<div class="wall-head"><h2 id="wall-title">' + esc(t("wall.title", "See it on your wall", "شوفه على حيطتك")) + '</h2>' +
        '<button type="button" class="wall-x" id="wall-x" aria-label="' + esc(t("wall.close", "Close", "إغلاق")) + '">×</button></div>' +
        '<div class="wall-start" id="wall-start">' +
          '<p>' + esc(t("wall.intro", "Take a photo of your wall, or pick one from your phone. Your sword appears on it, and you can move and size it.", "صوّر حيطتك أو اختار صورة من موبايلك. السيف هيظهر عليها وتقدر تحركه وتكبّره.")) + '</p>' +
          '<label class="btn btn-gold wall-pick">' + esc(t("wall.pick", "Take or choose a photo", "صوّر أو اختار صورة")) +
          '<input type="file" accept="image/*" id="wall-file" hidden></label>' +
          '<p class="wall-private">' + esc(t("wall.private", "Your photo stays on your phone. Nothing is uploaded.", "صورتك بتفضل على موبايلك. مفيش حاجة بتترفع.")) + '</p>' +
        '</div>' +
        '<div class="wall-stage hidden" id="wall-stage">' +
          '<canvas id="wall-canvas"></canvas>' +
          '<p class="wall-hint" id="wall-hint"></p>' +
          '<div class="wall-controls">' +
            '<label class="wall-ctl"><span>' + esc(t("wall.sword", "Sword", "السيف")) + '</span><select id="wall-sword"></select></label>' +
            '<label class="wall-ctl"><span>' + esc(t("wall.size", "Size", "المقاس")) + '</span><input type="range" id="wall-size" min="6" max="95" value="40"></label>' +
            '<div class="wall-row">' +
              '<button type="button" class="btn btn-ghost wall-small" id="wall-rot">' + esc(t("wall.rotate", "Turn sideways", "لفّه بالعرض")) + '</button>' +
              '<label class="check wall-check"><input type="checkbox" id="wall-plaque"><span>' + esc(t("wall.plaque", "Black oval plaque", "لوحة بيضاوي سودا")) + '</span></label>' +
            '</div>' +
            '<label class="wall-ctl" id="wall-name-wrap"><span>' + esc(t("wall.name", "Name to carve (up to 10 letters)", "الاسم اللي هيتحفر (لحد ١٠ حروف)")) + '</span>' +
              '<input type="text" id="wall-name" maxlength="10" autocomplete="off"></label>' +
          '</div>' +
          '<div class="wall-actions">' +
            '<button type="button" class="btn btn-gold" id="wall-save">' + esc(t("wall.save", "Save picture", "احفظ الصورة")) + '</button>' +
            '<a class="btn btn-ghost" id="wall-order" href="#">' + esc(t("wall.order", "Order this sword", "اطلب السيف ده")) + '</a>' +
            '<a class="link-u" id="wall-ig" href="https://ig.me/m/guts_san_store" target="_blank" rel="noopener" data-track="tap:wall-ig">' + esc(t("wall.ig", "Send it to me on Instagram", "ابعتهالي على إنستجرام")) + '</a>' +
            '<label class="link-u wall-again">' + esc(t("wall.again", "Use another photo", "استخدم صورة تانية")) + '<input type="file" accept="image/*" id="wall-file2" hidden></label>' +
          '</div>' +
          '<p class="wall-note">' + esc(t("wall.note", "A preview to help you picture it. Your piece is made by hand, so small details may differ.", "معاينة تساعدك تتخيله. القطعة بتتعمل بالإيد فممكن تفاصيل صغيرة تختلف.")) + '</p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    ["x", "start", "file", "file2", "stage", "canvas", "hint", "sword", "size", "rot", "plaque", "name", "name-wrap", "save", "order"].forEach(function (k) {
      el[k] = document.getElementById("wall-" + k);
    });
    el.modal = wrap;
    el.ctx = el.canvas.getContext("2d");

    el.x.addEventListener("click", close);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !wrap.classList.contains("hidden")) close(); });
    el.file.addEventListener("change", onFile);
    el.file2.addEventListener("change", onFile);
    el.sword.addEventListener("change", function () { setSword(el.sword.value); });
    el.size.addEventListener("input", function () { st.len = Number(el.size.value) / 100 * Math.max(el.canvas.width, el.canvas.height); draw(); });
    el.rot.addEventListener("click", function () { st.rot = st.rot ? 0 : 90; draw(); });
    el.plaque.addEventListener("change", function () { st.plaque = el.plaque.checked; el["name-wrap"].classList.toggle("hidden", !st.plaque); draw(); });
    el.name.addEventListener("input", function () { st.name = el.name.value.toUpperCase().slice(0, 10); draw(); });
    el.save.addEventListener("click", save);
    el.order.addEventListener("click", order);
    pointer();
  }

  function open() {
    if (!el.modal) build();
    var list = swords();
    el.sword.innerHTML = list.map(function (s) { return '<option value="' + s.slug + '">' + esc(s.name) + "</option>"; }).join("");
    var first = startSword(list);
    st = { list: list, photo: null, img: null, sword: first, x: 0, y: 0, len: 0, rot: 0, plaque: false, name: "" };
    el.sword.value = first.slug;
    st.plaque = first.slug === "frostmourne" || /collector/.test(location.search);
    el.plaque.checked = st.plaque;
    el["name-wrap"].classList.toggle("hidden", !st.plaque);
    el.start.classList.remove("hidden");
    el.stage.classList.add("hidden");
    el.modal.classList.remove("hidden");
    document.body.classList.add("wall-open");
    GD.track && GD.track("tap:wall-open");
    el.x.focus();
  }

  function close() {
    el.modal.classList.add("hidden");
    document.body.classList.remove("wall-open");
    if (st && st.photoUrl) URL.revokeObjectURL(st.photoUrl);
  }

  function onFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (st.photoUrl) URL.revokeObjectURL(st.photoUrl);
    st.photoUrl = URL.createObjectURL(f); // local only, never sent anywhere
    var img = new Image();
    img.onload = function () {
      var max = 1400, k = Math.min(1, max / Math.max(img.width, img.height));
      el.canvas.width = Math.round(img.width * k); el.canvas.height = Math.round(img.height * k);
      st.photo = img;
      st.x = el.canvas.width / 2; st.y = el.canvas.height * 0.42;
      st.len = Number(el.size.value) / 100 * Math.max(el.canvas.width, el.canvas.height);
      el.start.classList.add("hidden"); el.stage.classList.remove("hidden");
      setSword(st.sword.slug);
      GD.track && GD.track("tap:wall-photo");
    };
    img.src = st.photoUrl;
    e.target.value = "";
  }

  function setSword(s) {
    st.sword = st.list.filter(function (x) { return x.slug === s; })[0] || st.list[0];
    var img = new Image();
    img.onload = function () { st.img = img; draw(); };
    img.src = "assets/wall/" + st.sword.slug + ".webp";
    el.hint.textContent = t("wall.hint", "Drag to move it. Pinch or use the slider to size it. Tip: a door is about 200 cm tall, this piece is {cm} cm.",
      "اسحبه علشان تحركه، وكبّره بصباعين أو بالشريط. معلومة: الباب طوله حوالي ٢٠٠ سم، والقطعة دي {cm} سم.").replace("{cm}", GD.num(st.sword.cm));
    el.order.setAttribute("href", "product.html?id=" + encodeURIComponent(st.sword.id));
  }

  // ---------- drawing ----------
  function draw() {
    var c = el.ctx, cv = el.canvas;
    if (!st.photo) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(st.photo, 0, 0, cv.width, cv.height);
    if (!st.img) return;
    var L = st.len, ar = st.img.width / st.img.height;
    var h = L, w = L * ar; // the cut-outs are taller than wide (sword standing up)
    c.save();
    c.translate(st.x, st.y);
    c.rotate(st.rot * Math.PI / 180);
    if (st.plaque) {
      var ph = 0.30 * L, pw = ph * 0.72, py = -h / 2 + 0.42 * h;
      var g = c.createRadialGradient(-pw * 0.2, py - ph * 0.25, ph * 0.05, 0, py, ph * 0.6);
      g.addColorStop(0, "#3b363d"); g.addColorStop(1, BLACK);
      c.shadowColor = "rgba(0,0,0,.45)"; c.shadowBlur = L * 0.03; c.shadowOffsetX = L * 0.008; c.shadowOffsetY = L * 0.012;
      c.beginPath(); c.ellipse(0, py, pw / 2, ph / 2, 0, 0, Math.PI * 2); c.fillStyle = g; c.fill();
      c.shadowColor = "transparent";
      c.lineWidth = Math.max(1, ph * 0.02); c.strokeStyle = "rgba(255,255,255,.12)"; c.stroke();
    }
    c.shadowColor = "rgba(0,0,0,.40)"; c.shadowBlur = L * 0.025; c.shadowOffsetX = L * 0.01; c.shadowOffsetY = L * 0.015;
    c.drawImage(st.img, -w / 2, -h / 2, w, h);
    c.shadowColor = "transparent";
    if (st.plaque && st.name) {
      // carved through the black: natural wood shows inside the letters, on the lower part of the plaque
      var ph2 = 0.30 * L, py2 = -h / 2 + 0.42 * h + ph2 * 0.34, fs = Math.max(10, ph2 * 0.13);
      c.font = "600 " + fs + "px Cinzel, serif"; c.textAlign = "center"; c.textBaseline = "middle";
      var tw = c.measureText(st.name).width, bw = tw + fs * 0.9;
      c.fillStyle = BLACK; c.fillRect(-bw / 2, py2 - fs * 0.75, bw, fs * 1.5);
      c.fillStyle = "rgba(0,0,0,.6)"; c.fillText(st.name, fs * 0.04, py2 + fs * 0.05);
      c.fillStyle = WOOD; c.fillText(st.name, 0, py2);
    }
    c.restore();
  }

  // ---------- touch / mouse ----------
  function pointer() {
    var pts = {}, last = null, pinch0 = 0, len0 = 0;
    function pos(e) {
      var r = el.canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * el.canvas.width / r.width, y: (e.clientY - r.top) * el.canvas.height / r.height };
    }
    el.canvas.addEventListener("pointerdown", function (e) {
      el.canvas.setPointerCapture(e.pointerId); pts[e.pointerId] = pos(e);
      var ids = Object.keys(pts);
      if (ids.length === 2) { pinch0 = dist(pts[ids[0]], pts[ids[1]]); len0 = st.len; }
      last = pos(e);
    });
    el.canvas.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = pos(e);
      var ids = Object.keys(pts);
      if (ids.length >= 2 && pinch0) {
        st.len = Math.max(30, len0 * dist(pts[ids[0]], pts[ids[1]]) / pinch0);
        el.size.value = Math.round(st.len / Math.max(el.canvas.width, el.canvas.height) * 100);
      } else if (last) {
        var p = pos(e); st.x += p.x - last.x; st.y += p.y - last.y; last = p;
      }
      draw(); e.preventDefault();
    });
    function up(e) { delete pts[e.pointerId]; if (Object.keys(pts).length < 2) pinch0 = 0; last = null; }
    el.canvas.addEventListener("pointerup", up);
    el.canvas.addEventListener("pointercancel", up);
    el.canvas.addEventListener("wheel", function (e) {
      e.preventDefault(); st.len = Math.max(30, st.len * (e.deltaY < 0 ? 1.06 : 0.94));
      el.size.value = Math.round(st.len / Math.max(el.canvas.width, el.canvas.height) * 100); draw();
    }, { passive: false });
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // ---------- actions ----------
  function save() {
    el.canvas.toBlob(function (blob) {
      var name = "gutsdecor-" + st.sword.slug + "-on-my-wall.jpg";
      var file = typeof File === "function" ? new File([blob], name, { type: "image/jpeg" }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: "Guts Decor" }).catch(function () {});
      } else {
        var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      }
      GD.track && GD.track("tap:wall-save");
    }, "image/jpeg", 0.9);
  }

  function order(e) {
    GD.track && GD.track("tap:wall-order");
    var here = (new URLSearchParams(location.search).get("id") || "") === st.sword.id;
    if (here && document.getElementById("pp-add")) {
      e.preventDefault(); close();
      document.getElementById("pp-add").scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  GD.onContent(function (c) {
    content = c;
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-wall]");
      if (b) { e.preventDefault(); open(); }
    });
  });
})();
