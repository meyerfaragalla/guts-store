#!/usr/bin/env python3
"""Guts Decor: makes the site readable by Google and AI tools, without changing what customers see.

The pages fill themselves from the sheet with JavaScript, so a crawler that doesn't run JavaScript sees empty pages.
This script runs on GitHub every time the site is published (on every save, and every 15 minutes when the sheet changed).
It copies the site into an output folder and, using assets/content.json (the published sheet data):
  - writes one page per sword, level and display piece (product-<id>.html) with its name, level, price,
    description, photos and links already in the HTML, plus Product data (JSON-LD) and a share preview (Open Graph);
  - puts the catalog (every sword, the levels, the display pieces) into the HTML of the catalog pages;
  - sets each page's Google title and description from the Text tab, adds share previews, the Organization data
    and the Search Console code (Settings);
  - writes the current English of the Privacy, Terms and Refund pages (Text tab) into their HTML;
  - rewrites sitemap.xml.
The added text sits in a hidden block (data-static) that the page's JavaScript removes once it has drawn the real page,
so customers see no difference.

Usage: python3 tools/build_static.py SOURCE_DIR OUTPUT_DIR
"""
import datetime
import html
import json
import os
import re
import shutil
import sys

SITE = "https://gutsdecor.com/"
DEFAULT_IMAGE = SITE + "assets/videos/hero-clash.jpg"
LOGO = SITE + "assets/Guts-Decor-Logo.png"
# Never copied into the published site.
SKIP = {".git", ".github", "_site", "node_modules", "demo-3d", "tools", ".claude",
        "CLAUDE.md", "HANDOFF.md", "build-spec.md", "protection-plan.md"}
# Pages listed in the sitemap (pages for one visitor's order, like cart or thanks, are not).
SITEMAP_PAGES = ["", "swords.html", "designs.html", "display.html", "gift.html", "gallery.html", "how.html",
                 "about.html", "shipping.html", "privacy.html", "terms.html", "refund.html"]


def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)


def md_html(s):
    """Same marks as site.js mdHtml: **bold** and [words](page.html or https://...)."""
    s = esc(s)

    def link(m):
        label, href = m.group(1), html.unescape(m.group(2))
        if not re.match(r"^(https://|[\w-]+\.html(#[\w-]*)?$)", href):
            return m.group(0)
        ext = ' target="_blank" rel="noopener"' if href.startswith("https://") else ""
        return '<a href="%s"%s>%s</a>' % (esc(href), ext, label)
    s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link, s)
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)


def fill_md(page, site):
    """Privacy, Terms, Refund: put the sheet's current English into the page, so Google reads what customers read."""
    def one(m):
        words = site.t(m.group(3))
        return m.group(1) + (md_html(words) if words else m.group(4)) + m.group(5)
    return re.sub(r'(<(h1|h2|p|li)\b[^>]*\bdata-t-md="([^"]+)"[^>]*>)(.*?)(</\2>)', one, page, flags=re.S)


def slug(s):
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(s or "").lower()))


def image_url(link, width=1200):
    """Same rules as GD.driveImage in site.js: a Drive share link becomes an image address."""
    link = (re.split(r"[\s,]+", str(link or "").strip()) or [""])[0]
    if not link:
        return ""
    m = re.search(r"/d/([\w-]{20,})", link) or re.search(r"[?&]id=([\w-]{20,})", link)
    if m:
        return "https://drive.google.com/thumbnail?id=%s&sz=w%d" % (m.group(1), width)
    if link.startswith("https://"):
        return link
    if re.match(r"^[\w\-/]+\.(jpe?g|png|webp)$", link, re.I):
        return SITE + link.lstrip("/")
    return ""


def images(cell, width=1200):
    return [u for u in (image_url(x, width) for x in re.split(r"[\s,]+", str(cell or "")) if x) if u]


def money(n):
    return "{:,} LE".format(int(n)) if isinstance(n, (int, float)) else ""


class Site:
    def __init__(self, data):
        self.d = data
        self.text = data.get("text", {})
        self.s = data.get("settings", {})

    def t(self, key, **kw):
        row = self.text.get(key) or {}
        s = row.get("en") or row.get("ar") or ""
        return re.sub(r"\{(\w+)\}", lambda m: str(kw.get(m.group(1), m.group(0))), s)

    def ig(self):
        return "https://www.instagram.com/%s/" % (self.s.get("instagram") or "guts.decor").lstrip("@")

    def products(self):
        """Every piece with its own product page (same list as GD.shop.products in shop.js)."""
        out = []
        for d in self.d.get("designs", []):
            out.append({"id": "d-" + slug(d["name"]), "type": "design", "d": d})
        for t in self.d.get("tiers", []):
            if t.get("price"):
                out.append({"id": "t-" + slug(t["name"]), "type": "tier", "d": t})
        for a in self.d.get("addons", []):
            if isinstance(a.get("price"), (int, float)):
                out.append({"id": "a-" + slug(a["name"]), "type": "addon", "d": a})
        return out

    @staticmethod
    def url(p):
        return "product-%s.html" % p["id"]

    def level_of(self, p):
        d = p["d"]
        if p["type"] == "tier":
            return d["name"]
        if p["type"] == "design":
            if d.get("classicPrice"):
                return "Classic or Premium"
            return d.get("level") or ""
        return ""

    def describe(self, p):
        d = p["d"]
        if p["type"] == "tier":
            return d.get("descEn") or d.get("forEn") or ""
        return d.get("benefitEn") or d.get("bonusEn") or ""

    def price_text(self, p):
        d = p["d"]
        if p["type"] == "design" and d.get("classicPrice") and d.get("price"):
            return "From %s (Classic), %s (Premium)" % (money(d["classicPrice"]), money(d["price"]))
        return money(d.get("price"))

    def product_ld(self, p):
        d = p["d"]
        ld = {"@context": "https://schema.org", "@type": "Product", "name": d["name"],
              "brand": {"@type": "Brand", "name": "Guts Decor"}, "url": SITE + self.url(p)}
        imgs = images(d.get("photo"))
        if imgs:
            ld["image"] = imgs[:6]
        desc = self.describe(p)
        if desc:
            ld["description"] = desc
        if p["type"] == "design" and d.get("inspiredBy"):
            ld["category"] = "Handmade wooden display sword, inspired by " + d["inspiredBy"]
        price = d.get("price")
        if isinstance(price, (int, float)) and price:
            offer = {"priceCurrency": "EGP", "availability": "https://schema.org/MadeToOrder",
                     "url": SITE + self.url(p), "seller": {"@type": "Organization", "name": "Guts Decor"}}
            if p["type"] == "design" and d.get("classicPrice"):
                offer.update({"@type": "AggregateOffer", "lowPrice": d["classicPrice"], "highPrice": price, "offerCount": 2})
            else:
                offer.update({"@type": "Offer", "price": price})
            ld["offers"] = offer
        return ld

    def org_ld(self):
        return {"@context": "https://schema.org", "@type": "Organization", "name": "Guts Decor", "url": SITE, "logo": LOGO,
                "description": "Handmade, real-size wooden display swords, designed and built by hand in Cairo, Egypt.",
                "address": {"@type": "PostalAddress", "addressLocality": "Cairo", "addressCountry": "EG"},
                "areaServed": "EG", "sameAs": [self.ig()]}

    # ---------- the hidden plain-HTML copies ----------
    def product_block(self, p):
        d = p["d"]
        lines = ['<div class="sr-only" data-static>', "<h1>%s</h1>" % esc(d["name"])]
        if p["type"] == "design" and d.get("inspiredBy"):
            lines.append("<p>Inspired by %s.</p>" % esc(d["inspiredBy"]))
        lv = self.level_of(p)
        if lv:
            lines.append("<p>Level: %s</p>" % esc(lv))
        if self.price_text(p):
            lines.append("<p>Price: %s</p>" % esc(self.price_text(p)))
        if p["type"] == "design" and d.get("sizes"):
            lines.append("<p>Size: %s</p>" % esc(d["sizes"]))
        if self.describe(p):
            lines.append("<p>%s</p>" % esc(self.describe(p)))
        for f in d.get("features", []) or []:
            if f.get("en"):
                lines.append("<p>%s</p>" % esc(f["en"]))
        for i, u in enumerate(images(d.get("photo"))[:6]):
            lines.append('<img src="%s" alt="%s, photo %d" loading="lazy">' % (esc(u), esc(d["name"]), i + 1))
        lines.append("<p>%s</p>" % esc(self.t("ship.short.title") or "How ordering works"))
        lines.append("<p>Pay a 50% deposit to start. You get photos of your finished sword before you pay the rest. Delivery anywhere in Egypt.</p>")
        lines.append('<p><a href="designs.html">All swords</a> · <a href="swords.html">Levels</a> · <a href="shipping.html">Shipping &amp; returns</a> · <a href="about.html">About the maker</a></p>')
        lines.append("</div>")
        return "\n".join(lines)

    def card(self, p):
        d = p["d"]
        bits = [esc(d["name"])]
        if p["type"] == "design" and d.get("inspiredBy"):
            bits.append("inspired by " + esc(d["inspiredBy"]))
        lv = self.level_of(p)
        if lv:
            bits.append(esc(lv))
        if self.price_text(p):
            bits.append(esc(self.price_text(p)))
        return '<li><a href="%s">%s</a>%s</li>' % (self.url(p), bits[0], (": " + ", ".join(bits[1:])) if len(bits) > 1 else "")

    def list_block(self, title, items):
        if not items:
            return ""
        return '<div class="sr-only" data-static><h2>%s</h2><ul>%s</ul></div>' % (esc(title), "".join(self.card(p) for p in items))

    def item_list_ld(self, items):
        return {"@context": "https://schema.org", "@type": "ItemList",
                "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": SITE + self.url(p), "name": p["d"]["name"]}
                                    for i, p in enumerate(items)]}


def ld_tag(obj):
    return '<script type="application/ld+json">%s</script>' % json.dumps(obj, ensure_ascii=False).replace("</", "<\\/")


def set_head(page, title=None, desc=None, canonical=None, image=None, extra=""):
    """Sets the title and description, and adds share-preview tags and anything extra just before </head>."""
    if title:
        page = re.sub(r"<title>.*?</title>", "<title>%s</title>" % esc(title), page, count=1, flags=re.S)
    if desc:
        if re.search(r'<meta name="description"', page):
            page = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="%s">' % esc(desc), page, count=1)
        else:
            page = page.replace("</title>", '</title>\n<meta name="description" content="%s">' % esc(desc), 1)
    if canonical:
        if re.search(r'<link rel="canonical"', page):
            page = re.sub(r'<link rel="canonical" href="[^"]*">', '<link rel="canonical" href="%s">' % esc(canonical), page, count=1)
        else:
            page = page.replace("</title>", '</title>\n<link rel="canonical" href="%s">' % esc(canonical), 1)
    t = re.search(r"<title>(.*?)</title>", page, re.S)
    t = html.unescape(t.group(1)) if t else "Guts Decor"
    m = re.search(r'<meta name="description" content="([^"]*)">', page)
    dsc = html.unescape(m.group(1)) if m else ""
    c = re.search(r'<link rel="canonical" href="([^"]*)">', page)
    og = [
        '<meta property="og:site_name" content="Guts Decor">',
        '<meta property="og:type" content="%s">' % ("product" if image and canonical and "product-" in canonical else "website"),
        '<meta property="og:title" content="%s">' % esc(t),
        '<meta property="og:description" content="%s">' % esc(dsc),
        '<meta property="og:image" content="%s">' % esc(image or DEFAULT_IMAGE),
        '<meta property="og:locale" content="en_US">', '<meta property="og:locale:alternate" content="ar_EG">',
        '<meta name="twitter:card" content="summary_large_image">',
    ]
    if c:
        og.append('<meta property="og:url" content="%s">' % esc(html.unescape(c.group(1))))
    page = re.sub(r'\s*<meta (property="og:|name="twitter:)[^>]*>', "", page)
    return page.replace("</head>", "\n".join(og) + ("\n" + extra if extra else "") + "\n</head>", 1)


def after_main(page, block):
    return re.sub(r'(<main id="main"[^>]*>)', lambda m: m.group(1) + "\n" + block, page, count=1) if block else page


def build(src, out):
    if os.path.abspath(out) == os.path.abspath(src):
        raise SystemExit("Output folder must be different from the source folder.")
    if os.path.exists(out):
        shutil.rmtree(out)
    shutil.copytree(src, out, ignore=lambda d, names: [n for n in names if n in SKIP or n.startswith("product-d-")
                                                       or n.startswith("product-t-") or n.startswith("product-a-")])
    data_file = os.path.join(src, "assets", "content.json")
    if not os.path.exists(data_file):
        # The sheet didn't answer this time: publish the site as it is (pages still fill themselves for customers).
        print("No assets/content.json (the sheet didn't answer): published without the Google pages this time.")
        return
    with open(data_file, encoding="utf-8") as f:
        site = Site(json.load(f))

    sc = site.s.get("searchConsole") or ""
    verify = '<meta name="google-site-verification" content="%s">' % esc(sc) if sc else ""
    products = site.products()
    designs = [p for p in products if p["type"] == "design"]
    tiers = [p for p in products if p["type"] == "tier"]
    addons = [p for p in products if p["type"] == "addon"]

    # 1. Every ordinary page: Google title + description from the Text tab, share preview, Search Console code.
    for name in sorted(os.listdir(out)):
        if not name.endswith(".html"):
            continue
        path = os.path.join(out, name)
        with open(path, encoding="utf-8") as f:
            page = f.read()
        tk = re.search(r'data-title-key="([^"]+)"', page)
        dk = re.search(r'data-desc-key="([^"]+)"', page)
        title = site.t(tk.group(1)) if tk else None
        desc = site.t(dk.group(1)) if dk else None
        extra = [verify] if verify else []
        block = ""
        if name == "index.html":
            extra.append(ld_tag(site.org_ld()))
            home = [p for p in designs if p["d"].get("showOnHome") is not False][:8]
            block = site.list_block("Handmade wooden swords", home) + site.list_block("Levels", tiers)
        elif name == "designs.html":
            extra.append(ld_tag(site.item_list_ld(designs)))
            block = site.list_block("Every sword", designs)
        elif name == "swords.html":
            block = site.list_block("Levels", tiers) + site.list_block("Swords", designs)
        elif name == "display.html":
            extra.append(ld_tag(site.item_list_ld(addons)))
            block = site.list_block("Display pieces", addons)
        elif name == "about.html":
            extra.append(ld_tag(site.org_ld()))
        if "data-t-md=" in page:
            page = fill_md(page, site)
        page = set_head(page, title or None, desc or None, extra="\n".join(e for e in extra if e))
        page = after_main(page, block)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(page)

    # 2. One page per piece, made from product.html.
    with open(os.path.join(src, "product.html"), encoding="utf-8") as f:
        template = f.read()
    for p in products:
        d = p["d"]
        page = template.replace('<body data-page="product">', '<body data-page="product" data-product="%s">' % esc(p["id"]), 1)
        title = (site.t("pp.title", name=d["name"]) or d["name"]) + ("" if "Guts Decor" in (site.t("pp.title") or "") else " | Guts Decor")
        desc_bits = [d["name"]]
        if p["type"] == "design" and d.get("inspiredBy"):
            desc_bits.append("inspired by " + d["inspiredBy"])
        desc = ", ".join(desc_bits) + ". " + (site.describe(p) or "Handmade in Cairo.") + (" " + site.price_text(p) + "." if site.price_text(p) else "")
        imgs = images(d.get("photo"))
        extra = [ld_tag(site.product_ld(p))]
        if verify:
            extra.append(verify)
        page = set_head(page, title, desc[:300], SITE + site.url(p), imgs[0] if imgs else None, "\n".join(extra))
        page = re.sub(r'<meta name="robots" content="noindex">\n?', "", page)
        page = after_main(page, site.product_block(p))
        with open(os.path.join(out, site.url(p)), "w", encoding="utf-8", newline="\n") as f:
            f.write(page)

    # 3. sitemap.xml
    today = datetime.date.today().isoformat()
    urls = [SITE + u for u in SITEMAP_PAGES] + [SITE + site.url(p) for p in products]
    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    xml += ["  <url><loc>%s</loc><lastmod>%s</lastmod></url>" % (esc(u), today) for u in urls]
    xml.append("</urlset>")
    with open(os.path.join(out, "sitemap.xml"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(xml) + "\n")
    print("Built %d product pages and a sitemap with %d addresses." % (len(products), len(urls)))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    build(sys.argv[1], sys.argv[2])
