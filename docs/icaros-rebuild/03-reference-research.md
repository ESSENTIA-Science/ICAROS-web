# 03 — Reference Research / Art Direction

Research for the icaros.kr full redesign. Primary north star: **Vast Space**. Secondary: **Anime.js** (micro-interaction vocabulary only). Component reference: **Hanwha Ocean 3D Virtual Showroom**.

## Method & confidence key

Vast is a Webflow + WebGL site, so `WebFetch` returned only thin prose. Instead I pulled the raw HTML and the actual production CSS/JS bundles with `curl` and read them directly. **Almost everything below is measured from shipped source, not guessed.** Where I could not verify something (runtime camera behavior, visual rendering, motion timing as experienced), I say so.

| Tag | Meaning |
|---|---|
| `[fetched]` | Read directly out of the site's shipped HTML / CSS / JS |
| `[secondary source]` | From a third-party write-up (Awwwards, foundry pages, docs) |
| `[inference]` | My reading of the evidence — not directly stated |
| `[UNVERIFIED]` | Could not confirm; do not build on this without checking |

### Sources actually retrieved

| Source | What I got |
|---|---|
| `vastspace.com/` (+ `/haven-1`, `/haven-1-3d-tour`, `/updates`, `/team`) | Full raw HTML, 5 pages |
| `cdn.prod.website-files.com/…/antinomy-vast.webflow.shared.822bf6a63.css` | 210 KB design-system CSS — **all tokens, type scale, components** |
| `dcwvv9x5kjsk9.cloudfront.net/index.css` | 49 KB hand-written CSS — callouts, Tailwind layer |
| `dcwvv9x5kjsk9.cloudfront.net/index.js` | 1.5 MB app bundle — libs, ScrollTrigger configs, asset manifest |
| Inline `<style>` blocks in the Vast HTML | The motion + layout token declarations |
| `awwwards.com/sites/vast` | Studio credit, scores, stated palette |
| `animejs.com/` | v4 API examples + per-module bundle sizes |
| `hanwhaocean.com/en/whatwedo/3dsubm/` + `/js/pages/hanwha-ocean.js` (515 KB) | Full markup + the camera-framing source |

**What I could NOT verify** is listed in a dedicated section at the end. Read it.

---

## Part 1 — Vast Space (primary reference)

### 0. What it actually is, technically

`[fetched]` `[secondary source]`

- Built on **Webflow**, with a separate hand-written bundle (`index.js` / `index.css`) served from CloudFront. The Webflow CSS file is literally named `antinomy-vast.webflow.shared.css`.
- Studio: **Antinomy Studio**. Awwwards **Site of the Day (2026-04-01)**, overall 7.65 — Design 7.73, Usability 7.61, Creativity 7.41, Content 7.92; Development 7.37 (Accessibility 7.00 is the weakest sub-score). `[secondary source]`
- Libraries counted in the bundle: **GSAP + ScrollTrigger**, **Lenis**, **Barba.js**, **Three.js** (with DRACO, KTX2 and meshopt decoders), **@react-three/fiber + drei**, plus a Tailwind utility layer (`--tw-*` variables present). `[fetched]`
- Awwwards lists the tech as "WebGL, Three.js, Webflow" and the palette as exactly two colors: `#2A2C2F` and `#FF5623`. `[secondary source]` — both confirmed in the CSS. `[fetched]`

**Takeaway for ICAROS:** the "expensive" feel is not coming from an exotic stack. It is a CMS page with a React/Three island and about 200 lines of genuinely good token CSS. That is reproducible in a Vite React SPA.

---

### 1. Structure — how one 3D model threads the sections together

This is the single most important finding.

`[fetched]` There is **one** WebGL canvas for the entire site:

```css
.webgl { pointer-events: none; display: block; position: fixed; inset: 0%; }
.webgl { z-index: 1000; }   /* from the inline token block */
```

```html
<div id="webgl" data-react-component="canvas" class="webgl"></div>
```

`[fetched]` That node is present on **every page I fetched** — home, haven-1, 3d-tour, team, and updates — even the two pages with no 3D content at all. Every page is also wrapped in `data-barba="wrapper"` / `data-barba="container"` with namespaces `home`, `haven-1`, `who-we-are`, `updates`.

`[inference]` So the canvas is mounted once, sits fixed above the document, and **survives Barba page transitions**. The 3D scene is not per-page; it is a persistent layer the pages hand work to.

`[fetched]` Sections declare *where* the model should appear by placing an empty, absolutely-positioned placeholder:

```css
.webgl-home-space-station     { pointer-events: none; position: absolute; inset: 0%; }
.webgl-station-callouts       { position: absolute; inset: 0%; display: block; }
.webgl-roadmap-timeline-station { position: absolute; inset: 0%; }
```

```html
<div class="webgl-home-space-station"
     data-react-component="webgl-haven-1-dragon"
     data-props="…"></div>
```

`[fetched]` And each placeholder region carries a static fallback via `data-webgl-fb="webgl-haven-1"` / `"webgl-haven-1-dragon"`.

`[inference]` The contract is: **HTML/CSS owns layout; the canvas reads placeholder rects and renders into them.** Content is authored declaratively in the DOM (see §6 for the callout data attributes) and consumed by the React island.

> **This is the pattern to steal.** Hanwha arrives at the identical solution independently (§Part 3) — different agency, different country, different stack, same architecture. Two-for-two convergence is about as strong a signal as reference research gets.

Note the z-order consequence: at `z-index: 1000` with `pointer-events: none`, **the model renders *over* the page content**, not behind it. Text that must sit on top of the model needs a higher stacking context. The full stack, all `[fetched]`:

| Layer | z-index |
|---|---|
| WebGL canvas | 1000 |
| Scroll rail (`.gsap-scroll`) | 1500 |
| Nav (`.nav`, `position: fixed; inset: 0 0 auto`) | 3001 |
| Loader | 50000 |

#### Page-by-page section order `[fetched]`

**Home**
1. `header-home` — dark hero (`background: var(--color--primary--meteorite-black)`), `min-height: calc(100 * var(--vh))`, content **bottom-aligned** (`align-items: flex-end`) with `padding-top: 20rem`. Contains `.webgl-masking` wrapping a `<video loop muted playsinline>` and a `.section-bg` with `data-parallax="0.2"`. H1 (`.h-xxl.header-home-h1`) = "Building next-generation space infrastructure", white, on a `max-width: 67rem` column, with a controls row bottom-right.
2. `highlight-text` — `data-section-theme="moonrock"`, `data-highlight="section"`, `data-crosshair="Inherit"`. The scroll-revealed mission statement (mechanism in §3).
3. `video-section` — `data-section-theme="warm-white"`, `data-section-autoplay`. Haven Demo.
4. Spec rail — `.slider-nav__eyebrow` + `.eyebrow` / `.eyebrow.is--mirror` pairs: `HAVEN-1 · Launching 2027 · crew: 4 · height: 10.1 m · HABITABLE VOLUME: 45 m³ · PRESSURIZED VOLUME: 80 m³ · mass: 14,600 kg · Power: 13,200 w · orbit: 51.6°, 425 km`.
5. `.webgl-home-space-station` — the model, with the spec rail wrapping it.
6. `slider-section` — `data-drag="section"`, a draggable horizontal strip of ~30 dated hardware-progress cards (each = eyebrow title + one paragraph + one photo).
7. `updates-section`
8. `press-section` + `press-section__marquee`
9. `footer-newsletter` → `footer-main`

**Haven-1** (order via WebFetch prose, confirmed against markup) `[fetched]` — hero → feature list → spec table → hardware-progress slider → missions (`roadmap-timeline` React island) → Haven-1 Lab → SpaceX partnership → resources. Carries three React islands: `webgl-haven-1-callouts`, `360-image-viewer`, `roadmap-timeline`.

**Haven-1 3D tour** `[fetched]` — the whole page is: nav, the persistent spec eyebrow rail (`HAVEN-1 · Launching 2026 · crew · Diameter · height · HABITABLE VOLUME · PRESSURIZED VOLUME · mass · Power · orbit` + values), and the canvas. **No footer, no marketing sections, no other content.** The showroom strips all page chrome down to nav + spec rail + model.

**Team** `[fetched]` — `header-home` (dark) → `highlight-text` (statement) → `team-experience-section` (`warm-gray`, `data-drag="section"`, contains the giant stat numbers) → `team-grid-section` → footer.

**Updates** `[fetched]` — `hero-section` (`data-section-theme="white"`) → `updates-overview` → `press-overview` → footer.

---

### 2. Scroll choreography — scrub or snap?

**Neither, mostly.** This is a genuinely useful and slightly surprising result.

`[fetched]`, from grepping the 1.5 MB bundle:

- `scrub: true` appears **3 times**. `scrub: 0` twice.
- **`pin:` appears zero times.** No ScrollTrigger pinning anywhere.
- No page-level scroll snapping. Every `snap` hit is GSAP `Draggable` slider snapping (`snap: { x: … }`), not scroll.
- The dominant pattern is one-shot triggers at viewport thresholds: `start: "top 80%"`, `"top 70%"`, `"top 65%"`, `"top 60%"`, `"top center"`, `"top bottom"`, `"top top"`; ends `"bottom top"`, `"bottom 65%"`, `"+=100%"`.
- Lenis is configured near defaults — `lerp: 0.1`, `smoothWheel: true`, **`syncTouch: false`**, `wheelMultiplier: 1`, `touchMultiplier: 1`.

`[inference]` The reading:

1. **Smooth scroll is wheel-only.** `syncTouch: false` means touch devices get native OS scrolling. Nothing is hijacked on mobile.
2. **Nothing is pinned.** Sections scroll past at true document speed. The site never traps you.
3. **Almost everything is a one-shot reveal** fired when an element crosses roughly 60–80% of the viewport — enter, play once, done.
4. Only three timelines are scrubbed. `[UNVERIFIED]` — I could not determine from the minified bundle *which* three, or whether the homepage station model's camera is one of them.

`[fetched]` A fixed scroll-progress rail exists:

```css
.gsap-scroll { position: fixed; z-index: 1500; top: 0; right: 0; bottom: 0; width: 4rem; }
.gsap-scroll-item:not(.gsap-active) { transition: transform calc(0.7s * var(--motion)) var(--motion-ease-spring); }
.gsap-scroll-bg { transition: opacity calc(0.4s * var(--motion)) var(--motion-ease-vast); }
```

A 40px-wide rail down the right edge; items spring into place with a `linear()` spring curve. `[UNVERIFIED]` — I did not confirm what it looks like rendered (section-marker ticks vs. a continuous bar).

`[fetched]` Header state is driven by scroll via data attributes on `<body>`: `data-scrolling="down"`, `data-scrolling-started="false"`, `data-scrolling-header="false"`, plus `data-header-theme="light" | "dark"` and per-section `data-scroll="dark"`. `[inference]` The nav inverts its color as light/dark sections pass under it, and hides/shows on scroll direction.

> **Decision for ICAROS: do not pin, do not snap, do not hijack.** The reference we are chasing doesn't. Everything can be an `IntersectionObserver` reveal at `rootMargin: "0px 0px -30% 0px"` — no scroll library needed for 95% of it.

---

### 3. Typography

#### The families `[fetched]` `[secondary source]`

| Role | Family | Foundry |
|---|---|---|
| Display / all headings | **Owners** | MCKL Type (Jeremy Mickel) |
| Body / paragraphs | **Owners Text** | MCKL Type |
| Eyebrows, labels, technical | **Phonic Monospaced** | Schick Toikka |
| Large statistics only | **Vast Numbers** (bespoke) | custom |

`[secondary source]` Owners is a geometric sans drawn from Los Angeles hand-painted signage, shipping in **7 widths** and set tight for headline impact, with a separate `Owners Text` optical cut for small sizes. Phonic is described by its foundry as a family of "technical precision"; **Phonic Mono** embraces fixed widths "emphasizing the allure of the technical."

`[fetched]` Only **five weight files** ship for the whole site:
`Owners-Medium`, `OwnersText-Regular`, `OwnersText-Medium`, `OwnersText-Italic`, `OwnersText-MediumItalic`, plus `Phonic-MonospacedRegular` and `vast-numbers`.

**Every single heading on the site is `font-weight: 500`.** There is no Bold. That is the discipline: scale and width carry the hierarchy, weight does not.

Phonic is used at `font-weight: 702` in the callout titles — a variable-font axis value, not a static weight. `[fetched]`

#### The scale `[fetched]`

Root is `10px`, so `1rem = 10px`. All values verbatim from the shipped CSS.

| Class | Desktop | Tablet (≤991) | Mobile (≤767/479) | line-height | tracking |
|---|---|---|---|---|---|
| `.h-display` | **21rem** (210px) | 12rem | **6.4rem** | — | — |
| `h1` | 14.4rem | — | — | .86 | — |
| `.h-xxl` | 7.6rem | — | 6.4rem | .86 → .88 | — |
| `.h-xl` | 7.6rem | — | 4.8rem | .96 → .92 | — |
| `.h-l` | 6.4rem | — | 4rem | 1 → .96 | — |
| `.h-ml` | 4.8rem | — | 3.2rem | 1 → .96 | .01em |
| `.h-m` | 4rem | — | 2.8rem | 1 | .01em → .03em |
| `.h-xs` | 2rem | — | 1.8rem | 1.12 | .03em → .04em |
| `.h-s` | 1.9rem | — | 2rem | 1.04 → 1.08 | .03em |
| `.eyebrow` | 1.2rem | — | 1.2rem | 1 → 1.3 | .01em → .02em |
| `.p-l` | 1.8rem | | | 1.32 | |
| `.p-m` | 1.6rem | | | 1.36 | |
| `.p-s` | 1.2rem | | | 1.4 | |
| `body` | 1.4rem | | | 20px | |

Three rules fall out of this table, and all three are worth copying:

1. **Display type collapses on mobile; body type does not.** 210px → 64px is a **3.3× reduction** on the display size, while `.p-m` never changes. The contrast between huge and small is a desktop luxury; on mobile the page becomes almost entirely small technical text.
2. **Line-height tightens as size grows.** `.86` at display, `1.36` at body. Nothing above 40px is set looser than 1.0.
3. **Tracking increases as size decreases.** `.01em` at 48px → `.03em` at 19px → `.04em` on 18px mobile. Optical compensation, applied consistently.

#### The eyebrow — the whole "technical" register in one class `[fetched]`

```css
.eyebrow {
  font-family: Phonic, sans-serif;
  font-size: 1.2rem;
  font-weight: 400;
  line-height: 1;
  letter-spacing: .01em;
  text-transform: uppercase;
  word-break: normal;
  max-width: none;
}
```

12px uppercase mono. That single class is doing most of the work of making the site read as engineering rather than marketing. Everything else is one display face at one weight.

#### The big-number treatment `[fetched]`

```css
.team-numbers__large {
  font-family: "Vast Numbers", Arial, sans-serif;
  font-size: 25rem;          /* 18rem tablet, 8.75rem mobile */
  font-weight: 400;
  letter-spacing: -.06em;
  height: .75em;
  margin-top: -.05em;
  padding-right: .1em;
}
.team-numbers-el { font-variant-numeric: tabular-nums; font-size: 1em; line-height: 1; }
```

250px numerals, **negative tracking (-.06em)**, `tabular-nums`, and a manual optical trim (`height: .75em; margin-top: -.05em`) so the digits sit on the cap line rather than the em box. Paired with `data-number-count` and `data-number-el="N"` in the markup — N = number of digit slots. `[inference]` Each digit is its own element in an odometer-style rolling counter.

#### Recommendation for ICAROS

You already own the two-family half of this: **`WdscnUEx` plays the Owners Wide role, `Pretendard` plays the Owners Text role.** What you are **missing is the Phonic role** — and it is the one carrying the technical register.

- Add **one monospace** for eyebrows, spec labels, spec values, dates, and figure captions. Free/self-hostable candidates, in preference order: **IBM Plex Mono** (most "engineering", has a matching Sans if you ever need it), **JetBrains Mono** (widest weight range), **Geist Mono** (most neutral, closest in feel to Pretendard's Inter lineage). All OFL, all self-hostable, all ~15–25 KB per weight as subset WOFF2.
- Ship **one weight of the mono** (Regular). Following Vast, do not add a Bold.
- **`WdscnUEx` at one weight only.** You currently `@font-face` **nine** TTF weights of a *trial* font — 900 KB of unsubset TTF. Pick one (`Md` 500 or `SBd` 600), convert to WOFF2, subset to Latin + digits + punctuation. Also: it is `WidescreenUEx_Trial_*` — **confirm the licence before shipping.**
- **Korean tracking rule:** the "increase tracking as size decreases" rule and the `.eyebrow` uppercase tracking are **Latin-only**. Hangul breaks visually above about `+0.02em`, and `text-transform: uppercase` is a no-op on it. Korean eyebrows should be Pretendard 500 at `letter-spacing: 0`; the mono uppercase treatment is for the English section labels only. This actually reinforces the brief's "Korean body copy, English section headings" split — give them visibly different type roles.
- Use `font-variant-numeric: tabular-nums` on every spec value and date. Pretendard is Inter-derived so `tnum` should be present — `[UNVERIFIED]`, worth a 60-second check before you rely on it.

---

### 4. Color

`[fetched]` — the complete declared palette, verbatim:

```css
--color--primary--white:           white;
--color--primary--warm-white:      #fdfcf4;
--color--primary--warm-gray:       #ece8e3;
--color--primary--moon-rock:       #b3aba3;
--color--secondary--asteroid-dust: #897f75;
--color--primary--meteorite-black: #2a2c2f;
--color--primary--black:           black;
--color--accent--solar-orange:     #ff5623;   /* the only accent */
--color--secondary--green:         #2da046;   /* form success only */
```

Seven neutrals on a single warm axis — a lunar-regolith ramp — and **exactly one signal color**.

#### Where the signal is spent `[fetched]`

Frequency count across the 210 KB design-system CSS: `#ff5623` appears **6 times**. `#fff` appears 37 times. That ratio *is* the art direction.

Every use of solar orange:

| Use | Rule |
|---|---|
| Text selection | `::selection { background: var(--color--accent--solar-orange); color: var(--color--primary--warm-white); }` |
| Page-load progress | `.loader-line-fill { background-color: var(--color--accent--solar-orange); }` |
| Figure caption marker | `figcaption::before { background: var(--color--accent--solar-orange); width: 1em; height: 1em; }` — a **1em solid square** before every caption |
| Timeline progress fill | `.timeline-progress { linear-gradient(180deg, #ff5623, #ff5623 90%, #ff562300); }` |
| Timeline step dot | `.haven-1-lifecycle-timeline-step-progress-dot { width: .6rem; height: .6rem; background: var(--…solar-orange); }` — a **6px square** |
| Nav dropdown icons | `data-icon-color="orange"` (30 occurrences) |
| Utility class | `.text-color-accent` |

**The accent is never used for a heading, a body paragraph, or a large fill.** It is spent exclusively on 1px rules, 6–10px squares, progress fills, and icon strokes — always as a *mark*, never as a *surface*. That restraint is the entire reason the palette reads expensive.

#### Light/dark section switching `[fetched]`

Five themes as a data attribute, applied per `<section>`:

```css
[data-section-theme="white"]      { background: var(--color--primary--white);      color: var(--color--primary--meteorite-black); }
[data-section-theme="warm-white"] { background: var(--color--primary--warm-white); color: var(--color--primary--meteorite-black); }
[data-section-theme="warm-gray"]  { background: var(--color--primary--warm-gray) !important; color: var(--color--primary--meteorite-black) !important; }
[data-section-theme="moonrock"]   { background: var(--color--primary--moon-rock); }
[data-section-theme="meteorite"]  { background: var(--color--primary--meteorite-black); color: var(--color--primary--white); }
```

`[fetched]` Usage counts across the five pages: `warm-gray` 22, `meteorite` 22, `warm-white` 16, `moonrock` 12, `white` 6. Roughly **80% light, 20% dark** — the dark sections (hero, one or two anchors) are the exception that makes them read as moments.

Downstream rules re-map component colors per theme rather than duplicating components:

```css
[data-section-theme="warm-gray"] .h-ml.is--highlight,
[data-section-theme="warm-white"] .h-ml.is--highlight { color: var(--color--primary--moon-rock) !important; }
[data-section-theme="moonrock"] .btn-main .btn-text,
[data-section-theme="meteorite"] .btn-main .btn-text { color: var(--color--primary--meteorite-black); }
[data-crosshair="dark"] .crosshair { color: var(--color--primary--meteorite-black) !important; }
```

#### Alpha discipline `[fetched]`

Hairlines and glass are always the neutral at a low alpha, never a separate gray:
`#2a2c2f1a` (10%) for spec-row borders, `#2a2c2f33` (20%), `#2a2c2f45` (27%) + `backdrop-filter: blur(6rem)` for the team overlay, `#2a2c2f66` (40%) + `blur(3px)` for callout panels, `#ffffff1a` (10%), `#fff3` / `#fff6` (20% / 40%) for thumbnail borders, `#0003` (20% black) for image scrims.

#### Radii `[fetched]`

**Effectively zero.** Outside Webflow's own widget defaults, the entire design system contains exactly two radii: `2px` on `.img-slider__thumb` and `9999px` on one pill. Everything else is hard-cornered.

#### Where ICAROS currently is

`[fetched]` from `src/**/*.css`: your two most-used accents today are **`#5A52FF`** (13 uses — a violet-blue) and **`#00A3B5`** (13 — teal), plus `#1b64da`, `#7aa7ff`, `#bfbfff`. `#5A52FF` in particular is the exact "purple neon space template" hue the brief bans. Both should go in the rebuild.

---

### 5. Imagery

`[fetched]` What I can actually confirm:

- **Aspect-ratio discipline is enforced in CSS, not by the photo.** `.updates-item__img-w { aspect-ratio: 1 }`. `.team-grid-item__img { padding-top: 100% }` (the pre-`aspect-ratio` square trick). `.img-slider__thumb { aspect-ratio: 1.5 }`. `.webgl-station-callouts-aspect-ratio { aspect-ratio: 1 }` on mobile, `auto` above. Ratios in the Tailwind layer: `1/1`, `258/180`, `70/43`, `1/0.55` (desktop only).
- **Full-bleed is a deliberate, named mode.** `[data-highlight-section="fullscreen"]` gives `.highlight-card { aspect-ratio: 1/2; min-height: 80rem; color: white }` and pushes `.highlight__bg` to `width: 100vw` centered with `transform: translate(-50%, -50%)`. On mobile the same attribute becomes `aspect-ratio: 1/1.9` with the min-height removed.
- **Per-image crop control, mobile only.** `data-object-fit-start="0%"` … `"100%"` in 10% steps, resolving to `object-position: N% center` **inside `@media (max-width: 479px)` only**. 83 elements carry `="50%"`, with 10%/20%/30%/60%/70%/80%/90% each used 5–13 times. This is a per-image, art-directed mobile crop — someone went through and chose a horizontal focal point for every photograph. That is crop discipline made operational.
- **Grayscale is used, but only on logos.** `.marquee-press__logo { filter: saturate(0%); height: 2.4rem }`, `.marquee-partner__logo { filter: saturate(0%); height: 4rem }`. Third-party logos are desaturated and locked to a fixed pixel height so they can't fight the layout.
- **Scrims, not overlays.** `.img-slider__dark-overlay { background-color: #0003 }` (20% black). `.footer-cta__gradient` is a **16-stop** `linear-gradient(180deg, transparent → #000)` — hand-tuned so the falloff is perceptually even instead of the muddy midtone a 2-stop gradient gives.
- **Blur as a state, not decoration.** `.feautures-inner-img.is--wide { --blur-value: 0px }` with an `::after` overlay applying `backdrop-filter: blur(var(--blur-value))` — animatable focus-pull on a photo.
- The hardware-progress slider pairs **one photo + one `.eyebrow` title + one short paragraph + a date**, ~30 entries. Titles like "Haven-1: Fully welded", "Domed window kick test", "Machining flight panels in-house", "Solar array electroluminescence test". Plain shop-floor documentation, presented without embellishment.

**No duotone.** `[fetched]` I found no duotone, `mix-blend-mode`, `filter: sepia`, or channel-mapping treatment on content photography anywhere in either stylesheet. The only filter on the whole site is `saturate(0%)` on logos. **Photographs are shown as-is.** If someone proposes a duotone treatment "like Vast," they are wrong — Vast doesn't do it.

**Takeaway for ICAROS:** your `public/assets/img/gallery/` has 15 photos and `rocket/` has 6. That is enough — *if* every one is cropped to a locked ratio, given a chosen mobile focal point, and captioned with a real date and a real fact. Vast's whole imagery strategy is "unmodified documentary photo, rigid frame, technical caption." That is the cheapest possible strategy for a team with real photos and no budget, and it is exactly what makes sparse content look intentional.

---

### 6. Technical annotation

Four distinct devices. All `[fetched]`.

#### a. Corner crosshairs

```css
.crosshair-wrap { position: absolute; inset: 0%; pointer-events: none; color: inherit; }
.crosshair-wrap.is--light { color: #fff; }
.crosshair      { width: var(--gap-s); aspect-ratio: 1; display: flex; align-items: center; justify-content: center; }

.sfm-crosshair  { width: 1.6rem; aspect-ratio: 1; position: absolute; pointer-events: none; display: none; }
.sfm-crosshair.is--top-left     { inset: 0% auto auto 0%; }
.sfm-crosshair.is--top-right    { inset: 0% 0% auto auto; }
.sfm-crosshair.is--bottom-left  { inset: auto auto 0% 0%; }
.sfm-crosshair.is--bottom-right { inset: auto 0% 0% auto; }
```

A 16px square SVG mark pinned to each corner of a region, in `currentColor`, controlled section-wide by `data-crosshair="inherit" | "dark"`. Pure decoration — but it frames a region as *measured* rather than *designed*. Trivially cheap: one inline SVG, four absolutely-positioned copies.

#### b. Rules with end ticks

```css
.divider { width: 100%; height: 1px; background-color: currentColor; color: #b3aba3; position: relative; }
.divider::before, .divider::after {
  content: ''; position: absolute; width: 1px; height: 2.4rem;
  background-color: currentColor; top: calc(50% - 1.2rem);
}
.divider::before { left: 1.2rem; }
.divider::after  { right: 1.2rem; }
```

A 1px horizontal rule with a 1px × 24px **vertical tick inset 12px from each end** — a drafting dimension line. There is a rotated variant (`.divider.size-comparison__border`) with the ticks horizontal for vertical rules. Two pseudo-elements, zero JS, and it makes an ordinary `<hr>` read as engineering.

#### c. Spec tables

```css
.specs-wrap  { margin-top: 9.6rem; margin-bottom: var(--gap-m); }
.specs-row   { width: 100%; display: flex; padding: var(--gap-m) 0;
               gap: var(--gap-s); border-bottom: 1px solid #2a2c2f1a; }
.specs-col   { width: 50%; }
.specs-inner { display: flex; gap: var(--gap-s); width: 100%; max-width: 67.6rem; margin-left: auto; }
.specs-haven { width: 10em; }               /* 7em on tablet */
.specs-toggle{ width: 2.6rem; padding: .4rem; background-color: #2a2c2f2e; border: 1px solid #2a2c2f66; }
```

50/50 rows, label left, value right-aligned inside a `max-width: 67.6rem` block, separated by a **10%-alpha 1px rule** — never a solid gray. Values are width-locked to an `em` measure (`width: 10em`) so numbers column up regardless of digit count.

On mobile: `.specs-col { width: 100% }` and `.specs-inner { height: 2.4rem; overflow: hidden; flex-flow: column; position: relative }` — a **fixed 24px viewport with the values stacked inside it**, i.e. the values roll vertically. `[inference]` Combined with `.specs-toggle` (26px square buttons), the mobile spec table becomes a compact one-line-at-a-time stepper instead of a long table.

#### d. Model hotspots — "callout stations"

The best-engineered component on the site. Complete implementation `[fetched]`:

```css
.webgl-station-callouts {                     /* the container */
  --callout-size: 3rem; --callout-inner: 1rem;
  --inset:       calc(100% - var(--callout-size));
  --minus-inset: calc(-100% + var(--callout-size));
  pointer-events: none;
}
@media (…mobile) { --callout-size: 2.25rem; --callout-inner: .75rem; }

.callout-station-wrapper {
  pointer-events: all;
  width: 29.6rem;
  display: flex; row-gap: 2.8rem;
  padding: calc((var(--callout-size) - var(--callout-inner)) / 2);
  background: #2a2c2f66;                       /* meteorite @ 40% */
  backdrop-filter: blur(3px);
  transform-origin: 2.1rem 2.1rem;
}
.callout-station-wrapper.callout-station-open {
  clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);
  backdrop-filter: blur(30px);
}
.callout-station-duration {
  transition: clip-path calc(.3s * var(--motion)),
              transform calc(.4s * var(--motion)) var(--motion-ease-vast),
              backdrop-filter .3s linear;
}
.callout-station-hidden { transform: scale(0); pointer-events: none; }

/* four corner anchors — the panel always opens away from the model */
.callout-station-top-left {
  transform-origin: 2rem 2rem; translate: 0 0; flex-direction: column;
  clip-path: polygon(0 0, var(--callout-size) 0,
                     var(--callout-size) var(--callout-size), 0 var(--callout-size));
}
.callout-station-bottom-left {
  transform-origin: 2rem calc(100% - 2rem); translate: 0 var(--minus-inset);
  flex-direction: column-reverse;
  clip-path: polygon(0 var(--inset), var(--callout-size) var(--inset),
                     var(--callout-size) 100%, 0 100%);
}
/* …top-right / bottom-right mirror with flex-direction: row-reverse */

.callout-station-dot {
  position: relative; width: var(--callout-inner); height: var(--callout-inner);
  transform: scale(1);
  transition: transform .3s cubic-bezier(.83,0,.17,1) .08s;
}
.callout-station-dot::after {                  /* invisible hit area */
  content: ''; position: absolute; top: -80%; left: -80%; width: 260%; height: 260%;
}
.callout-station-dot-background {
  position: absolute; inset: 0; background-color: #fff;
  transition: clip-path .3s cubic-bezier(.83,0,.17,1);
}
/* closed state: the square becomes a "close" glyph purely via clip-path */
.callout-station-close .callout-station-dot-background {
  clip-path: polygon(0 0, 0 100%, 50% 100%, 50% 50%, 50% 50%, 50% 50%, 50% 50%, 50% 100%, 100% 100%, 100% 0);
}
.callout-station-close:hover .callout-station-dot { transform: scale(3.7); transition: transform .3s cubic-bezier(.83,0,.17,1); }
.callout-station-close:hover .callout-station-dot-background {
  clip-path: polygon(0 0, 0 100%, 33% 100%, 33% 33%, 66% 33%, 66% 66%, 33% 66%, 33% 100%, 100% 100%, 100% 0);
  transition: clip-path .3s cubic-bezier(.83,0,.17,1) .08s;
}
.callout-station-close.hover-touch .callout-station-dot { /* same, via a class for touch */ }

.callout-station-top-bar { display: flex; column-gap: 1.2rem; width: 100%; height: var(--callout-inner); }
.callout-station-title {
  font-family: Phonic, sans-serif; font-size: 1.2rem; font-weight: 702;
  line-height: 100%; letter-spacing: .024rem; text-transform: uppercase; color: #fff;
  font-variant-numeric: lining-nums proportional-nums;
  opacity: 1; transition: opacity .3s;
}
.callout-station-paragraph {
  font-family: "Owners Text", sans-serif; font-size: 1.4rem; line-height: 116%; color: #fff;
}
.callout-station-close .callout-station-title,
.callout-station-close .callout-station-paragraph { opacity: 0; }
```

What makes it good, and what to copy:

1. **The hotspot and the panel are the same element.** Collapsed, a `clip-path` crops the 296px panel down to a 30px corner square containing only a 10px white dot. Open, the clip-path expands to the full rect. There is no separate marker component and no mount/unmount — one element, one clip-path.
2. **Four corner variants** (`top-left` / `top-right` / `bottom-left` / `bottom-right`), each with a matching `transform-origin`, `translate`, `flex-direction`, and `clip-path`. `[inference]` The runtime picks the variant based on which quadrant the hotspot lands in, so panels always open outward and never cover the model.
3. **The dot morphs into the close button** by animating `clip-path` on a white square and scaling it 3.7×. One element does marker, close affordance, and hover feedback.
4. **Touch parity via a class**, not a media query: `.hover-touch` duplicates every `:hover` rule so tap produces the same state.
5. `::after` at `-80% / 260%` gives a 10px dot a **26px hit target**. Cheap accessibility win.
6. Glass depth is `backdrop-filter: blur(3px) → blur(30px)` as it opens — closed it's barely there, open it fully separates from the model.
7. **The reveal is `clip-path`, never `width`/`height`.** No layout thrash, compositor-only.

##### How the callout content is authored `[fetched]`

This matters more than the CSS for a CMS-backed site. All hotspot content lives in **data attributes on a single placeholder div**, which the React island reads:

```html
<div class="webgl-station-callouts"
     data-react-component="webgl-haven-1-callouts"
     data-use-stencil="true"
     data-use-interior="true"
     data-callout-solar-panel-title="Deployable solar panels by DHV"
     data-callout-solar-panel-paragraph="Each solar wing on Haven-1 produces up to 1.1 kW of power, for a total power of 13.2 kW."
     data-callout-solar-panel-image=""
     data-callout-hatch-title="" data-callout-hatch-paragraph="" data-callout-hatch-image=""
     …>
```

Fourteen parts, each with `-title` / `-paragraph` / `-image`: `hatch`, `solar-panel`, `interface`, `gyros`, `avionics`, `domed-window`, `quarters`, `primary-structure`, `corridor`, `lab`, `area`, `table`, `thrusters`, `docking`.

`[fetched]` The hotspot images are real photographs, one per part, e.g. `/img/haven1-callouts/Domed Window.webp`, `Control Moment Gyros (CMG).webp`, `Deployable Table.webp`, `Hatch.webp`, `3.8m Cupola Window.webp`, `Batteries.webp`. **Each hotspot pairs a label with a photo of that actual part.**

The 360° interior viewer uses the same trick:

```html
<div data-react-component="360-image-viewer" data-open-by-default="true"
     data-dragon-tunnel="The Haven tunnel leads the crew to Haven-1…"
     data-common-area="The common area is a multifunctional hub…"
     data-corridor="The corridor is the area where crew equipment is stored…">
```

`[inference]` This exists so the copy is editable in the Webflow CMS without touching the React bundle. **For ICAROS the equivalent is: hotspot titles/text/images come out of Supabase and are handed to the 3D component as plain props — never hardcoded in the Three.js scene.** That keeps the admin console meaningful for the 3D pages too.

---

### 7. Desktop vs. mobile differentiation

The most concrete, immediately-actionable section. All `[fetched]` unless noted.

| Behavior | Desktop | Mobile / touch |
|---|---|---|
| **Smooth scroll** | Lenis, `smoothWheel: true`, `lerp: 0.1` | `syncTouch: false` — native OS scroll |
| **Button hover wipe** | `.btn-wipe` scaleY 0→1 | `@media (hover: none) { .btn-wipe { display: none } }` — **removed from the DOM's paint entirely** |
| **Team card overlay** | `.team-grid-item__overlay` wipes up via `clip-path: inset(100% 0 0)` on hover | `display: none`; `.team-grid__overlay-content` becomes a **static block below the image**, background `#0000`, text meteorite instead of white |
| **Team grid** | `display: grid; grid-template-columns: repeat(3, 1fr); gap: 6.4rem` | `display: flex; flex-flow: row; gap: 2rem`; items `flex: none; width: 20em` — a **drag carousel** |
| **Updates grid** | 2-up: `width: calc(50% - (var(--gap-s) / 2))`, row-gap `9.6rem` | 1-up: `width: 100%`, row-gap `var(--gap-xxl)` |
| **Hotspot hover** | `:hover` rules | duplicated onto a `.hover-touch` class |
| **Callout sizing** | `--callout-size: 3rem; --callout-inner: 1rem` | `2.25rem / .75rem` |
| **3D viewport** | `.webgl-station-callouts-aspect-ratio { aspect-ratio: auto }` | forced `aspect-ratio: 1` (square) |
| **Viewport height unit** | `--vh: 1vh`, upgraded to `1svh` via `@supports`, **inside `@media (hover: hover) and (pointer: fine)`** | falls back to the base `--vh: 8px` — a **fixed** value, so URL-bar resize can't reflow the layout |
| **Background video** | plays | `html.MOBILE.IS_LOW_POWER_MODE .full-bg-video_video { display: none }` — **low-power mode is detected and video is dropped** |
| **Section padding** | `--page-padding: 4rem`; `--gap-responsive`/`--container-padding: 4rem` | 991: `3.2rem` → 767: `2.4rem` → 479: `1.6rem` |
| **Section padding multipliers** | `L/XL/XXL = --section-padding × 1/2/3` (6/12/18rem) | ≤767: **all three collapse to `var(--gap-xxl)` (6.4rem)** — the XXL/XL/L distinction stops existing |
| **Image crop** | natural | `data-object-fit-start="N%"` → `object-position: N% center`, **only** below 479px |
| **Fullscreen highlight card** | `aspect-ratio: 1/2; min-height: 80rem` | `aspect-ratio: 1/1.9; min-height: unset; height: auto` |
| **Display type** | `.h-display: 21rem` | `6.4rem` |
| **Nav** | full menu bar | `.nav-bar__li.sm--show` / `.sm--hide` swap the item set; hamburger `.nav-menu__button` |

Three patterns worth naming explicitly:

1. **Hover states are deleted, not faked.** `@media (hover: none) { .btn-wipe { display: none } }` and `.team-grid-item__overlay { display: none }`. Nothing is left as a phantom tap-to-hover.
2. **Hidden content becomes visible content.** The team card's hover-revealed bio doesn't disappear on mobile — it is re-styled into a static caption under the photo. The information survives; only the choreography is dropped.
3. **The spacing *system* simplifies on mobile.** L/XL/XXL all collapse to one value below 767px. They didn't scale the rhythm down proportionally; they stopped making the distinction.

---

### 8. Updates page and Team page, specifically

#### Updates `[fetched]`

Structure: `hero-section[data-section-theme="white"]` → `updates-overview` → `press-overview` → footer.

```css
.updates-overview      { padding-bottom: calc(var(--section-padding) * 2); }   /* 12rem */
.updates-overview__top { display: flex; justify-content: space-between; align-items: center;
                         width: 100%; margin-bottom: var(--gap-l); gap: var(--gap-s); }

.updates-list          { display: flex; flex-flow: wrap; width: 100%;
                         column-gap: var(--gap-s);      /* 1.6rem */
                         row-gap: 9.6rem; }             /* 96px */
.updates-list__item    { width: calc(50% - (var(--gap-s) / 2)); }
.updates-list__item-inner { display: flex; flex-flow: column; gap: var(--gap-m); }

.updates-item__img-w   { width: 100%; aspect-ratio: 1; margin-bottom: var(--gap-s); }
.updates-item__title   { width: 100%; max-width: 41rem; text-wrap: balance; }
.updates-item__details { display: flex; align-items: center; gap: var(--gap-s); }
.updates-item__details.updates-columns  { flex-flow: wrap; justify-content: space-between; }
.updates-item__description { margin-top: var(--gap-s); display: flex; flex-flow: column; gap: var(--gap-m); }

.press-overview { border-top: 1px solid var(--color--primary--warm-gray);
                  padding: calc(var(--section-padding) * 2) 0; }   /* 12rem top & bottom */
```

The single strongest idea here: **`column-gap: 1.6rem` against `row-gap: 9.6rem`** — a 6:1 ratio. Two items in a row are nearly touching and read as one horizontal band; consecutive rows are 96px apart and read as separate events. It costs nothing and makes a short list look editorial rather than sparse. **Copy this exactly for the ICAROS posts index.**

Also: square 1:1 thumbnails, `text-wrap: balance` on titles capped at 410px, and a 1px warm-gray rule as the only separator between the two halves of the page. `[fetched]` `data-load-list="9"` / `data-load-button="8"` — a "load more" button rather than pagination.

#### Team `[fetched]`

Structure: dark hero → `highlight-text` statement → `team-experience-section` (warm-gray, draggable, giant stats) → `team-grid-section` → footer.

```css
.team-grid__wrap { margin-top: 9.6rem; }
.team-grid       { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gap-xxl); /* 6.4rem */
                   width: 100%; cursor: auto !important; }
.team-grid.two-col { grid-template-columns: repeat(2, 1fr); }
.team-grid__item { display: flex; flex-flow: column; gap: var(--gap-m); width: 100%; position: relative; }
.team-grid-item__img { width: 100%; padding-top: 100%; position: relative; }   /* forced square */

.team-grid-item__overlay {         /* desktop hover reveal */
  z-index: 2; padding: var(--gap-m);
  background-color: var(--color--primary--warm-gray);
  clip-path: inset(100% 0 0);      /* wipes up from the bottom edge */
  display: flex; flex-flow: column;
}
.team-grid__overlay-wrap    { z-index: 2; position: absolute; inset: 0%;
                              display: flex; align-items: flex-end; padding: var(--gap-m); }
.team-grid__overlay-content { z-index: 1; max-width: 34rem; padding: var(--gap-sm);
                              background-color: #2a2c2f45; backdrop-filter: blur(6rem);
                              color: #fff; gap: 9.6rem; }
```

Three-column square grid with a **64px gutter** — very generous, so a small team doesn't look thin. Bio reveals on hover by wiping a warm-gray panel up from the bottom (`clip-path: inset(100% 0 0)` → `inset(0 0 0)`). The alternate glass variant uses `#2a2c2f45` + `backdrop-filter: blur(6rem)`.

Mobile: overlay `display: none`, content becomes a static block (`margin-top: -2.4rem`, transparent, dark text), and the grid becomes a horizontal drag strip of `20em` cards.

`[fetched]` `data-team-item-animate` appears 39 times — a per-card enter animation hook.

**The stats block** — `.team-numbers__large` at 250px in a bespoke numeral face (details in §3), with `data-number-count` / `data-number-el="N"` driving a digit-slot counter, laid out as `.team-numbers__row { display: flex; justify-content: space-between; align-items: flex-start }`, stacking to a column on mobile with the number reordered to `order: 1`.

**For ICAROS:** you have 8 members with photos (one `null`). A 3-column square grid at 64px gutters, name + role + school on hover (desktop) / below the card (mobile), is a direct, honest fit for `member.json`'s shape (`name`, `role`, `school`, `image`). The oversized-number block is also a good fit — "N개 로켓 · N회 발사 · N명" — provided the numbers are real.

---

### 9. Loading and transitions

#### The loader `[fetched]` — remarkably restrained

```css
.loader { position: fixed; inset: 0%; z-index: 50000; pointer-events: none;
          background-color: #fdfcf4; display: none; }
.loader-logo { position: fixed; top: 5.98rem; left: 4.03rem; }
.loader-line { position: fixed; inset: 7rem 4rem auto 21rem;
               height: 1px; background-color: var(--color--primary--warm-gray); }
.loader-line-fill { position: absolute; inset: 0%; width: 100%; height: 100%;
                    background-color: var(--color--accent--solar-orange);
                    transform-origin: 0%; transform: scale(0); }
```

That is the entire loading screen:

- A warm-white full-bleed cover.
- The wordmark, fixed at **`top: 5.98rem; left: 4.03rem`** — sub-pixel values, because it is positioned to land *exactly* where the nav logo will be. When the loader clears, the logo does not move.
- A **1px horizontal hairline** running from `left: 21rem` to `right: 4rem` at `top: 7rem` — i.e. it starts just past the wordmark and runs to the page margin, aligned to the nav baseline.
- The hairline fills left-to-right in solar orange via `transform: scaleX(0 → 1)`.

No spinner, no percentage, no logo animation, no counter. **A 1px orange line, and the logo already in its final position.** It is maybe 15 lines of CSS and it is the single highest-value-per-byte thing on the site. Reimplement it verbatim in spirit.

#### Page transitions `[fetched]`

Barba.js (`data-barba="wrapper"` / `"container"`, namespaces `home` / `haven-1` / `who-we-are` / `updates`). `[inference]` This is what lets the fixed WebGL canvas persist across navigations — the DOM container swaps, the canvas doesn't remount. `[UNVERIFIED]` — I could not determine the actual visual transition (fade, wipe, or reuse of the loader cover) from the minified bundle.

**For ICAROS:** you're a React SPA with `react-router-dom` already, so you get the "canvas survives navigation" property for free by mounting the canvas above `<Routes>` in `App.jsx` — no Barba needed. That is a genuine architectural advantage over the reference.

#### Progress indicators `[fetched]`

```css
.slider-progress__bar { width: 1px; height: 1.2rem; background-color: #fff;
                        transition: width .35s cubic-bezier(.77,0,.175,1); }
.slider-progress__bar.is--current { width: 1.2rem; }
```

Slide pagination is a row of **1px × 12px vertical ticks**; the active one widens to 12px. Not dots. Reads as a ruler.

```css
.img-slider__thumb { width: 6.8rem; aspect-ratio: 1.5; border: 1px solid #fff3; border-radius: 2px; transition: border-color .2s; }
.img-slider__thumb:hover      { border-color: #fff6; }
.img-slider__thumb.is--current{ border-color: #fff; }
```

Thumbnail state is carried entirely by **border opacity** — 20% / 40% / 100%. No scale, no glow, no ring.

#### The motion token system `[fetched]` — verbatim from the inline `<style>`

```css
:root {
  --motion: 1;
  --animation-duration-primary:      0.65s;
  --animation-duration-primary-fast: 0.5s;
  --animation-bezier:       cubic-bezier(0.62, 0.05, 0.01, 0.99);
  --animation-primary:      calc(var(--animation-duration-primary)      * var(--motion)) cubic-bezier(0.62, 0.05, 0.01, 0.99);
  --animation-primary-fast: calc(var(--animation-duration-primary-fast) * var(--motion)) cubic-bezier(0.62, 0.05, 0.01, 0.99);
  /* --stagger-primary: 0.07s;  (commented out in source) */

  --motion-ease-vast:   cubic-bezier(0.4, 1.35, 0.5, 0.97);
  --motion-ease-spring: linear(0, 0.007, 0.03 2.1%, 0.122 4.6%, 0.243 6.9%, 0.645 13.7%,
                               0.85 18.1%, 0.926, 0.987, 1.032 24.7%, 1.064 27.1%, 1.077 28.7%,
                               1.085, 1.088 32.3%, 1.086 34.3%, 1.074 37.8%, 1.033 45.8%,
                               1.015 50%, 1.002 54.7%, 0.994 59.6%, 0.992 66.4%, 0.999 85%, 1.001);
}
@media (prefers-reduced-motion: reduce) { :root { --motion: 0; } }
```

Note the mechanism: **`--motion` is a scalar multiplier baked into every duration** (`calc(0.3s * var(--motion))`), flipped to `0` under `prefers-reduced-motion`. One line disables every animation on the site without touching a single component. Steal this exactly.

Three curves total:
- `cubic-bezier(0.62, 0.05, 0.01, 0.99)` — the workhorse. Long-tailed ease-in-out, appears on every button, wipe, and reveal.
- `cubic-bezier(0.4, 1.35, 0.5, 0.97)` — `--motion-ease-vast`, with `y1 = 1.35`, i.e. **overshoot**. Used only on the callout panel `transform` and the scroll-rail background.
- `linear(...)` spring — used only on the scroll rail items.

Plus two more found in component CSS: `cubic-bezier(.83, 0, .17, 1)` (the hotspot dot morph — easeInOutQuint) and `cubic-bezier(.4, 0, .2, 1)` (the Tailwind default, 7 uses).

Measured durations across the CSS: `.08s` (3×, always as a *delay*), `.15s`, `.2s`, `.3s` (10× — the most common), `.35s`, `.4s`, `.5s`, `.7s`, `.75s`, `.8s`, `.9s`.

#### The button hover — the site's most-used interaction `[fetched]`

`data-btn-hover` appears **251 times**. The implementation:

```css
.btn-wipe { position: absolute; inset: 0; width: 100%; height: 100%;
            background-color: var(--color--primary--warm-gray);
            transform: scaleY(0) rotate(0.001deg);
            transform-origin: top left;
            transition: background-color var(--animation-primary), transform var(--animation-primary); }

[data-btn-hover]:hover .btn-wipe,
[data-btn-hover].w--open .btn-wipe {
  transform: scaleY(1) rotate(0.001deg);
  transform-origin: bottom left;
}

.btn-text { transition: color var(--animation-primary); }
.btn-main.is--transparent { transition: color .5s cubic-bezier(.62,.05,.01,.99); }
[data-load-button]:hover .btn-text { color: var(--color--primary--white); }

@media (hover: none) { .btn-wipe { display: none; } }
```

The trick worth naming: **`transform-origin` flips from `top left` to `bottom left` between the rest and hover states.** So the fill wipes *up* on enter and wipes *up and out* on leave, instead of retracting back down. Directional continuity from a two-word change. The `rotate(0.001deg)` forces GPU rasterization to avoid scaled-edge aliasing.

Variants: `.btn-wipe.is--dark` (`#000`), `.is--white`, `.is--glass` (`#ffffff12`).

Chevron icons get an ambient loop when *not* hovered — `animation: chevron calc(var(--animation-duration-primary) * 2) … infinite` with a `75% { transform: none }` keyframe (three-quarters idle, one-quarter nudge), replaced by a `translateX(75%)` on hover.

---

## Part 2 — Anime.js (micro-interaction vocabulary only)

`[fetched]` from animejs.com — v4 API examples and the module size chart on the homepage.

### Bundle sizes, verbatim from the site

| Module | Size |
|---|---|
| Full bundle | **24.50 KB** |
| Timer (base) | 5.60 KB |
| Animation | +5.20 KB |
| Timeline | +0.55 KB |
| Animatable | +0.40 KB |
| Draggable | +6.41 KB |
| Scroll | +4.30 KB |
| Scope | +0.22 KB |
| SVG | 0.35 KB |
| Stagger | +0.48 KB |
| Spring | 0.52 KB |
| WAAPI | 3.50 KB |

A `Timer + Animation + Stagger + SVG` build is ~**11.6 KB**. That is genuinely small — smaller than GSAP core. **Anime.js v4 is not "a big animation dependency."** But most of what we need here is cheaper still.

### The vocabulary, mapped to a native reimplementation

| Effect | Anime.js v4 | Native equivalent | Verdict |
|---|---|---|---|
| **Text reveal (word/line)** | `animate('.word', { … delay: stagger(40) })` | Split into `<span>`s once at mount; `IntersectionObserver` adds `.in`; CSS `transition-delay: calc(var(--i) * 60ms)` with `--i` set inline. Vast does this without any library (`data-split-text="words"`) | **Native.** Zero deps |
| **Highlight / two-layer reveal** | — | **Vast's exact technique**: two stacked copies. Base `.is--highlight { color: <dim> }`, duplicate `.is--highlight__dup { color: <bright>; position: absolute; inset: 0 auto auto 0 }`. Animate per-word opacity on the top copy | **Native.** ~20 lines |
| **SVG draw-on (blueprint lines)** | `animate(createDrawable('path'), { draw: ['0 0','0 1','1 1'], delay: stagger(40), ease: 'inOut(3)', autoplay: onScroll({ sync: true }) })` | `el.style.setProperty('--len', el.getTotalLength() + 'px')` then CSS `stroke-dasharray: var(--len); stroke-dashoffset: var(--len)` → `0`. **This is literally what Hanwha ships** (see Part 3) | **Native.** One JS line per path |
| **Number / spec counters** | `animate(obj, { value: n, modifier: Math.round })` | `requestAnimationFrame` lerp + `toLocaleString('ko-KR')`, or Vast's digit-slot approach: N `<span>`s in a `overflow: hidden; height: 1em` box, `translateY` per digit | **Native.** ~30 lines. Use `tabular-nums` either way |
| **Stagger** | `stagger(100)`, `stagger([1.1,.75], { grid: [13,13], from: 'center' })` | `--i` custom property + `transition-delay: calc(var(--i) * var(--stagger))` | **Native** for 1-D. Anime.js wins only for grid/`from: 'center'` staggers — which we don't need |
| **Button + link hover** | — | Vast's `.btn-wipe`: `scaleY(0→1)` with `transform-origin` flipping `top left` → `bottom left`. Pure CSS | **Native.** Copy the technique |
| **Loading** | — | `transform: scaleX(0→1)` on a 1px bar, driven by real asset progress | **Native** |
| **Scroll scrubber / progress** | `onScroll({ sync: true })` for a scrubbed link | `IntersectionObserver` for one-shots. For a real progress bar, `animation-timeline: scroll()` (Chrome/Edge 115+, Safari 26+, Firefox behind a flag as of writing) with a `scroll` listener fallback | **Native**, with a fallback |
| **Draggable slider (`data-drag`)** | `createDraggable('.el', { releaseEase: createSpring({ stiffness: 120, damping: 6 }) })` | `scroll-snap-type: x mandatory` + `overflow-x: auto` + `overscroll-behavior-x: contain`. Native momentum, native accessibility, native keyboard | **Native and better.** Do not hand-roll drag physics for a card strip |
| **Spring easing** | `createSpring({ stiffness, damping })` | CSS `linear()` — exactly what Vast's `--motion-ease-spring` is. Generate once, paste as a token | **Native** |
| **Responsive animation** | `createScope({ mediaQueries: { portrait: '(orientation: portrait)' } })` | `@media` + `matchMedia()` | **Native** |
| **Shape morph** | `animate('.a', { d: morphTo('.b') })` | Nothing cheap. Needs the library | **Skip.** We don't need morphing |
| **Motion path** | `...createMotionPath('.circuit')` | `offset-path: path(…)` + `offset-distance` — good browser support now | **Native**, if ever needed |

### Recommendation

**Ship zero animation dependencies for the marketing pages.** Every effect in the brief's list has a native equivalent that is smaller than the import. The two enabling primitives are:

1. `IntersectionObserver` → toggle an `.is-in` class. One ~15-line hook (`useReveal`) covers text reveal, image reveal, draw-on, and counters.
2. An `--i` index custom property set inline (`style={{ '--i': i }}`) → `transition-delay: calc(var(--i) * var(--stagger))`. One line of CSS covers all staggering.

Reconsider only if the `/rocket/[slug]` 3D showroom needs a real timeline with labels and seeking — and even then, `three` is already in the bundle at that point and you can drive the camera from a scroll ratio directly, the way Hanwha does.

---

## Part 3 — Hanwha Ocean 3D Virtual Showroom (component reference)

`https://www.hanwhaocean.com/en/whatwedo/3dsubm/` — the KSS-III submarine showroom. Stack `[fetched]`: jQuery + **GSAP/ScrollTrigger** + **Three.js** with **`GLTFLoader` + `DRACOLoader`**, plus `THREE.Water`. Very different codebase from Vast, same core architecture.

### Showroom chrome

```html
<main id="WWD-3dsubm" data-hd-type="wh" data-ft-pd="no" data-detail="3dsubm" data-landscape="true">
  <div class="main-inner" data-path="specialShip">
    <div id="modelCon"><div id="model"></div></div>   <!-- the persistent 3D layer -->
    <div id="wrap">                                    <!-- all the HTML content -->
      <section class="init"><div class="mesh-area"></div></section>
      <section id="KV" class="sec_kv intro">…</section>
      <section id="SONAR"     class="sec_sonar">…</section>
      <section id="WHLS"      class="sec_whls">…</section>
      <section id="VLS"       class="sec_vls">…</section>
      <section id="BATTERY"   class="sec_battery">…</section>
      <section id="FUEL-CELL" class="sec_fuel-cell" data-focus-offset="0">…</section>
    </div>
  </div>
</main>
```

`[fetched]` Page-level chrome flags on `<main>`: `data-hd-type="wh"` (white header), `data-ft-pd="no"` (no footer padding), `data-landscape="true"`. `[inference]` The last one gates the experience to landscape on mobile.

`[fetched]` `$modelCon.style.height = wrapHeight + 'px'` and `$stickyNav.style.height = wrapHeight + 'px'` — the model container is sized to the full scroll height and sections use `.sticky` internally, rather than ScrollTrigger pinning.

### The camera-framing pattern — the transferable idea

`[fetched]`, verbatim from `/js/pages/hanwha-ocean.js`:

```js
function getAreaInfo($target, selector) {
  const $area = $target.querySelector(".mesh-area");
  const rect = $area.getBoundingClientRect();
  const parentRect = $area.parentNode.getBoundingClientRect();
  return { left: rect.left, top: rect.top - parentRect.top,
           width: rect.width, height: rect.height };
}

function getCameraOffset(areaInfo) {
  return {
    x: areaWidth  / 2 - areaInfo.width  / 2 - areaInfo.left,
    y: areaHeight / 2 - areaInfo.height / 2 - areaInfo.top
  };
}

// FOV derived from the target box height:
//   Math.atan(height / (2 * cameraDistance))

// per-section scroll mapping:
const makerRect = $section.querySelector(".mesh-area").parentNode.getBoundingClientRect();
animator.scrollRatios[i] = (sectionRect.height - makerRect.height) / sectionRect.height;
```

**Every section contains an empty `<div class="mesh-area">`. It renders nothing. Its only job is to be a rectangle the camera aims at.** The camera offset and FOV are computed from that box's live `getBoundingClientRect()`, so the 3D framing tracks the CSS layout automatically at every breakpoint, with zero hardcoded coordinates.

This is the same contract Vast uses (`.webgl-home-space-station`, `position: absolute; inset: 0`). **Two independent teams, same answer.** For ICAROS this is the design: `/rocket/[slug]` gets one persistent canvas, and each spec/feature section declares an empty target box.

### Part callouts — hand-authored SVG, not runtime-generated

`[fetched]` Each section's `.mesh-area-inner` contains a hand-drawn SVG technical callout — leader line into a bordered label box:

```html
<div class="mesh-area-inner">
  <div class="notmobile">
    <svg width="701" height="130" viewBox="0 0 701 130">
      <g class="box-battery-head">
        <path d="M12 71.5C8.68 71.5 0.5 71.5 0.5 71.5V36.19L9 28.51H12" stroke="white" stroke-opacity="0.2"/>
        <path d="M4 59.72L4 67.91H12" stroke="white"/>          <!-- the tick, full opacity -->
        <path d="M12 28H110V72H12V28Z" fill="black" fill-opacity="0.1"/>
        <path d="M12 29H110V27H12V29ZM110 71H12V73H110V71Z" fill="white" fill-opacity="0.2" mask="…"/>
        <!-- label text as outlined paths -->
      </g>
    </svg>
  </div>
</div>
```

Three rules fall out:

1. **Two stroke opacities.** The frame and leader line are `stroke-opacity="0.2"`; the short connector tick is `stroke` at full opacity. The result reads as a technical drawing rather than a UI chrome box. Box fill is `black @ 10%`.
2. **`.notmobile`** — the entire annotation overlay is dropped on small screens. There is also a mobile-specific asset (`3dsubm_fuel-cell_model_in-m.svg`), so a **simplified** annotation ships on mobile where one is needed at all.
3. Label text is **outlined paths**, not `<text>` — guarantees the drawing is pixel-identical to the Figma source.

### Draw-on animation

`[fetched]`:

```js
$svgPaths.forEach(($el) => {
  $el.style.setProperty("--path-length", $el.getTotalLength() + "px");
});
```

Measure each path in JS, write the length into a CSS custom property, and let CSS animate `stroke-dashoffset` from `var(--path-length)` to `0`. Also queried separately: `path:not(.board)` vs `path.board`, `g`, `rect` — so the frame, the leader, and the label box animate on different timeline beats.

**This is the entire "SVG draw-on" answer and it needs no library.**

### Text effects and DOM reparenting

`[fetched]`:
- `.txt_ef.txt_ef_up` (load reveal) / `.txt_ef.txt_ef_scr` (scroll reveal); the GSAP timeline targets `.txt_ef_scr > p > span` — text is pre-split into spans server-side, then staggered.
- Decorative DOM-only overlays sit on top of the 3D: `.beam.beam-1 > span × 3` for the SONAR pulse. Cheap, and it keeps effects out of the shader.
- **DOM reparenting across breakpoints:**

```js
on("mediachange", (media) => {
  createSecTimeline();
  if (media == "desktop" && !$content.closest(".mesh-area-wrap")) {
    $section.querySelector(".mesh-area-wrap .inwrap").append($content);
  } else if (media !== "desktop" && $content.closest(".mesh-area-wrap")) {
    $inwrap.append($content);
  }
});
```

On desktop the copy block is moved *into* the sticky 3D wrapper so it overlays the model; on mobile it is moved back out so it stacks below. `[inference]` This is a jQuery-era solution to what React solves with a conditional render or a CSS grid reorder — but the **design intent** is the point: **text overlays the model on desktop, stacks under it on mobile.**

### What to take for `/rocket/[slug]`

| Element | Decision |
|---|---|
| **Camera framing** | Empty `.model-target` boxes per section; camera offset + FOV from `getBoundingClientRect()`. Never hardcode camera positions |
| **Hotspots** | **Vast's** `callout-station`, not Hanwha's static SVG — ICAROS hotspots must be CMS-editable. Corner-anchored clip-path panel, 10px white square marker, dot-morphs-to-close |
| **Hotspot content** | From Supabase → props. Title (mono, uppercase, 12px) + one paragraph + one photo of the actual part |
| **Part callouts / leader lines** | Hanwha's SVG technique, but as **runtime-positioned** DOM leader lines (a 1px `<div>` rotated to the anchor) so they survive CMS edits. Two opacities: 20% for the run, 100% for the tick |
| **Draw-on** | `getTotalLength()` → `--path-length` → CSS `stroke-dashoffset` |
| **Rotate** | Drag-to-orbit with damped inertia, clamped polar angle. **No `OrbitControls` zoom** — it lets users get lost |
| **Explode** | ICX-1/2 have 1–2 engines each; a full explode view is over-scoped for the content that exists. Prefer a **two-state toggle (exterior / cutaway)** — Vast's `data-use-interior="true"` / `data-use-stencil="true"` is exactly this |
| **Specs** | Persistent eyebrow rail — Vast's 3D-tour page carries the full spec strip *above* the model at all times, and drops the footer entirely |
| **Mobile** | Force the canvas square (`aspect-ratio: 1`), shrink hotspots ~25%, drop leader lines, move spec text below the model, `.hover-touch` class for tap parity |
| **Fallback** | Vast's `data-webgl-fb` — a static render in the same box when WebGL is unavailable or the device is low-power. **Mandatory**, not nice-to-have |

---

## Part 4 — The five structural decisions to carry into ICAROS

1. **One persistent, fixed, `pointer-events: none` canvas; sections declare empty target boxes.** Mount the canvas above `<Routes>` in `App.jsx` so it survives navigation (React Router gives us for free what Vast needed Barba for). Every 3D-bearing section renders `<div class="model-target" />` and the canvas reads its rect. Both references converged on this independently.

2. **No pinning, no snapping, no scroll hijacking.** Vast's 1.5 MB bundle contains zero `pin:` and three `scrub: true`. Ship reveals on `IntersectionObserver` at ~70% viewport, and skip the scroll library entirely. Add Lenis later only if it's actually missed — and if you do, `syncTouch: false`.

3. **Section-level theming via one data attribute.** `[data-theme="dark" | "light" | "tint"]` on each `<section>`, with the component layer re-mapping colors underneath. ~80% light, ~20% dark. This is how you get a varied-looking page out of a handful of components — and it makes the Supabase-driven landing sections themeable from the CMS without new CSS.

4. **A third type role: technical monospace.** You have display (`WdscnUEx`) and Korean body (`Pretendard`). Add one mono at one weight for eyebrows, spec labels, spec values, dates, and captions. This single addition does more for the "engineering, not marketing" register than any effect. Latin/uppercase/tracked for English section labels; Pretendard at `letter-spacing: 0` for Korean.

5. **The signal color is a mark, never a surface.** One accent, spent only on 1px rules, 6–10px squares, the loader hairline, progress fills, and `::selection`. Vast's accent appears **6 times** in a 210 KB stylesheet against 37 uses of white. Delete `#5A52FF` and `#00A3B5` from the codebase in the same pass.

**Bonus, because it's the highest ratio of impact to effort on the whole list:** rebuild the loader as Vast's — a 1px hairline filling in the signal color, with the wordmark already in its final nav position. And `--motion: 1 | 0` multiplied into every duration, flipped by `prefers-reduced-motion`.

---

## Design tokens (proposed)

Drop-in `:root` block. Values are concrete and internally consistent; adjust hues, not structure.

### Root sizing

```css
html {
  /* 62.5% instead of Vast's hard `10px`: 1rem === 10px at default settings,
     but still scales with the user's browser font-size preference. */
  font-size: 62.5%;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
body { font-size: var(--fs-body); line-height: var(--lh-body); }
```

### Color

Cool graphite neutrals (deliberately *not* Vast's warm regolith ramp) plus one hot signal. The signal is `Flare` — an orange at ~29° hue, distinct from Vast's red-leaning `#FF5623` at ~14°, and justified by the team's own name: Icarus flew at the sun.

```css
:root {
  /* ---- Neutrals: cool graphite ---- */
  --n-0:    #FFFFFF;
  --n-25:   #F7F8F9;
  --n-50:   #EEF0F2;
  --n-100:  #E1E4E8;
  --n-200:  #C7CBD1;
  --n-300:  #A2A8B0;
  --n-400:  #79808A;
  --n-500:  #565D67;
  --n-600:  #3A4049;
  --n-700:  #272C33;
  --n-800:  #191D22;
  --n-900:  #0E1114;
  --n-950:  #07090B;

  /* ---- Signal: Flare (the ONLY accent) ---- */
  --sig:       #FF7A00;                      /* MARKS ONLY — rules, squares, fills, progress */
  --sig-ink:   #B04600;                      /* the accent as TEXT on light — 5.31:1 on --n-25 */
  --sig-soft:  rgb(255 122 0 / 0.14);        /* hover washes, active row tint */

  /* ---- Status (forms only; never decorative) ---- */
  --ok:    #1F8A4C;
  --warn:  #B26A00;
  --err:   #C6303A;

  /* ---- Semantic: LIGHT sections (default) ---- */
  --bg:          var(--n-25);
  --bg-raised:   var(--n-0);
  --bg-sunken:   var(--n-50);
  --fg:          var(--n-800);               /* 15.9:1 on --bg */
  --fg-muted:    var(--n-500);               /*  6.3:1 on --bg */
  --fg-faint:    var(--n-400);               /*  3.8:1 — large text / non-text only */
  --rule:        rgb(14 17 20 / 0.12);       /* the ONLY hairline color on light */
  --rule-strong: rgb(14 17 20 / 0.24);
  --scrim:       rgb(7 9 11 / 0.20);
  --glass:       rgb(14 17 20 / 0.28);

  /* ---- Layout ---- */
  --page-pad:    var(--sp-7);                /* 4rem  → 2.4rem ≤991 → 1.6rem ≤479 */
  --nav-h:       7.2rem;
  --measure:     68rem;                      /* max reading width */
  --container:   150rem;

  /* ---- Elevation: the design is flat. Two shadows exist, both for overlays. ---- */
  --shadow-pop:  0 1px 2px rgb(7 9 11 / .06), 0 8px 24px rgb(7 9 11 / .10);
  --shadow-modal:0 2px 4px rgb(7 9 11 / .08), 0 24px 64px rgb(7 9 11 / .24);
  --blur-glass:  blur(24px);
  --blur-veil:   blur(3px);
}

/* ---- Semantic: DARK sections ---- */
[data-theme="dark"] {
  --bg:          var(--n-900);
  --bg-raised:   var(--n-800);
  --bg-sunken:   var(--n-950);
  --fg:          var(--n-0);                 /* 18.9:1 */
  --fg-muted:    var(--n-300);               /*  7.9:1 */
  --fg-faint:    var(--n-400);               /*  4.8:1 */
  --rule:        rgb(255 255 255 / 0.14);
  --rule-strong: rgb(255 255 255 / 0.28);
  --scrim:       rgb(7 9 11 / 0.45);
  --glass:       rgb(255 255 255 / 0.08);
  --sig-ink:     var(--sig);                 /* full accent is legible as text on dark */
  color-scheme:  dark;
}

/* ---- Semantic: TINT sections (the quiet third state) ---- */
[data-theme="tint"] {
  --bg:        var(--n-100);
  --bg-raised: var(--n-50);
  --bg-sunken: var(--n-200);
}

section { background-color: var(--bg); color: var(--fg); }

/* Vast puts warm-white on solar-orange here, which measures 3.09:1 — don't copy that.
   Dark ink on the signal is 7.25:1 and looks just as good. */
::selection { background: var(--sig); color: var(--n-900); }
```

#### Verified contrast (computed, WCAG 2.1 relative luminance)

| Pair | Ratio | Verdict |
|---|---|---|
| `--fg` `#191D22` on light `#F7F8F9` | **15.92** | AAA |
| `--fg-muted` `#565D67` on light | **6.26** | AA (AAA for large) |
| `--fg-faint` `#79808A` on light | **3.75** | Large text / UI marks only — **never body copy** |
| `--fg` `#FFFFFF` on dark `#0E1114` | **18.94** | AAA |
| `--fg-muted` `#A2A8B0` on dark | **7.90** | AAA |
| `--fg-faint` `#79808A` on dark | **4.75** | AA |
| `--sig` `#FF7A00` on dark | **7.25** | AAA — accent may be text on dark |
| `--sig` `#FF7A00` on light | **2.46** | **FAILS** — marks only on light, never text |
| `--sig-ink` `#B04600` on light `#F7F8F9` | **5.31** | AA (5.64 on `#FFFFFF`, 4.94 on `#EEF0F2`) |
| `--n-900` on `--sig` (button fill) | **7.25** | AAA |
| `#FFFFFF` on `--sig` | **2.61** | **FAILS** — never white text on the accent |

*(Reference point: Vast's own `#FF5623` on `#FDFCF4` measures **3.09** — which is exactly why they never set text in it.)*

### Type

```css
:root {
  --ff-display: "WdscnUEx", "Pretendard", system-ui, sans-serif;   /* ONE weight: 500 */
  --ff-body:    "Pretendard", system-ui, -apple-system, sans-serif;
  --ff-mono:    "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;

  /* Weights — display is 500 everywhere; do not add a display bold. */
  --fw-display: 500;
  --fw-body:    400;
  --fw-medium:  500;
  --fw-strong:  600;

  /* Sizes — clamp between the mobile and desktop ends of the Vast ratio */
  --fs-display: clamp(5.6rem, 10.5vw, 14rem);
  --fs-h1:      clamp(3.6rem,  6.0vw,  7.2rem);
  --fs-h2:      clamp(2.8rem,  4.4vw,  5.2rem);
  --fs-h3:      clamp(2.4rem,  3.0vw,  3.6rem);
  --fs-h4:      clamp(2.0rem,  2.2vw,  2.6rem);
  --fs-h5:      1.8rem;
  --fs-body-l:  1.8rem;
  --fs-body:    1.6rem;
  --fs-body-s:  1.4rem;
  --fs-caption: 1.3rem;
  --fs-mono:    1.2rem;      /* the eyebrow / spec-label size */
  --fs-mono-s:  1.1rem;
  --fs-stat:    clamp(7.2rem, 16vw, 22rem);

  /* Line heights — tighten as size grows */
  --lh-display: 0.86;
  --lh-h1:      0.92;
  --lh-h2:      0.98;
  --lh-h3:      1.06;
  --lh-h4:      1.12;
  --lh-body:    1.62;   /* Korean needs more than Vast's 1.36 — Hangul is denser */
  --lh-body-s:  1.55;
  --lh-mono:    1.0;

  /* Tracking — LATIN ONLY. Korean text stays at 0. */
  --tr-display: -0.022em;
  --tr-h1:      -0.014em;
  --tr-h2:      -0.008em;
  --tr-h3:       0em;
  --tr-h4:       0.008em;
  --tr-h5:       0.016em;
  --tr-body:     0em;
  --tr-mono:     0.06em;    /* uppercase mono eyebrow */
  --tr-stat:    -0.05em;
}

/* Korean guard — Hangul breaks above ~0.02em and uppercase is a no-op */
:lang(ko) { letter-spacing: 0; text-transform: none; }

.eyebrow {
  font-family: var(--ff-mono);
  font-size: var(--fs-mono);
  font-weight: 400;
  line-height: var(--lh-mono);
  letter-spacing: var(--tr-mono);
  text-transform: uppercase;
  color: var(--fg-muted);
}
.eyebrow:lang(ko) {
  font-family: var(--ff-body); font-weight: 500;
  letter-spacing: 0; text-transform: none;
}
.num, .spec-value, time { font-variant-numeric: tabular-nums lining-nums; }
```

### Spacing

4px base, matching Vast's actual step set.

```css
:root {
  --sp-0:  0;
  --sp-1:  0.4rem;    /*   4 */
  --sp-2:  0.8rem;    /*   8 */
  --sp-3:  1.2rem;    /*  12 */
  --sp-4:  1.6rem;    /*  16 */
  --sp-5:  2.4rem;    /*  24 */
  --sp-6:  3.2rem;    /*  32 */
  --sp-7:  4.0rem;    /*  40 */
  --sp-8:  4.8rem;    /*  48 */
  --sp-9:  6.4rem;    /*  64 */
  --sp-10: 9.6rem;    /*  96 */
  --sp-11: 12.8rem;   /* 128 */
  --sp-12: 19.2rem;   /* 192 */

  /* Section rhythm — Vast's ×1 / ×2 / ×3 multiplier system */
  --section-pad:     6.4rem;
  --section-pad-l:   calc(var(--section-pad) * 1);
  --section-pad-xl:  calc(var(--section-pad) * 2);
  --section-pad-xxl: calc(var(--section-pad) * 3);

  /* The updates-grid signature: tight columns, generous rows */
  --grid-gap-x: var(--sp-4);   /* 16 */
  --grid-gap-y: var(--sp-10);  /* 96 */
}

@media (max-width: 991px) { :root { --page-pad: var(--sp-5); } }
@media (max-width: 767px) {
  :root {
    --page-pad: var(--sp-5);
    /* Below 767 the L/XL/XXL distinction collapses to one value — Vast does exactly this */
    --section-pad-l: var(--sp-9);
    --section-pad-xl: var(--sp-9);
    --section-pad-xxl: var(--sp-9);
    --grid-gap-y: var(--sp-9);
  }
}
@media (max-width: 479px) { :root { --page-pad: var(--sp-4); } }
```

### Radii

The design is square. These exist so nothing improvises.

```css
:root {
  --r-0:    0;          /* everything: cards, buttons, inputs, panels, images */
  --r-1:    2px;        /* thumbnails and chips ONLY */
  --r-full: 9999px;     /* avatars and status dots ONLY */
}
```

### Motion

```css
:root {
  --motion: 1;                 /* scalar multiplied into every duration */

  --dur-1: calc(150ms * var(--motion));   /* color, opacity, border */
  --dur-2: calc(300ms * var(--motion));   /* hover wipes, clip-path panels */
  --dur-3: calc(500ms * var(--motion));   /* fast primary */
  --dur-4: calc(650ms * var(--motion));   /* primary — reveals, page-level */
  --dur-5: calc(900ms * var(--motion));   /* long reveals, image scales */
  --delay-nudge: 80ms;
  --stagger: 60ms;

  --ease-primary: cubic-bezier(0.62, 0.05, 0.01, 0.99);  /* long-tail in-out; the workhorse */
  --ease-out:     cubic-bezier(0.22, 1.00, 0.36, 1.00);  /* enters, reveals */
  --ease-in:      cubic-bezier(0.64, 0.00, 0.78, 0.00);  /* exits */
  --ease-quint:   cubic-bezier(0.83, 0.00, 0.17, 1.00);  /* icon/marker morphs */
  --ease-back:    cubic-bezier(0.34, 1.40, 0.64, 1.00);  /* overshoot — sparingly */
  --ease-linear:  linear;

  --t-color:  color var(--dur-1) var(--ease-out),
              background-color var(--dur-1) var(--ease-out),
              border-color var(--dur-1) var(--ease-out);
  --t-move:   transform var(--dur-2) var(--ease-primary);
  --t-reveal: opacity var(--dur-4) var(--ease-out),
              transform var(--dur-4) var(--ease-out);
}

@media (prefers-reduced-motion: reduce) {
  :root { --motion: 0; --stagger: 0ms; }
  *, *::before, *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; }
}
```

### Z-index

```css
:root {
  --z-base:    0;
  --z-raised:  10;
  --z-sticky:  100;
  --z-canvas:  500;    /* the 3D layer, pointer-events: none */
  --z-rail:    800;    /* scroll progress rail */
  --z-nav:     1000;
  --z-overlay: 2000;   /* mobile menu, modals */
  --z-loader:  9000;
}
```

### Breakpoints (documentation only — CSS custom properties can't be used in media queries)

```
xs   ≤ 479px    mobile          --page-pad 1.6rem
sm   ≤ 767px    large mobile    --page-pad 2.4rem; section L/XL/XXL collapse
md   ≤ 991px    tablet          --page-pad 2.4rem
lg   ≥ 992px    desktop         --page-pad 4rem
xl   ≥ 1440px   design width    (the mockup reference width)
```

---

## Anti-patterns (banned)

Explicitly out of scope for this rebuild. If a proposal hits any of these, it is rejected on sight, regardless of how good it looks in isolation.

### 1. Purple neon space templates — banned

No violet/indigo-on-black gradients, no `#7C3AED`/`#5A52FF`/`#8B5CF6` glow, no "cosmic" radial auroras behind headings, no gradient-text headlines. **`#5A52FF` and `#00A3B5` must be deleted from the codebase in this rebuild** — they are 26 of the current accent uses. This palette is the visual signature of a template, and every real aerospace program's site is a restrained neutral ramp with one signal. Deviating from that reads as "we bought a theme," which is the exact opposite of what ICAROS's real hardware deserves.

### 2. Gratuitous star particles — banned

No canvas starfields, no drifting particle systems, no twinkle layers, no parallax nebulae, no `<canvas>` whose only job is atmosphere. Vast's site is about a space station and contains **zero** decorative particles. The one WebGL scene renders the actual hardware. If a pixel isn't a rocket, a photo, a spec, or a person, it doesn't get GPU time. Corollary: no floating/orbiting 3D geometry that isn't an ICAROS vehicle.

### 3. Heavy custom cursors — banned

No cursor replacement, no trailing dot, no magnetic-snap targets, no "VIEW"/"DRAG" cursor labels, no ring that lags the pointer. These break accessibility, break on touch entirely, and cost a `mousemove` RAF loop for zero information gain. Vast — an Awwwards SOTD site — ships **no custom cursor**. The only cursor-adjacent thing in its CSS is `cursor: auto !important` on the team grid, explicitly *turning one off*. Note that `.crosshair` is a static corner mark on a layout region, not a cursor. `cursor: grab` / `grabbing` on a genuinely draggable element is fine — that's a real affordance, not decoration.

### 4. Scroll hijacking — banned

No pinned sections, no `scroll-snap` on the page container, no "scroll to advance the slide" full-page paging, no intercepting `wheel` to drive a timeline, no scroll-jacked hero that eats three viewport-heights before you reach content. **The reference does not do this: zero `pin:` calls, no page-level snap, and `syncTouch: false` so touch scrolling is fully native.** The user's scroll position must always map monotonically to document position. Section-internal `scroll-snap-type: x` on a horizontal card strip is allowed and encouraged — that's a scroller, not the page.

### 5. Copying Vast's code, images, or copy — banned

- **No copy.** Not a headline, not a section label, not a spec-table caption. "Building next-generation space infrastructure" is theirs. ICAROS's copy is Korean and describes ICX-1, ICX-2, and ICX MV.
- **No images.** Nothing from `cdn.prod.website-files.com` or `vast-public.s3.amazonaws.com` ever enters this repo. ICAROS has 15 gallery photos and 6 rocket photos of its own.
- **No fonts.** Owners, Owners Text, Phonic, and Vast Numbers are commercially licensed (MCKL Type / Schick Toikka) and Vast Numbers is bespoke. We use `WdscnUEx` + `Pretendard` + one OFL mono. **Also: confirm the `WidescreenUEx_Trial_*` licence before shipping — those files say "Trial."**
- **No stylesheet lifting.** Class names like `.h-ml`, `.callout-station-*`, `.btn-wipe`, `.eyebrow` are theirs; the *techniques* (clip-path reveal, transform-origin flip, corner-anchored panels, `--motion` multiplier) are general craft and are fair to reimplement in our own naming. The line: **borrow the idea, write the code.**
- **No Haven-1.** No borrowed spec tables, mission-profile diagrams, or lifecycle timelines. Every number on icaros.kr must be an ICAROS measurement.

### 6. Effects that outrank content — banned

The governing rule, and the one that adjudicates every other argument:

- **Nothing animates on top of text a user is trying to read.** No ambient loops inside a paragraph's bounding box.
- **No effect may delay content.** If a reveal means a heading is invisible for 600ms after it enters the viewport, the reveal is wrong. Reveals are `opacity: 0 → 1` over ≤400ms with ≤16px of travel, and content is in the DOM and readable to a crawler and a screen reader from first paint.
- **No load gate.** The loader tracks real asset progress and clears. It never runs a fixed minimum duration to "let the animation play."
- **Never use an effect to hide a content gap.** If a section has one sentence and one photo, ship one sentence and one photo, framed with generous whitespace, a hairline rule, and a mono caption. **A short section presented with confidence reads as editorial restraint; the same section wrapped in a particle field reads as an apology.** This is the whole thesis for ICAROS: the content is honest and sparse, so the design's job is to *frame* it, not to *inflate* it.
- **Every animation must survive `--motion: 0`.** If a section becomes unreadable or unnavigable under `prefers-reduced-motion`, the animation was load-bearing and must be rebuilt.
- **Budget:** at most one "signature" moment per page. Vast has one — the model. Everything else is a 300ms wipe or a 1px line.

---

## What I could NOT verify

Listed plainly so nobody builds on sand.

1. **Which three ScrollTrigger timelines use `scrub: true`**, and specifically whether the homepage station model's camera is scroll-scrubbed. I confirmed `scrub: true` appears 3× and `pin:` 0× in the 1.5 MB minified bundle, but could not attribute the calls to sections. `[UNVERIFIED]` — **this is the single biggest open question for §2**, since it decides whether the ICAROS home model is scroll-driven or self-animating.
2. **The rendered appearance of anything.** I read source, I did not view the sites. Every claim about how something *looks* (the crosshair glyph, the scroll rail's visual form, the model's lighting, the hero video's mask shape) is `[inference]` from CSS/markup.
3. **The `.gsap-scroll` rail's visual design** — I have its geometry (fixed right, 40px wide, z-1500, spring-eased items) but not what the items are.
4. **The Barba page-transition visual** — fade, wipe, or loader reuse. Buried in minified code.
5. **Vast's WebGL scene internals** — model poly counts, lighting rig, whether drei's `<Environment>` uses an HDRI or a studio setup, and how many draw calls. I confirmed the loaders (DRACO, KTX2, meshopt) and that `Environment` is imported; nothing beyond that.
6. **Whether the homepage 3D model actually animates *through* multiple sections** or is confined to its one placeholder. The markup shows a single `.webgl-home-space-station` placeholder on the homepage, which suggests confined — but the fixed full-viewport canvas makes cross-section motion possible. `[inference]`, weakly held.
7. **Hanwha's hotspot/rotate/explode interactions.** The `.mesh-area` camera-framing code is fully confirmed, but the page's 3D bootstrap and any click-to-inspect UI load dynamically (`vendor.js` referenced from within the bundle) and were not in the static HTML. The "rotate/explode" part of the brief is therefore answered from Vast's callout system plus general practice, **not** from Hanwha source.
8. **Hanwha's landscape gate.** `<main data-landscape="true">` is present; the rotate-device UI and its trigger logic are `[inference]`.
9. **`Pretendard`'s `tnum` support.** I recommend `font-variant-numeric: tabular-nums` throughout; Pretendard is Inter-derived so it very likely has it, but I did not open the font tables. 60-second check before relying on it.
10. **The `WidescreenUEx_Trial_*` licence.** The filenames say "Trial." Nine unsubset TTFs (~900 KB) are currently committed to `src/assets/fonts/`. **Someone must confirm this is licensed for web use before launch.** This is a legal blocker, not a design note.
11. **Exact `line-height` on `.team-numbers__large`** — the value was truncated at my extraction boundary. Everything else in that rule is exact.
12. **Vast's `figcaption::before` square color in dark sections.** The rule hardcodes `var(--color--accent--solar-orange)` with no theme override found, but I did not check every `[data-section-theme]` block exhaustively.

---

## Sources

- [Vast Space](https://www.vastspace.com/) — raw HTML + production CSS/JS bundles, 5 pages
- [Vast — Awwwards SOTD](https://www.awwwards.com/sites/vast) — studio credit, scores, stated palette
- [Antinomy Studio](https://www.antinomy.studio/) — the studio behind the Vast site
- [Owners — MCKL Type](https://www.mckltype.com/typefaces/owners) and [Owners Text](https://www.mckltype.com/typefaces/owners-text)
- [Phonic Mono — Schick Toikka](https://www.schick-toikka.com/phonic-mono)
- [Anime.js](https://animejs.com/) — v4 API examples and per-module bundle sizes
- [Hanwha Ocean — 3D Virtual Showroom](https://www.hanwhaocean.com/en/whatwedo/3dsubm/) + `/js/pages/hanwha-ocean.js`
