# Guts Decor — Design Guide (source of truth for the LOOK)

Two reference files come with this guide:
- `home.html`: the approved Home page design (phone width, 390 px).
- `menu.html`: the approved full-screen menu.

Open them in a browser to see the approved look. **They set the look only.** Words, prices and offers come from the Claude Code brief and the Website Content sheet (Text tab). When a word in a reference file differs from the sheet, the sheet wins.

Inspired by: MDS Collective (full-screen video hero, minimal header, pill tags, flow diagram), Flatline (giant headline with video behind it), Hermès (2-column product grid, swipeable category cards, italic serif headlines, cream sections).

---

## 1. Colours (three only, no neon pink anywhere)

| Role | Hex | Share | Use |
| --- | --- | --- | --- |
| Royal purple | `#1E0B2E` | ~60% | Dark sections, header, footer, menu |
| Ivory | `#F3EDE2` | ~30% | Light sections, and text on purple |
| Gold | `#C9A44C` | ~10% | Main buttons, logo, prices you want noticed, key highlights only |

Allowed tints, made only from those three, nothing else:
- On purple: muted text `#B8AFC2`, soft body text `#D9D2DF`, hairlines `rgba(243,237,226,0.16)`, deeper purple panels `#150820` / `#2A1740` / `#2B1840`.
- On ivory: dark text `#1E0B2E`, muted text `#5E5466`, body text `#3D3345`, hairlines `rgba(30,11,46,0.16)`, photo backgrounds `#E6DFD2`, cards `#F8F4EC`.

Rules:
- Sections alternate purple → ivory → purple. Never two ivory sections with no purple between, unless it's one continuous story.
- Gold is never a background for a whole section. It's used on buttons, one highlighted step, the logo ring, the "Most chosen" or "Best seller" tags, and thin lines.
- Never put gold text on ivory for body copy (contrast is too low). Gold text only on purple.

## 2. Fonts (Google Fonts)

| Font | Use |
| --- | --- |
| Cinzel | Logo wordmark "GUTS DECOR" and the GD mark only |
| Cormorant Garamond (400, 500, italic) | All headlines, big numbers, menu links, flow-circle titles |
| Montserrat (400, 500, 600) | Body text, buttons, labels, forms |
| Amiri | Arabic headlines and the Arabic tagline |
| Cairo | Arabic body text, buttons, forms |

Type style:
- Headlines are large and light (weight 400), with italic for the second half of a phrase. Example: "Simple and safe. *You see it first.*" The italic part is in the muted colour.
- Stepped headlines on hero-style sections: each line indented differently, like the "Handmade swords, made for one person only." block.
- Small labels above headlines: Montserrat, 11 px, UPPERCASE, letter-spacing 0.28em, muted colour.
- Buttons: Montserrat 12 px, 600, UPPERCASE, letter-spacing 0.24em.
- Body: Montserrat 15 px, line-height 1.65 to 1.7, max width about 520 px.

## 3. Components (copy them from home.html and menu.html)

- **Header:** GD circle and "GUTS DECOR" on the left, "MENU" with two lines on the right. Transparent over the hero, purple elsewhere. No row of links.
- **Menu:** full-screen purple, numbered serif links (01 to 08), "Gifts" in gold italic, a gold "Start your order" button at the bottom, EN / عربي switch and Instagram. No WhatsApp until there's a store number in Settings.
- **Primary button:** gold background, purple text, square corners, min height 54 px.
- **Secondary link:** underlined text, uppercase, spaced.
- **Pill tags:** 1 px border, fully rounded, min height 44 px, uppercase 11 px. The selected or recommended pill gets a gold border and gold text.
- **Product card (Hermès grid):** two columns on phones, 3 px gap, photo on a plain `#E6DFD2` background, then name, then price, then one benefit line. No borders, no shadows. Tags like "Best seller" sit small in the top corner.
- **Category cards:** swipeable row, tall 3:4 photos, a white label box at the bottom of each, center snap, and a thin progress bar under the row.
- **Flow (how ordering works):** circles joined by dashed gold lines, the guarantee as a gold pill, and the "You approve" step as a filled gold circle.
- **Numbered list (guarantees):** 01, 02, 03 with hairline dividers, a serif title and a body line.
- **Rounded photo card:** 22 px radius, used once or twice per page, never on product cards.
- **Big number:** "150+" in gold Cormorant with a small uppercase label beside it.
- **Footer:** logo, Instagram, Privacy, Terms, Refunds, and "Handmade in Cairo, Egypt".

Spacing: section padding about 88 to 96 px top and bottom on phones, 20 to 24 px sides. Plenty of empty space, which is what makes it look expensive. Touch targets are at least 44 px.

No: gradients, drop shadows, emoji, rounded-pill main buttons, neon colours, stock icons in colour, busy patterns.

## 4. How the other pages should look

Every page uses the same header, menu, footer, colours and fonts. Each one starts with a short purple intro (label, stepped serif headline, one line of body), then alternates sections.

| Page | Layout |
| --- | --- |
| Swords (tiers) | Purple intro, then three tier blocks on ivory: photo, tier name in serif, price, "Who it's for", three feature → "you'll…" lines. Premium has a gold "Most chosen" tag. Collector's shows the big-plaque upgrade line under it. |
| Ready designs | Ivory page with the Hermès 2-column grid. The Zoro set is the first card, full width, with its offer (three swords, mount, carved name, free shipping, "You save 1,400 LE"). Dragon Slayer has a "Best seller" tag. |
| Display pieces | Purple intro "Make it a centrepiece", then the 2-column grid of mounts, stands and plaques, each with the free carved-name bonus as a small gold line. |
| Gifts | Ivory. The occasion-date question comes first (big serif question and a date box), then the Zoro set, then the gift-friendly swords, then "What's in the box" as a numbered list. |
| Commissions | Purple, darkest page. Large rounded photo cards of showpieces (Frostmourne pedestal, plaques), no prices, then the request form on ivory with the budget question. A low budget shows "For that budget, these swords are a perfect fit" with matching cards. |
| Gallery & reviews | Ivory. The reviews reel at the top, then a 2-column photo grid with one-line captions. |
| How to order | Purple, with the same flow diagram as Home, then the hold option, the 30-day rule and the guarantees list on ivory. |
| About me | Purple, with the maker story aimed at the customer, a real workshop photo in a rounded card, and the "150+" number. |
| Order form | Ivory, one short step per screen (four steps), with a thin gold progress bar at the top. Fields have visible labels above them, 1 px purple-tint borders and square corners. A live total sits in a purple bar at the bottom: "You pay 50% now: X LE". The payment step shows InstaPay details in a purple panel with gold numbers, "Check the name shows ماير", the payment video, the screenshot upload and the full-refund line. |
| Thank-you | Purple, with a big serif "Thank you", the thank-you video in a rounded card, the order summary on ivory, then the "what happens next" flow with dates. |
| Payment upload | Same style as the payment step of the form. |
| Privacy, Terms, Refunds | Ivory, with a narrow text column (max 640 px), a serif title, a small uppercase date label and Montserrat body. No decoration. |

Arabic: the same layouts, mirrored right to left. Amiri replaces Cormorant, and Cairo replaces Montserrat. Never mix the English fonts into Arabic text.

## 5. Placeholders in the reference files

The sword drawings in the photo boxes are placeholders. Use the real photos and videos from the Website Content sheet (Gallery and Videos tabs). Where one is missing, keep a plain purple or `#E6DFD2` box with a small uppercase label, like the reference.
