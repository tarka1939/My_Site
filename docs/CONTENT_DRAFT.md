# Content draft — portfolio project entries

> **This is an unreviewed draft. Nothing here has been applied to any database, no
> migration was written, and no API call was made.** It is a document to be corrected,
> not a set of records to be loaded.
>
> Every claim below is traceable to something that is actually in the source repository
> — its README, its `ARCHITECTURE.md`, its changelog, its file tree, or metadata embedded
> in a file it contains. Each entry carries a **Sourced from** note saying where, so you
> can check the draft rather than trust it. Where a repo did not tell me something, it is
> listed under **Needs your input** instead of being filled in with plausible-sounding text.
>
> **Dates are now mostly settled — one confirmation outstanding.** Four of the five entries
> carry dates you decided; System Equalizer's are **inferred from repo evidence and still
> awaiting your confirmation**, and are marked as such wherever they appear. The two coursework
> entries are blank *by decision*, not for want of evidence — see §5, which is the audit trail.
> Do not read a blank field as an oversight; each one is argued for, and §5.8 lists every gap I
> was tempted to fill and didn't.
>
> **Next step:** read each entry, correct or delete what's wrong, answer the
> "Needs your input" items, and confirm §5.1. Only after that should anything be entered
> through the admin UI (`POST /projects`) or a seed script. This file is documentation;
> it is not wired to anything.
>
> Drafted 2026-08-07 against GitHub repos owned by `tarka1939`, for issue #49
> (Phase 6 — "Migrate existing projects into the new content model").
> **Revised 2026-08-09:** scope cut to five entries (the AI-labs entry removed — see §3.1),
> `startedOn`/`completedOn` added throughout following PR #91, all evidence re-gathered and
> all URLs re-verified. **Updated later the same day** with the owner's date answers —
> §5 now separates what was decided from what is still inferred.

---

## 0. Contract constraints these drafts were written against

Read from `docs/DATA_MODEL.md`, `docs/openapi.yaml` (`ProjectWriteRequest`), and
`docs/DECISIONS.md` (including the 2026-08-08 project-dates ADR).

| Field | Limit | Notes |
|---|---|---|
| `title` | 1–200 chars | |
| `description` | 1–5000 chars | |
| `tags` | array of names, each 1–50 chars | matched case-insensitively; **all drafts use lowercase** so `c++` and `C++` can't diverge |
| `links` | max 10 items, `label` ≤ 50, `url` ≤ 500 | |
| `images` | max 20 items, each URL ≤ 500 | **no upload pipeline exists** (`docs/DECISIONS.md`, 2026-07-24) — URLs must already resolve |
| `startedOn` | `date` (`YYYY-MM-DD`), optional, nullable | null/omitted = **unspecified** |
| `completedOn` | `date` (`YYYY-MM-DD`), optional, nullable | null/omitted = **ongoing**, a meaningful value. 400 if it precedes `startedOn` or is supplied without it |

Every field in every entry below is within these limits (checked; see §4).

### Four things about the current implementation that shaped the copy

These are observations about `/frontend` as it stands today, not requests — they affect
how the descriptions are written, so they're recorded here.

1. **`Project` now has a date period**, added by PR #91 — so "2024" or "in progress" no
   longer has to be smuggled into `description` prose. `ProjectPeriodComponent`
   (`frontend/src/app/shared/project-period/project-period.component.ts`) renders it on both
   the list card and the detail page, and its four states are worth knowing before you fill
   anything in, because **each combination asserts something different**:

   | `startedOn` | `completedOn` | Renders |
   |---|---|---|
   | `2026-01-01` | `2026-06-01` | `January 2026 – June 2026` |
   | `2026-01-01` | *(null)* | `January 2026 – ongoing` |
   | `2026-06-01` | `2026-06-01` | `June 2026` — same month collapses, no `June 2026 – June 2026` |
   | *(null)* | *(null)* | **nothing at all** — no label, no stray dash |

   Two consequences drive every date decision in §5. First, the both-null row is *safe*: an
   entry with no dates says nothing about dates, it does not claim to be ongoing. Second, the
   start-without-end row is *not* safe for finished work — a `startedOn` alone publishes
   "– ongoing", and since the contract also refuses a `completedOn` without a `startedOn`,
   **the two fields are effectively a single decision: fill both, or fill neither.**
   Only ever month/year is shown; the stored day is a storage artefact (the ADR's convention
   is the 1st of the month) and never reaches the page.
2. **`description` renders as plain text, not Markdown.** `project-detail.component.html`
   interpolates it into a `<p class="description">` and the SCSS sets `white-space: pre-wrap`
   (`project-detail.component.scss` line 39). So blank lines survive as paragraph breaks, but
   `**bold**` or `- bullets` would render literally. The drafts are plain prose with
   blank-line paragraph breaks.
3. **The project *list* card renders the full description**, with no clamp
   (`projects-list.component.html` line 49). A 2000-character description will fill the card.
   Each draft's **first paragraph is written to stand alone** as the card summary, in case you
   later clamp the list to one paragraph.
4. **`images[0]` is the list-card thumbnail.** The card's alt text is just the project title,
   but the *detail* page hardcodes `"<title> screenshot N"`
   (`project-detail.component.html` lines 37 and 44). That wording is inaccurate for anything
   that isn't a screenshot — relevant to the Equalizer entry below, which proposes
   architecture diagrams.

---

## 1. Portfolio candidates

### 1.1 System Equalizer

```yaml
title: System Equalizer
startedOn: 2026-01-01   # FLOOR, NOT CONFIRMED — earliest dated artifact in the repo; see §5.1
completedOn:            # CONFIRMED by owner — null = ongoing ("still WIP"); see §5.1
description: |
  A cross-platform, system-level audio equalizer built around a shared C++17 DSP core,
  with three cooperating modules: a real-time audio daemon and a Windows Audio Processing
  Object in C++, a 10-band visualiser and settings GUI in C#/Avalonia, and a Python
  room-correction curve generator.

  The DSP core is platform-agnostic — RBJ peaking biquad filters cascaded into a 10-band
  equalizer, plus an overlap-add FFT block-convolution engine prepared for FIR filtering.
  Two independent hosts link that core: a Windows APO DLL that hooks the Windows Audio
  Engine through COM, and a cross-platform daemon that runs as a PipeWire filter node on
  Linux and exposes a JSON-line IPC socket. The GUI and the Python tool talk only to the
  daemon.

  CurveGen, the Python side, takes a WAV measurement, estimates a power spectral density,
  applies fractional-octave smoothing, inverts the result against a Harman target blend,
  and writes a JSON preset. It can also emit an Equalizer APO configuration file instead,
  and render a four-panel validation report — recorded input, generated curve, expected
  output, and an optional post-correction re-measurement — in both FFT and 1/3-octave views.

  What is and isn't verified is documented rather than glossed over. The repository's
  ARCHITECTURE.md carries a "Known issues and discrepancies" section, written while adding
  tests rather than inferred from the design: the Windows APO path almost certainly never
  applies the configured curve, because LockForProcess() and APOProcess() each declare their
  own function-local static equalizer instance, so the object that gets configured is not the
  object that processes audio. It is flagged high severity and, per that document, unconfirmed
  on real hardware. Windows IPC is a stub at both ends, and the daemon does not build on
  Windows or macOS. The FFT convolution engine is a live stage of the execution pipeline on
  the Linux daemon, but deliberately not on the Windows APO, which still runs the IIR cascade
  alone. The Equalizer APO export path exists precisely so the curve-generation maths can be
  validated offline while those gaps stand.

  Tests cover the biquad and 10-band cascade maths, the overlap-add engine, the combined
  FIR+IIR pipeline's routing rules, the daemon's real-time/non-real-time state handoff, the
  IPC protocol over a real Unix socket, the APO's per-block gain and clamp maths, and the
  whole Python measurement and correction pipeline. The GUI has no automated tests and the
  PipeWire backend is untested; ARCHITECTURE.md says so, and says why.
tags:
  - c++
  - c#
  - python
  - audio
  - dsp
  - real-time
  - cross-platform
  - desktop
links:
  - label: GitHub repository
    url: https://github.com/tarka1939/Equalizer
  - label: Architecture notes
    url: https://github.com/tarka1939/Equalizer/blob/main/ARCHITECTURE.md
images:
  - https://raw.githubusercontent.com/tarka1939/Equalizer/main/docs/diagrams/dsp_execution_pipeline.svg
  - https://raw.githubusercontent.com/tarka1939/Equalizer/main/docs/diagrams/curvegen_data_flow_pipeline.svg
```

**Sourced from**

- Title: the repo README's own H1 is `# System Equalizer`. The GitHub repo is named
  `Equalizer` and has **no repository description set** (re-checked 2026-08-09, `description`
  is null) — the title is the README's, not mine.
- Three modules / languages / per-module purpose: the module table at the top of `README.md`
  (C++17 daemon+DSP, C#/Avalonia GUI, Python 3.11+ CurveGen).
- APO hooks the Windows Audio Engine; Linux daemon uses a PipeWire filter node: `README.md`,
  paragraph under that table.
- Biquad/10-band/overlap-add: `README.md` "Project Structure" tree and `ARCHITECTURE.md`
  §2.1–§2.4. "RBJ peaking" is `ARCHITECTURE.md` §2.1's own wording.
- **Corrected this pass — the FFT engine is wired in now.** The first draft said the
  overlap-add engine was "implemented and unit-tested, but not yet wired into the audio path".
  `ARCHITECTURE.md` §2.3 is headed **"Status: wired in, on the Linux daemon and `WavEqTest`
  only"** and says it is "still **not** wired into the Windows APO … or the WASAPI/CoreAudio
  backends", with `DSP/EqPipeline.{h,cpp}` (§2.4) as the stage that does it and
  `DSP/tests/test_eq_pipeline.cpp` covering the routing. The README's file-tree annotation
  still reads "not yet wired in" (`README.md` line 158) — that line is stale relative to
  `ARCHITECTURE.md`, and the first pass took the README's word for it. **Worth fixing in the
  repo.** Nothing on `main` has changed since 2026-07-21, so this was already true when the
  first draft was written; it was my error, not a repo change.
- "Two independent hosts… GUI and Python tool talk only to the daemon": `ARCHITECTURE.md` §1,
  which states this explicitly as the thing that's "easy to miss".
- JSON-line IPC socket at `/tmp/eq-daemon.sock`: `README.md` "IPC Protocol".
- CurveGen pipeline (PSD, smoothing, inversion, Harman blend, JSON preset): `README.md`
  "Quick Start" + "Project Structure" annotations for `measurement.py` / `flatten.py` /
  `export.py`, and `ARCHITECTURE.md` §6.
- Equalizer APO export and the four-panel FFT + 1/3-octave (CPB) report: `README.md` sections
  "Offline validation via Equalizer APO" and "Visualization".
- The `LockForProcess()` / `APOProcess()` two-statics defect, "HIGH SEVERITY, unconfirmed on
  real hardware": `ARCHITECTURE.md` §7.1, including the code excerpt. Windows IPC stub: §7.2.
  Daemon not building on Windows/macOS: §7.3. (§7 runs to §7.6; the description names the
  three most material.)
- Test coverage list and the "GUI has no automated tests / PipeWire untested" admissions:
  `ARCHITECTURE.md` §9 ("Testing strategy: what's covered, what isn't") and the README's
  "Testing" section.
- Images: both SVGs are in the repo at `docs/diagrams/` and are linked from the README's
  "Diagrams" section. **Re-verified 2026-08-09:** HTTP 200, `Content-Type: image/svg+xml`,
  6,978 and 9,062 bytes — byte-for-byte the same size as on 2026-08-07, so neither has been
  touched. Each has an opaque white `<rect>` background, so neither will disappear against a
  dark site theme.
- Dates: see **§5.1**.

**Needs your input**

- **These are diagrams, not screenshots.** The detail page's alt text will call them
  "System Equalizer screenshot 1/2", which is wrong, and `images[0]` becomes the list-card
  thumbnail. Options: keep them, drop them and ship with `images: []`, or replace them with a
  real screenshot of the Avalonia GUI, which the repo does not currently contain.
- **Status — confirmed ongoing (2026-08-09).** You confirmed the project is still WIP, so
  `completedOn` stays null and the page reads "January 2026 – ongoing". That matches what the
  repo already showed independently: six open items in `ARCHITECTURE.md` §7, a daemon that
  still doesn't build on Windows/macOS, and a final commit that *adds* a feature rather than
  closing one.
- **⚠ `startedOn` is still a floor, not a fact.** The status is settled; the start date isn't.
  `2026-01-01` comes from a report inside the repo dated 29 January 2026 — the earliest dated
  artifact anywhere in it, and a month *before* the first commit, so the work provably predates
  the repository. It is the earliest defensible value, not necessarily the true one. If you
  started in 2025, this is wrong and only you can say so.
- **What was it for?** There is a `report.md` in the repo titled *"Raport Techniczny —
  Equalizer APO"*, written in Polish and structured like an academic report (target platform,
  technologies, libraries, build configuration), signed **"Autor: Krzysztof Tarka, Data:
  29 Styczeń 2026, Wersja: 1.0.0"**. The authorship line is yours, so this is not a handout —
  but the academic-report shape still suggests a university or course origin, and the README
  doesn't say so. Was this coursework, a personal project, or a personal project that a course
  report was later written about?
- **Has the §7.1 APO defect been fixed since?** Still open in `ARCHITECTURE.md` as of
  2026-08-09. If it hasn't been fixed, keeping the honest paragraph is (my opinion) a strength,
  not a liability — but it's your call whether that level of candour belongs on a portfolio.
- **Is there a demo, release, or downloadable build?** No GitHub release, no `homepage` set,
  no binary in the repo. So `links` has only the two above.
- **AI-assistance disclosure.** The repo contains a `CLAUDE.md`. See §3.4.

---

### 1.2 Animal Vision Simulator

```yaml
title: Animal Vision Simulator
startedOn: 2026-07-01   # CONFIRMED by owner — whole repo built 5–6 July 2026; see §5.2
completedOn:            # CONFIRMED by owner — null = ongoing ("WIP but functional"); see §5.2
description: |
  A desktop application that simulates how other animals — and human colour-blindness
  variants — might see a photograph, based on published cone photoreceptor sensitivities.

  Choose a built-in preset (human trichromat baseline, protanopia, deuteranopia, tritanopia,
  achromatopsia, dog, cat, honeybee, or a tetrachromatic blue tit) or build a custom visual
  system from one to four cone types, dragging each cone's peak sensitivity along a
  300–700 nm spectrum bar beneath the preview — the same direct-manipulation idea as a hue
  picker, but positioned by wavelength. The preview re-renders as you drag, downsampled for
  speed; the full-resolution PNG or JPEG is rendered on save.

  The pipeline converts each sRGB pixel to an estimated reflectance spectrum, computes how
  strongly each selected cone type would respond to that spectrum under a daylight-like
  illuminant using the Govardovskii et al. (2000) visual pigment template, and maps the
  resulting cone responses back onto the screen's three channels by wavelength order.

  It is deliberately explicit about what it cannot do. This is an illustrative tool, not a
  colorimetric instrument. Cameras don't record ultraviolet, so the bee and bird presets hold
  the estimated spectrum flat below 400 nm rather than inventing UV detail — the overall
  colour shifts those presets show are real, documented consequences of the cone sensitivities
  involved, but fine UV patterning was never in the photo to recover. Structural and
  iridescent colour depends on lighting and viewing geometry a single flat photo cannot
  capture at all. And a four-cone visual system has to be folded down to three screen
  channels, which is a rendering compromise, not a claim about how the animal experiences
  colour.

  The colour-science engine has no GUI dependency and is covered by unit tests that need no
  display; the GUI tests run under Qt's offscreen platform plugin and skip automatically when
  PySide6 or a native dependency isn't available. Built with Python 3.9+, NumPy, Pillow and
  PySide6.
tags:
  - python
  - pyside6
  - numpy
  - image-processing
  - colour-science
  - desktop
links:
  - label: GitHub repository
    url: https://github.com/tarka1939/Colour-space-correction-for-images
  - label: Architecture notes
    url: https://github.com/tarka1939/Colour-space-correction-for-images/blob/main/ARCHITECTURE.md
images: []
```

**Sourced from**

- Title: the README's H1 is `# Animal Vision Simulator`, and `pyproject.toml` names the package
  `animal-vision-simulator`. **The GitHub repo is named `Colour-space-correction-for-images`**
  and its GitHub description is *"Simple colour space correction app for simulating imapired
  human and animal vision"* (typo in the original; re-checked 2026-08-09, unchanged).
  See "Needs your input".
- Opening sentence: close paraphrase of the README's own first paragraph.
- The preset list, 1–4 cone types, the 300–700 nm spectrum-bar pin interaction, the
  downsampled live preview, bundled samples, and full-resolution save: README "Features".
- The three-step pipeline (sRGB → reflectance → cone response under a daylight-like
  illuminant → RGB by wavelength order) and the Govardovskii et al. (2000) citation:
  README "How it works (short version)".
- All four honesty caveats: README "How accurate is this?" — the UV, iridescence,
  three-screen-channel and unmodified-baseline bullets are the author's own, restated.
- Test-suite behaviour (engine tests display-free, GUI tests offscreen and auto-skipping):
  README "Running the tests".
- Python 3.9+, NumPy, Pillow, PySide6: `pyproject.toml` (`requires-python = ">=3.9"`,
  `dependencies`) and `requirements.txt`.
- Dates: see **§5.2**.

**Needs your input**

- **`images` is deliberately empty.** The repo has three PNGs under `assets/samples/`
  (`color_checker.png`, `color_wheel.png`, `garden_scene.png`). I checked: they resolve
  (HTTP 200, `image/png`). I did **not** use them, because the README describes them as
  *bundled sample input images*, synthetically generated — they are what you feed the app, not
  what it produces. Using one as the portfolio thumbnail would show a colour wheel and imply
  it's a simulation result. This is the entry that most needs a real screenshot, ideally a
  before/after pair exported via the app's own "Save Simulated Image As…". Once such a file is
  in the repo, its raw URL drops straight into `images`.
- **Which repo name wins.** Repo slug, GitHub description, and README title disagree. If the
  portfolio says "Animal Vision Simulator" and the link goes to
  `Colour-space-correction-for-images`, that reads as a mismatch. Renaming the repo (GitHub
  redirects the old URL) or updating the GitHub description would fix it. Also: the current
  GitHub description contains the typo "imapired".
- **The `[Unreleased]` features are merged — I still left them out of the copy, on purpose.**
  Last pass I couldn't tell whether the changelog's `[Unreleased]` block (alternate display
  modes, a cone-novelty overlay, contrast tools, numeric cone entry) described working code or
  in-progress notes. It's working code: commit `2590bc2e` on `main`,
  *"feat: display modes, cone-novelty overlay, contrast tools, and numeric cone entry"*,
  2026-07-06. `[Unreleased]` means untagged, not unmerged. I still didn't describe them,
  because **the README does not mention them** (I searched it for "display mode", "novelty",
  "contrast" — no hits), and every other sentence in this entry is sourced from the README.
  If you want them in the copy, update the README and I'll pull them through.
- **Ongoing — answered, and the copy was left alone on purpose.** You called it *"WIP but
  functional"*, so `completedOn` stays null and the page will read "July 2026 – ongoing". I
  considered adding a "still in development, but usable today" line to the description and
  decided against it, for two reasons worth your disagreement: the copy above already describes
  a working, tested application and nowhere implies a broken prototype, so there is nothing to
  correct; and "ongoing" is exactly what the date field is for — saying it again in prose would
  duplicate the field and read as apologising for the project. The only thing the README would
  support beyond this is that it is at `0.1.0` with an untagged changelog, which is a weaker
  signal than the word "functional" and not obviously worth printing. **If you want "WIP but
  functional" said out loud in the copy, say so and I'll add one clause** — but it should be
  your call, not a liberty taken with a one-word answer.
- **What was it for?** Nothing in the repo says whether this was coursework, a personal
  experiment, or something you were asked to build.
- **Is there a demo?** No release, no `homepage`, no packaged build.

---

### 1.3 Counter App

```yaml
title: Counter App
startedOn: 2026-06-01   # CONFIRMED by owner — see §5.3
completedOn: 2026-06-01 # CONFIRMED by owner — renders as the single month "June 2026"; see §5.3
description: |
  A small desktop utility for keeping several named counters in one window — eggs in the
  fridge, CVs sent, books read, coffee cups.

  Each counter is a card with its own name, increment step (decimals allowed), accent colour
  and start/reset value, plus increment, decrement, reset and undo controls. Undo keeps a
  per-counter history of the last 50 changes. Cards sit in a scrollable grid that reflows when
  the window is resized, and card header text switches between light and dark automatically so
  it stays readable against whichever accent colour was picked.

  State is written to a local counters.json file on every change and restored at launch, so
  there is no database, account or network involved.

  Built with Python 3.10+ and customtkinter, across five small modules. It is a
  single-purpose utility rather than a framework, finished and left finished at version 1.0.0.
tags:
  - python
  - desktop
  - gui
  - customtkinter
links:
  - label: GitHub repository
    url: https://github.com/tarka1939/Counter-App
  - label: Changelog
    url: https://github.com/tarka1939/Counter-App/blob/master/CHANGELOG.md
images:
  - https://raw.githubusercontent.com/tarka1939/Counter-App/master/docs/Screenshot.png
```

**Sourced from**

- Title and opening line: the README's H1 (`# Counter App`) and its first paragraph, including
  the "eggs in fridge / CVs sent / books read / coffee cups" examples, which are the author's.
- Per-counter name, step (decimals, e.g. `0.5`), accent colour, reset, undo, persistence:
  README "Features".
- "last 50 changes" and "smart text contrast on card headers" and "auto-reflow on window
  resize": `CHANGELOG.md` 1.0.0 — the README says "undo the last operation" without the depth;
  the changelog gives the number ("per-counter undo stack, up to 50 entries").
- `counters.json` written on every change and restored at launch: README "Data Storage",
  which also shows the file's shape.
- Python 3.10+ and `customtkinter`: README "Requirements", `pyproject.toml`
  (`requires-python = ">=3.10"`), `requirements.txt`.
- "five small modules": the README's "Project Structure" block lists exactly five
  (`main.py`, `app.py`, `counter_card.py`, `settings_dialog.py`, `persistence.py`).
- **Changed this pass:** the last sentence used to read "its changelog records version 1.0.0
  on 11 June 2026, and the repository has had no commits since". The date now lives in
  `completedOn` instead of the prose, so the sentence was rewritten to carry only the
  judgement ("finished and left finished at version 1.0.0"), not a duplicate date. See §5.3.
- Image: `docs/Screenshot.png`, embedded at the top of the README. **Re-verified 2026-08-09:**
  HTTP 200, `image/png`, 66,162 bytes — identical size to 2026-08-07, unchanged. On branch
  `master` (this repo's default branch is `master`, not `main` — the `main` URL 404s). It shows
  three counter cards ("Eggs in fridge" 7, "CVs sent" 80, "Coffee cups drunk today" 4) in a dark
  theme with the Counter Settings dialog open. It matches what the README claims, and it is a
  genuine screenshot.
- Dates: see **§5.3**.

**Needs your input**

- **Does this belong on the portfolio at all?** You've kept it, so this is settled — but the
  reasoning is worth having on record. It's a well-made small utility and the screenshot is the
  best visual asset across the five repos, and it is also a counter. Including it next to
  System Equalizer invites the comparison. The defensible framing is deliberate range ("I also
  finish small things properly") — it is the only entry that is unambiguously finished, and the
  only one whose date period is fully known.
- **`dist/CounterApp.exe` (13 MB) is committed to the repo.** I did **not** add a download
  link for it, and I'd advise against one: a portfolio site linking an unsigned Windows
  executable is a bad look regardless of what's in it. Worth deciding whether it should stay
  in the repo.
- **Licence mismatch.** The README ends with "## License — MIT", but the repo has **no
  `LICENSE` file** and GitHub reports no licence. See §3.3.
- **The screenshot shows a "Columns: 3" selector** in the top bar that the README's feature
  list doesn't mention. Minor, but the description above doesn't mention it either — I didn't
  want to describe a control I only saw in a picture.
- **Anything since 1.0.0?** The `completedOn: 2026-06-01` above asserts the work finished in
  June 2026. GitHub's `pushed_at` is still 2026-06-11, but if you've worked on it locally and
  not pushed, that assertion is wrong.

---

## 2. University coursework

Drafted separately and clearly labelled, per the brief. Both READMEs have a framing I
deliberately did not carry over — see §3.2.

**Both entries have no dates, and that is now a decision rather than a gap.** Each of these
repos holds several separate projects, each done in **under a month**. An aggregate entry
therefore has no single coherent period to report: a range spanning all of them would describe
a continuous stretch of work that never happened, which is a category error rather than an
approximation. `startedOn` and `completedOn` stay null on both, and the page renders no period
at all. Full reasoning in §5.4 and §5.5, and see §5.6 for what this implies about splitting
them up.

### 2.1 Algorithms & Data Structures coursework (C++)

```yaml
title: Algorithms & Data Structures coursework (C++)
startedOn:              # BLANK by decision — five short projects, no single period; see §5.4
completedOn:            # BLANK by decision — same reason; see §5.4
description: |
  Five graded C++ assignments from a university Algorithms and Data Structures course, each
  solved with hand-written data structures rather than the standard library.

  An RPN calculator parses infix arithmetic, converts it to postfix with the shunting-yard
  algorithm and evaluates it, supporting min, max, if and unary negation, on top of custom
  Stack, Queue, Vector and string containers.

  A Hex board engine parses a serialised board, validates whether the position is legal and
  reachable, detects whether the game is over, and determines whether a given player can force
  a win within N moves.

  A graph and tree toolkit runs classic analyses over both adjacency-matrix and adjacency-list
  representations: degree sequence, connected components, bipartiteness, vertex eccentricity,
  three greedy vertex-colouring heuristics (greedy, largest-first, saturation-largest-first),
  C4-subgraph counting and complement-graph edge counting — alongside a self-balancing AVL
  tree with duplicate-key counting.

  A parser for a CSS-like stylesheet syntax reads selector/attribute/value blocks into custom
  list structures and answers queries against the parsed rules, with no parsing library.

  A route planner builds a weighted graph from an ASCII city map, discovers connectivity by
  flood fill, and answers shortest-path queries between named stops using Dijkstra's algorithm
  over a custom hash map.

  Each is a standalone Visual Studio solution (MSVC v143, x64) and ships with the numbered
  input and expected-output fixtures it was graded against. This is coursework, published as
  evidence of fundamentals rather than as production software.
tags:
  - c++
  - algorithms
  - data-structures
  - coursework
  - university
links:
  - label: GitHub repository
    url: https://github.com/tarka1939/Repozytorium_Projektow_AISD
images: []
```

**Sourced from**

- Every project summary above is a restatement of that project's own section in the repo
  README ("Projects" → the five `###` headings), including the specific algorithm names
  (shunting-yard, Dijkstra, flood fill, AVL, the three colouring heuristics) and the
  custom-container claim.
- "graded… against a fixed set of input/output test cases… enforced by an autograder":
  README "Purpose".
- MSVC v143 / x64 / standalone `.sln`: README "Building".
- Fixture files: confirmed in the file tree (`*.in` / `*.out` / `*_out.txt` per project).
- "Five": the README lists five, and the repo tree has exactly five project directories
  (`Proj_AISD_1_2024`, `AISD_Proj2_2024 Hex`, `AISD_Proj3`, `ProjektAIDS2`,
  `C++_ProjectAIDS_2_JakDojade_Graph_Dijkstra`).
- Dates: see **§5.4** — including a finding that these five may not all be from the same term.

**Needs your input**

- **Dates — settled as blank; see §5.4.** Five separate projects, each under a month, so the
  aggregate has no period to state. The evidence I gathered (2024 in two of five folder names,
  three different Visual Studio versions across the five `.sln` files) is kept in §5.4 as
  findings, not as candidate values.
- **"Each done in under a month" is publishable — but as prose, not as a date.** It says
  something real about scope and pace, and a date field cannot express it. If you want it, it
  belongs in `description`; a candidate clause would be *"each assignment built and graded
  inside a month"*. **I have not added it**, because it's your fact rather than the README's
  and every other sentence in this entry is sourced from the repo. Say the word and it goes in.
- **Which course/institution**, if you want that named. The README says only "a core computer
  science university course" and names the course as AISD (*Algorytmy i Struktury Danych*).
- **Repo hygiene, before linking it publicly.** This repo is ~317 MB (GitHub reports
  `size: 317042` KB). The bulk is committed test fixtures — several `.in` files over 800 KB,
  one at 1.1 MB, plus a 1 MB `tests.rar` archive whose *uncompressed* contents include a
  single 43 MB `.in` file. Anyone who clicks through and clones gets all of it. Worth pruning
  or documenting.
- **Repo name is in Polish** (`Repozytorium_Projektow_AISD`) while the README is in English.
  Consistent naming would read better next to an English portfolio entry.
- **Images: empty.** Nothing in this repo is visual. If you want a thumbnail, a rendered graph
  or an AVL diagram would have to be produced; I won't invent one.
- **One entry or five?** I drafted these as a single combined entry, on the theory that five
  separate coursework cards would swamp the three non-coursework projects. If you'd rather
  split out the Dijkstra route planner (the most demo-able one) as its own entry, say so —
  and note that §5.4's evidence suggests it may be from a different term anyway, which is an
  argument for splitting it.

---

### 2.2 Numerical Methods coursework (Python)

```yaml
title: Numerical Methods coursework (Python)
startedOn:              # BLANK by decision — three short projects, no single period; see §5.5
completedOn:            # BLANK by decision — same reason; see §5.5
description: |
  Three university Numerical Methods projects, each implementing a classical algorithm from
  scratch rather than calling a library, then applying it to a real dataset and plotting or
  benchmarking the result.

  The first implements the MACD indicator from a recursive exponential moving average and uses
  it to drive a simple buy/sell simulation over historical price data, plotting the signal and
  the resulting capital curve.

  The second generates large banded linear systems and solves them three ways — Jacobi
  iteration, Gauss-Seidel iteration and LU factorisation — then benchmarks convergence
  behaviour, residual error and wall-clock time across problem sizes up to roughly 4000
  unknowns, including log-scale comparisons.

  The third reconstructs continuous elevation profiles from sparsely sampled route data using
  Lagrange polynomial interpolation and cubic splines, and compares uniform against Chebyshev
  node placement to show how node choice controls the oscillation that polynomial interpolation
  develops at the edges of its range.

  Written in Python with NumPy, pandas and matplotlib. This is coursework: the algorithms are
  written out longhand to show the mechanics, not tuned for production use.
tags:
  - python
  - numerical-methods
  - numpy
  - matplotlib
  - coursework
  - university
links:
  - label: GitHub repository
    url: https://github.com/tarka1939/Repozytorium_Projektow_MN
images: []
```

**Sourced from**

- All three project summaries: the repo README's "Project 1/2/3" sections, including the named
  algorithms, the "up to ~4000 unknowns" figure, the banded-matrix framing, and the Chebyshev
  /Runge's-phenomenon rationale.
- File-level claims (recursive EMA in `MACD_implementation.py`, the three solver modules,
  `MN_Proj_3.py`) are the README's own file links, and the files exist in the tree.
- Tech stack (NumPy, pandas, matplotlib): README "Tech Stack". I dropped `yfinance`, `ta`,
  `scipy` and `sympy` from the copy — they're listed there as supporting dependencies, and
  naming them adds length without adding signal.
- "coursework… not optimized production code": the README's own "Notes" section says this.
- Dates: see **§5.5** — this is the entry where the evidence got closest to a real answer.

**Needs your input**

- **Dates — settled as blank; see §5.5.** Three separate projects, each under a month. The
  dated artifacts I found (a report PDF created 1 April 2025, a dataset ending 21 March 2025)
  are real and are kept in §5.5, but they date *one* of the three projects, which is precisely
  why the aggregate has no period to report.
- **"Each done in under a month" is publishable — but as prose, not as a date.** Same as §2.1:
  it belongs in `description` if anywhere. A candidate clause: *"three self-contained projects,
  each built inside a month"*. Not added — your fact, your call.
- **`MN_Proj_1/MN_Proj_1/Document.pdf` is yours — that question is now answered.** Last pass
  I flagged it as possibly a course handout that shouldn't be in a public repo. Its embedded
  metadata says `/Author (Krzysztof Tarka)`, `/Creator (Microsoft Word)`, created
  `2025-04-01T05:07:41-07:00`. So it is your own document, presumably the graded report. I
  read the metadata only, not the contents. **Worth linking?** If it's the report you handed
  in, it's the strongest single artifact in this entry — but a PDF link in `links` needs a
  label and I don't know what's inside it, so I have not added one.
- **Images: empty, but real candidates exist.** `MN_Proj_3/Figure_1.png` through
  `Figure_12.png`, and `MN_Proj_2/MN_Proj_2/Figure_1.png` and `Figure_2.png`, are genuine
  matplotlib outputs of these projects; I re-verified `MN_Proj_3/Figure_1.png` on 2026-08-09
  (HTTP 200, `image/png`, 100,155 bytes). I did **not** put them in `images` for two reasons:
  I can't tell from the filenames which figure shows what, so I'd be picking blind; and the
  ones I opened are **labelled in Polish** ("Porównanie interpolacji profilu wysokościowego
  dla 10 węzłów", axes "Odległość"/"Wysokość"), which sits oddly in an English portfolio.
  **This is still a live prerequisite**: if you pick two or three and tell me which, they drop
  straight in, but the labels need translating first. Verified example URL:
  `https://raw.githubusercontent.com/tarka1939/Repozytorium_Projektow_MN/main/MN_Proj_3/Figure_1.png`
- **A units bug in that figure**, spotted while checking it: the x-axis reads "Odległość (km)"
  and runs to 120000 for what is described as a hiking/cycling elevation profile — the values
  look like metres. Confirmed against the source data this pass: `MN_Proj_3/Hel_yeah.csv` and
  the other route CSVs have a `distance,elevation` header with distances running in the tens
  of thousands, i.e. metres. Your repo, your call, but don't publish that plot as-is.
- **Polish repo name** with an English README, same as §2.1.

---

## 3. Assessment and cross-cutting questions

### 3.1 The coursework entries — scope, now settled

**Settled by the owner ahead of this revision:** both remaining coursework repos are in, and
`Repozytorium_Labow_SI` (the Artificial Intelligence lab exercises) is out. The reasoning
behind each, kept short now that the decision is made:

**`Repozytorium_Projektow_AISD` (Algorithms & Data Structures, C++) — in, as one clearly
labelled coursework entry.** The strongest of the coursework repos. Hand-written stacks,
queues, vectors, strings, hash maps and an AVL tree, plus shunting-yard parsing, Dijkstra,
flood fill and graph colouring, all validated against fixture files. That is real evidence of
fundamentals, and it's the sort of thing an interviewer can actually ask you about. Its
liabilities are cosmetic and fixable: a 317 MB repo, a Polish name on an English README, and
no visual. Labelled as coursework in the title, it costs you nothing.

**`Repozytorium_Projektow_MN` (Numerical Methods, Python) — in.** Legitimate work; the MACD
backtest is the most immediately interesting piece. Two things to fix before it ships, both
still open: **the Polish plot labels** (and the km/m axis bug) in §2.2, which are exactly the
details a careful reader notices, and its dates in §5.5.

**`Repozytorium_Labow_SI` (AI labs, Python) — excluded, and not forgotten.** Recorded here so
a future reader doesn't wonder whether it was overlooked: it was drafted in the first pass and
cut on the owner's decision over authorship legibility. The repo commits an instructor-supplied scaffold
(`for_students.py`, `grading.py`, `rl_base.py`, pre-drawn pygame sprites) and the original
`Lab*.zip` handouts next to the solutions, so a reviewer opening it cannot tell which lines
are the author's. That is a presentation problem rather than a substance one, and it is
reversible: if you can state plainly which algorithms you implemented and which harness was
provided, the entry becomes defensible and can be redrafted.

**A note on the two that stayed:** titling them as coursework, as the drafts do, is not a
hedge — it's the thing that makes them safe to include. Coursework presented as coursework
reads as honest. The same work presented as a "project" invites someone to discover it was an
assignment and wonder what else was oversold.

### 3.2 Framing I deliberately did not carry over

Both coursework READMEs map their exercises onto industry applications — AISD under a
"Why it matters beyond the classroom" heading, MN under a per-project **"Business value"**
paragraph plus a closing "Notes" section. MACD becomes "any organization building automated
trading, risk-signal, or anomaly-detection pipelines"; the banded-solver benchmark becomes
"engineering simulation … computer graphics, and large-scale optimization". (The excluded SI
repo did the same thing, harder.)

**I did not reproduce any of that**, and I'd advise against putting it on the site. The
underlying mappings aren't wrong in the abstract, but applied to a graded coursework exercise
they overclaim by a wide margin, and an experienced reader spots that framing immediately — at
which point every other claim on the page gets re-read with suspicion. The coursework
descriptions above say what the code does and stop. That's a deliberate choice you should
know I made, and can reverse.

The same instinct is why the Equalizer entry keeps its known-issues paragraph. The most
credible thing across these repos is that `ARCHITECTURE.md` documents its own defects; that
is worth more on a portfolio than any "business value" paragraph.

### 3.3 Licences — none of the five repos has one

Re-verified via the GitHub API on 2026-08-09: `license` is null for all five. Counter-App's
README says "License: MIT" but there is no `LICENSE` file to back it. Without a licence, the
default is that nobody may legally reuse the code. That's a legitimate choice, but it's usually
not the intended one for a public portfolio, and "no licence" is the kind of thing a
technically-minded reviewer notices. Not a content-draft issue; flagged because this is the
moment you're auditing these repos anyway.

### 3.4 AI-assistance disclosure — a question, not a recommendation

The Equalizer repo contains a `CLAUDE.md`. Both coursework READMEs read as at least partly
LLM-drafted (the "Business value" paragraphs in particular). Meanwhile this site's own
`SPEC.md` describes it as "a deliberate practice ground for multi-agent development
workflows", and Phase 7b plans to publish the agent build log publicly.

So the site is going to be explicit about agent-assisted development for *itself*. Whether the
portfolio entries say anything about how the *linked* projects were built is your call
entirely — I have no view on what the right answer is, and this draft says nothing about it
either way. It's only worth deciding on purpose rather than by omission, because the two
halves of the site will sit next to each other.

### 3.5 Things the model can't express, that you may want to say

- **Dates: now expressible, but mostly unknown.** The field exists as of PR #91, which removes
  the old workaround of writing periods into `description` prose. What it doesn't do is supply
  the values — see §5, which is now the largest open item on #49.
- **No "paused" or "abandoned" state.** The period has exactly two shapes: a closed range, or
  a start with `completedOn` null, which renders the word "ongoing". Work you stopped without
  finishing has to be published as one or the other. This affects §1.1 and §1.2 directly.
- **No ordering field.** The list endpoint has pagination but the model has no explicit sort
  weight, so you can't currently pin System Equalizer to the top. Issue #88 tracks this, and
  the project-dates ADR notes it may be satisfied by sorting on `startedOn`/`completedOn`
  instead — which it can only do for entries that *have* dates. Another reason §5 matters.
- **Image URL stability.** The `images` URLs above point at branch heads
  (`.../main/...`, `.../master/...`). If a file is renamed or moved, the portfolio silently
  breaks. Commit-pinned equivalents are immutable and all three re-verified HTTP 200 on
  2026-08-09, at identical byte sizes to their branch-head equivalents:
  - `https://raw.githubusercontent.com/tarka1939/Counter-App/3c3d2ee0c5c835362506c72354111b4738879660/docs/Screenshot.png`
  - `https://raw.githubusercontent.com/tarka1939/Equalizer/e3113dd1582cd7d7d783a9606d3c1c4717211116/docs/diagrams/dsp_execution_pipeline.svg`
  - `https://raw.githubusercontent.com/tarka1939/Equalizer/e3113dd1582cd7d7d783a9606d3c1c4717211116/docs/diagrams/curvegen_data_flow_pipeline.svg`

  Trade-off: pinned URLs never break but also never pick up an improved screenshot. Your call;
  the drafts use branch URLs as the more forgiving default.

### 3.6 Proposed tag vocabulary

Tags are matched case-insensitively (`docs/openapi.yaml`), so a `React`/`react` split can't
happen — but `c++`/`cpp` or `ml`/`machine-learning` still can, since those are different
strings. Everything above uses lowercase and hyphenated multi-word names. The full set used
across the five entries:

`algorithms`, `audio`, `c#`, `c++`, `colour-science`, `coursework`, `cross-platform`,
`customtkinter`, `data-structures`, `desktop`, `dsp`, `gui`, `image-processing`,
`matplotlib`, `numerical-methods`, `numpy`, `pyside6`, `python`, `real-time`, `university`

That's **20 tags across five projects**, down from 23 across six — dropping the SI entry
removed `machine-learning`, `pytorch` and `reinforcement-learning`, which were unique to it.
Of the 20, **14 match exactly one project**, which makes the tag filter mostly noise; only
`python` (4), `desktop` (3), `c++`, `coursework`, `numpy` and `university` (2 each) group
anything. Candidates to cut if you want a tighter set: `customtkinter`, `matplotlib`, `numpy`,
`pyside6` (library-level detail that's already in the description), and possibly `university`
(redundant with `coursework`). That would leave 15, of which 11 are still singletons — the
noise is inherent to a five-project site, not to the vocabulary. I left the full set in so you
can see it and cut deliberately.

---

## 4. Contract compliance check

All five entries re-measured against `ProjectWriteRequest` in `docs/openapi.yaml` on
2026-08-09, **including the new `startedOn`/`completedOn` fields**. These are fresh counts off
the YAML blocks above, not the previous pass's numbers carried forward — every description
except the coursework pair changed, and the Equalizer one changed materially.

| Entry | title | description | tags | links | images | startedOn | completedOn |
|---|---|---|---|---|---|---|---|
| System Equalizer | 16 / 200 | 2536 / 5000 | 8, max name 14 | 2 / 10, max URL 64, max label 18 | 2 / 20, max URL 104 | `2026-01-01` | *(null → ongoing)* |
| Animal Vision Simulator | 23 / 200 | 2014 / 5000 | 6, max name 16 | 2 / 10, max URL 89, max label 18 | 0 / 20 | `2026-07-01` | *(null → ongoing)* |
| Counter App | 11 / 200 | 872 / 5000 | 4, max name 13 | 2 / 10, max URL 65, max label 17 | 1 / 20, max URL 82 | `2026-06-01` | `2026-06-01` |
| Algorithms & Data Structures coursework (C++) | 45 / 200 | 1625 / 5000 | 5, max name 15 | 1 / 10, max URL 56, max label 17 | 0 / 20 | *(null)* | *(null)* |
| Numerical Methods coursework (Python) | 37 / 200 | 1203 / 5000 | 6, max name 17 | 1 / 10, max URL 54, max label 17 | 0 / 20 | *(null)* | *(null)* |

Measured by parsing each block with a YAML parser and taking `len()` of the resulting string,
then asserting each contract rule rather than eyeballing it. **A methodology note, because it
makes the numbers look one off:** these counts include the trailing newline that a `|` block
scalar always produces, which the 2026-08-07 pass excluded. Every description below is
therefore +1 against last pass's figure for the same text; the old numbers are restated in the
new convention so the deltas are real.

What moved since 2026-08-07: System Equalizer's description went **2387 → 2536** (+149: the FFT
correction plus the extra test-coverage clause), Counter App's went **925 → 872** (−53: the
closing sentence lost its date, which now lives in `completedOn`), and the sixth row — the
AI-labs entry, 1268 chars — is gone. The AISD and MN descriptions are byte-identical to last
pass at 1625 and 1203.

Date-field compliance, checked against the two rules the API enforces with a 400:

- **`completedOn` never precedes `startedOn`.** Counter App is the only entry with both, and
  they are equal, which is permitted — the rule is "must not precede". It renders as the single
  month "June 2026", not a range (§0 item 1).
- **`completedOn` is never supplied without `startedOn`.** The two coursework entries have
  both null, which is legal and renders no period at all. No entry has an end without a start.
- Both values are `YYYY-MM-DD` on the 1st of the month, per the ADR's convention.

Every description is far inside the 5000-character limit and nothing else is near a bound.
Every tag name is lowercase. **Every link and image URL in this document was re-requested on
2026-08-09 and returned HTTP 200** — 15 URLs in total, covering both YAML `links` and `images`
entries, the commit-pinned variants in §3.5, and the MN figure URL in §2.2. Byte sizes were
identical to the 2026-08-07 pass for every image, so **no image URL changed**.

The YAML blocks use only `title` / `description` / `tags` / `links` / `images` / `startedOn` /
`completedOn`, which is exactly `ProjectWriteRequest`'s property set — each block is the request
body, with `description`'s literal block scalar becoming the `\n`-separated string. The only
thing needing translation is the `# PROPOSED` / `# BLANK` comments, which are YAML comments and
disappear on parse; a blank value after the colon parses as null, which is what's intended.
**They must not be treated as approved just because they parse.**

---

## 5. Dates — what was decided, and the evidence behind it

Mostly settled. This section is now an audit trail rather than an open question, with one
exception flagged below.

**Where each value came from — read this before trusting any date on the page:**

| Entry | `startedOn` | `completedOn` | Provenance |
|---|---|---|---|
| System Equalizer | `2026-01-01` | *(null → ongoing)* | **⚠ Inferred by me from repo evidence. Not confirmed by you.** |
| Animal Vision Simulator | `2026-07-01` | *(null → ongoing)* | **Your decision** — "WIP but functional" |
| Counter App | `2026-06-01` | `2026-06-01` | **Your decision** |
| AISD coursework | *(null)* | *(null)* | **Your decision** — several short projects, no single period |
| MN coursework | *(null)* | *(null)* | **Your decision** — same |

The background, stated once: **git history does not record when this work happened.** The
coursework repos were bulk-uploaded years later — `Repozytorium_Projektow_AISD` and
`Repozytorium_Projektow_MN` both consist of an `Initial commit` and an `Initial Upload` about
six minutes apart on 2026-02-24, with a README bolted on in July 2026 — while their folder
names say 2024 and their internal artifacts say 2025. A first-commit date is a **repo creation
date**. It is labelled as such everywhere below and is never used as a work date. The evidence
tables survive because they were the basis for the questions you answered, and because a reader
six months from now should be able to see the working rather than take the dates on faith.

Two structural facts drive the blanks, and neither is "the information was lost":

- **The fields are one decision, not two.** A `startedOn` without a `completedOn` publishes the
  word **"ongoing"**, and the API refuses a `completedOn` without a `startedOn` (§0 item 1). So
  a finished project either gets both or neither; a lone start month would quietly claim the
  work never ended.
- **An aggregate entry covering several short projects has no period to report.** This is the
  coursework case, and it is a category error rather than a measurement problem — see §5.4,
  §5.5 and §5.6.

### 5.1 System Equalizer — `2026-01-01` → ongoing, inferred and awaiting your confirmation

| Evidence | Source | What it supports |
|---|---|---|
| **"Autor: Krzysztof Tarka / Data: 29 Styczeń 2026 / Wersja: 1.0.0"** | signature block at the end of `report.md` in the repo | A report you wrote, dated **29 January 2026**, describing the Windows APO as an existing, built thing. The earliest dated artifact anywhere in the repo. |
| First commit `870f2cb5 "Initial Commit"`, authored 2026-02-25 | `git log --reverse` (via the GitHub commits API) | **Repo creation, not work start.** Note it predates the GitHub repo itself (created 2026-03-24), so the first commit was made locally a month before it was pushed. |
| 15 commits, 2026-02-25 → 2026-07-21, with feature messages ("Add OLA FFT convolution engine", "Wire FFT convolution into the execution pipeline") | commits API | Unlike the coursework repos, this reads as genuine incremental development history. It is decent evidence of *activity* from Feb 2026 on, but says nothing about January or earlier. |
| `Equalizer.sln` records `VisualStudioVersion = 18.3.11520.95` | the file itself | The solution was last saved by a Visual Studio 18.x. A lower bound on *last save*, not on start. I'm not attaching a release date to it — that would be outside knowledge I can't verify from the repo. |

**⚠ This is the only entry whose dates you have not confirmed.** Both values below are mine.
They are on the page as drafted, so if they are wrong they will be wrong in public.

**`startedOn: 2026-01-01`.** Supported by the `report.md` signature and nothing else. It is a
**floor**: the work existed by 29 January 2026, so it started no later than that month. It
could easily have started in 2025 — the report describes a mature APO with a
registry-installation troubleshooting document beside it, which does not read like a month's
work. If you know it started earlier, overwrite this.

**`completedOn`: null, i.e. ongoing.** An inference, reasoned in §5.7, not something you've
said.

### 5.2 Animal Vision Simulator — `2026-07-01` → ongoing (your decision)

| Evidence | Source | What it supports |
|---|---|---|
| All **14 commits** fall between 2026-07-05T14:41Z and 2026-07-06T19:59Z | commits API | A ~29-hour build. The first is `f1db9bb4 "chore: initial commit"`, followed by scaffolding → engine → GUI → docs → fixes, in that order. |
| GitHub repo created 2026-07-05T23:45Z | repo API | *After* the first commit, so again local-first — but only by hours, not months. |
| `CHANGELOG.md`'s only section is `## [Unreleased] - 2026-07-06` | the file | Consistent with the commit window. `pyproject.toml` says `version = "0.1.0"`. |
| No dated artifact anywhere else in the repo | file tree | — |

**This is the one entry where the git history probably *is* the work history.** A scaffold
commit followed within 29 hours by a complete, tested, documented application is what building
something from nothing looks like; there is no sign of a pre-existing codebase being imported.

**`startedOn: 2026-07-01`** → renders "July 2026". Well supported by the evidence and confirmed
by you. The only way this is wrong is if you had the colour-science engine sitting on disk
beforehand.

**`completedOn`: null, i.e. ongoing — you settled this.** Your words: *"WIP but functional"*.
That resolves the coin flip I flagged last pass, and it is the reading the artifacts already
leaned towards: an `[Unreleased]` changelog, `version = "0.1.0"`, and a final commit that added
four substantial features rather than tidying up. The page will read "July 2026 – ongoing".
Note what "ongoing" does *not* say: it doesn't say unfinished-and-unusable. See §1.2's
"Needs your input" for why I left the description's wording alone rather than adding a
"still in development" line.

### 5.3 Counter App — `2026-06-01` → `2026-06-01`, renders "June 2026" (your decision)

| Evidence | Source | What it supports |
|---|---|---|
| All **16 commits** fall between 2026-06-11T09:29Z and 2026-06-11T10:28Z | commits API | Under an hour, start to finish, from `81f9dc8c "init: project scaffold"` to `d2e20db6 "build: add compiled standalone CounterApp.exe"`. |
| `CHANGELOG.md` heading `## [1.0.0] — 2026-06-11` | the file | A dated 1.0.0 release, agreeing with the commits. |
| GitHub `pushed_at` still 2026-06-11 | repo API, re-checked 2026-08-09 | Nothing has been pushed in the two months since. |

**Both fields `2026-06-01`**, confirmed by you and unchanged from the draft. The renderer
collapses that to the single month "June 2026" rather than a range. This is the best-evidenced
entry in the document: a dated release tag, a one-hour commit window, and two months of silence
all agree, and it is the only entry with a closed period.

**Caveat worth one sentence:** 16 commits in 59 minutes is fast enough that some of the code may
have existed locally before the first commit. At month precision that only matters if it began
in May.

### 5.4 AISD coursework — both fields blank, by decision

**The reason is structural, not evidential.** This entry aggregates **five separate projects,
each built in under a month**. There is no single period to report: `2024 – 2024` would compress
five short bursts into one continuous stretch, and any wider range would describe work that
didn't happen in the gaps. That is a category error rather than an approximation, and no amount
of extra archaeology would fix it — even a perfect record of all five start dates would not
produce one honest `startedOn` for the aggregate.

The evidence below is kept because it is real and because it turned up a live question about
these five (see §5.6). **It is no longer offered as candidate values.**

| Evidence | Source | What it supports |
|---|---|---|
| Folder names `Proj_AISD_1_2024` and `AISD_Proj2_2024 Hex` carry **2024** | file tree | The only direct year signal. Covers **two of five** project directories. `AISD_Proj3`, `ProjektAIDS2` and `C++_ProjectAIDS_2_JakDojade_Graph_Dijkstra` carry no year. |
| `.sln` files record three different Visual Studio versions: **17.7.34202.233** (projects 1, 2 and 3), **17.2.32616.157** (the JakDojade Dijkstra planner), **17.0.32014.148** (`ProjektAIDS2`, the CSS parser) | the five `.sln` files themselves | The five solutions were **not all last saved at the same time**, and two of them were last saved by a substantially older Visual Studio than the other three. Whatever "2024" means, it does not obviously cover all five. (VS 17.0/17.2/17.7 release dates are outside knowledge, not repo evidence; the ordering 17.0 < 17.2 < 17.7 is arithmetic and is the part I'm relying on.) |
| `Initial commit` 2026-02-24T22:50Z, `initial upload` 2026-02-24T22:56Z, README added 2026-07-06 | commits API | **Repo creation.** Six minutes of upload, then eighteen months of nothing, then a README. This is an archive push, not development history. |
| `tests.rar` internal file timestamps — **all 2026-07-06T17:39Z** | I parsed the RAR5 headers directly (29 entries, all mtimes within 0.3 s of each other) | **Negative result, reported because I looked.** Archives often preserve original modification times; this one doesn't. The files were re-created when the archive was made for committing, so it carries nothing about the coursework. |
| The README's only "2022" is the string "Visual Studio 2022" | `README.md` "Building" | Flagged so a future search doesn't mistake it for a date. |

**Both fields blank.** The decisive reason is the one above; the evidence adds three
corroborating ones, all pointing the same way:

1. The folder-name "2024" describes two of five projects, and the `.sln` version spread says at
   least two others were last touched noticeably earlier. Even setting the aggregation problem
   aside, a single 2024 period would misdescribe part of the entry.
2. Even for the two 2024 folders, "2024" could be a calendar year or the tail of a 2023/24
   academic year — different `startedOn` months.
3. Graded coursework is *finished*. A `startedOn` alone would publish "2024 – ongoing", which is
   false, and the contract won't accept a `completedOn` without a `startedOn` (§0 item 1).

**Still open, and worth your answer even though the dates are settled:** the `.sln` spread
raises a real question about the *entry*, not its dates — **were all five of these from the same
course instance?** Three of the five solutions carry VS 17.7; the CSS parser carries 17.0 and
the Dijkstra planner 17.2. See §5.6.

### 5.5 MN coursework — both fields blank, by decision

**Same structural reason as §5.4:** this entry aggregates **three separate projects, each built
in under a month**, so there is no coherent period for the aggregate to report.

That is worth stating plainly because this is the repo where the archaeology got closest to a
date, and the temptation was correspondingly strongest. The findings below stand — they are
accurate, and the PDF metadata resolved a separate open question about that file's authorship —
but they date **one of the three projects**, which is exactly the point. A first project dated
to March/April 2025 tells you nothing about when the second and third were done, and stretching
its date over all three would be the category error again. **The `startedOn: 2025-03-01`
candidate floated in the previous revision is withdrawn.**

| Evidence | Source | What it supports |
|---|---|---|
| `Document.pdf` XMP metadata: `<xmp:CreateDate>2025-04-01T05:07:41-07:00</xmp:CreateDate>`, same `ModifyDate`, `/Author (Krzysztof Tarka)`, `/Creator (Microsoft Word)` | embedded metadata of `MN_Proj_1/MN_Proj_1/Document.pdf`; I read the metadata only, not the document body | A Word document **you** authored, exported to PDF on **1 April 2025**. Strongest single date in this repo — and it also settles last pass's open question about whether that file was a handout. It isn't. |
| `data.csv` covers `2000-01-03` → **`2025-03-21`**, 6,343 daily rows | the file's first and last data rows | The MACD dataset was downloaded on or after **21 March 2025**, so Project 1's work is no earlier than that. |
| `.sln` versions: MN_Proj_1 and MN_Proj_2 both `17.11.35312.102`; MN_Proj_3 `17.13.35931.197 d17.13` | the three `.sln` files | Projects 1 and 2 were last saved by the same Visual Studio; Project 3 by a **later** one. That ordering matches the README's numbering, which is a small consistency check that the three were done in sequence. |
| MN_Proj_3's route CSVs (`Hel_yeah.csv`, `profil_etapu.csv`, `100.csv`, …) carry only `distance,elevation` — no dates | I checked three of them | Negative result. Also confirms the metres-vs-km axis bug in §2.2. |
| `Initial commit` + `Initial Upload`, both 2026-02-24T23:12Z; README 2026-07-06 | commits API | **Repo creation.** Same archive-push pattern as §5.4. |

**Candidate: `startedOn: 2025-03-01`** — March 2025 is the earliest month with hard evidence
(the dataset's final row on 21 March, the report exported 1 April). **I did not fill it in**,
for two reasons:

1. It dates *Project 1's report and dataset*, not the start of the coursework. A semester's
   first project is normally started weeks before its report is written, and there are three
   projects here, of which Project 1 is the first. March 2025 is a floor on when the work was
   *visible*, not a start date.
2. More decisively: without a `completedOn` beside it, `2025-03-01` renders **"March 2025 –
   ongoing"** on a finished piece of coursework. There is no evidence at all for an end month —
   the only upper bound is the 2026-02-24 repo upload, eleven months later, which bounds
   nothing useful. Half-filling this pair produces a false statement, so I left both blank.

**What I need from you:** confirm or correct March 2025, and give me the month you finished.
If you confirm both, the entry becomes the second-best-dated in the document.

### 5.6 Ongoing or finished — a separate question, and you may be able to answer it even where the months aren't known

This is a judgement about status, not a date, so it's worth deciding on its own. My read on
each, with the reasoning visible so you can disagree cheaply:

| Entry | My read | Why |
|---|---|---|
| **System Equalizer** | **Ongoing** | `ARCHITECTURE.md` §7 lists six open discrepancies including a high-severity one that is "unconfirmed on real hardware"; the daemon still doesn't build on Windows or macOS (§7.3); and the most recent substantive commit (2026-07-17) *adds* a feature — wiring FFT convolution into the pipeline — rather than closing things off. Three weeks of quiet is not abandonment. Reasonably confident. |
| **Animal Vision Simulator** | **Ongoing, but I'd call this a coin flip** | Points to ongoing: the changelog's newest block is `[Unreleased]`, the version is `0.1.0`, and its final commit added four substantial features rather than tidying up. Points to finished: nothing has moved in a month, and the app is complete and tested as it stands. If the truth is "parked", note that the model has no word for that (§3.5) — you'd publish it either as ongoing or with a `completedOn` of July 2026. **Please pick one.** |
| **Counter App** | **Finished** | A tagged `1.0.0`, a one-hour build, and two months of silence. The README makes no promises. This one is safe. |
| **AISD coursework** | **Finished** | Graded coursework is finished by definition. But "finished" is unpublishable here, because `completedOn` needs a `startedOn` (§5.4). Knowing it's finished doesn't help until you know when. |
| **MN coursework** | **Finished** | Same as above, and same blocker (§5.5). |

Note that **"My Site" itself is not an entry in this document** and should not become one on
the strength of this section — the site is the thing doing the publishing, and whether it
appears in its own portfolio is a separate decision that isn't part of #49.

### 5.7 Everywhere I was tempted to fill a gap and didn't

Recorded so you can audit the judgement, not just the output:

- **AISD `startedOn: 2024-01-01`.** Two folder names say 2024 and it would have looked
  perfectly plausible on the page. Not filled: it covers two of five projects and the `.sln`
  version spread contradicts it for at least two others (§5.4).
- **MN `startedOn: 2025-03-01`.** Genuinely evidenced, and I still left it blank rather than
  publish "March 2025 – ongoing" about finished coursework (§5.5).
- **MN `completedOn: 2025-06-01`.** A Polish spring semester ending in June is a reasonable
  guess and it is *only* a guess — there is no June anywhere in that repo. Not filled.
- **Equalizer `startedOn: 2025-…`.** The January 2026 report describes a mature APO with a
  registry-installation troubleshooting document beside it, which suggests months of prior
  work. Suggests is not evidences. Stayed at the January floor.
- **Deriving dates from GitHub repo `created_at`.** Available for all five and used for none,
  except as an explicit "repo creation" datapoint. For AISD it would have produced February
  2024 — off by about the whole project.
- **Filling `completedOn` from a repo's last-push date.** Available for all five, meaningless
  for all five: a last push is when you stopped touching the repo, not when the work ended.
- **Day-precision values.** The ADR forbids them in rendering; I'd add that even the day I
  stored would be fictional. Everything is the 1st of the month, per the convention.
