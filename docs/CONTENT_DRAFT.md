# Content draft — portfolio project entries

> **This is an unreviewed draft. Nothing here has been applied to any database, no
> migration was written, and no API call was made.** It is a document to be corrected,
> not a set of records to be loaded.
>
> Every claim below is traceable to something that is actually in the source repository
> — its README, its `ARCHITECTURE.md`, its changelog, or its file tree. Each entry carries
> a **Sourced from** note saying where, so you can check the draft rather than trust it.
> Where a repo did not tell me something, it is listed under **Needs your input** instead
> of being filled in with plausible-sounding text.
>
> **Next step:** read each entry, correct or delete what's wrong, answer the
> "Needs your input" items, and decide the coursework question in §3. Only after that
> should anything be entered through the admin UI (`POST /projects`) or a seed script.
> This file is documentation; it is not wired to anything.
>
> Drafted 2026-08-07 against GitHub repos owned by `tarka1939`, for issue #49
> (Phase 6 — "Migrate existing projects into the new content model").

---

## 0. Contract constraints these drafts were written against

Read from `docs/DATA_MODEL.md`, `docs/openapi.yaml` (`ProjectWriteRequest`), and
`docs/DECISIONS.md`.

| Field | Limit | Notes |
|---|---|---|
| `title` | 1–200 chars | |
| `description` | 1–5000 chars | |
| `tags` | array of names, each 1–50 chars | matched case-insensitively; **all drafts use lowercase** so `c++` and `C++` can't diverge |
| `links` | max 10 items, `label` ≤ 50, `url` ≤ 500 | |
| `images` | max 20 items, each URL ≤ 500 | **no upload pipeline exists** (`docs/DECISIONS.md`, 2026-07-24) — URLs must already resolve |

Every field in every entry below is within these limits (checked; see §4).

### Four things about the current implementation that shaped the copy

These are observations about `/frontend` as it stands today, not requests — they affect
how the descriptions are written, so they're recorded here.

1. **There is no date/period field on `Project`.** `created_at`/`updated_at` are record
   timestamps, not "when I built this". `SPEC.md` line 11 lists "dates" as in-scope for
   project detail, but `docs/DATA_MODEL.md` has no such column. So any "2024", "finished",
   "paused" has to live inside `description` text. The drafts below do that only where the
   repo gave me a date I can point at.
2. **`description` renders as plain text, not Markdown.** `project-detail.component.html`
   interpolates it into a `<p class="description">` and the SCSS sets `white-space: pre-wrap`.
   So blank lines survive as paragraph breaks, but `**bold**` or `- bullets` would render
   literally. The drafts are plain prose with blank-line paragraph breaks.
3. **The project *list* card renders the full description**, with no clamp
   (`projects-list.component.html` line 35). A 2000-character description will fill the card.
   Each draft's **first paragraph is written to stand alone** as the card summary, in case you
   later clamp the list to one paragraph.
4. **`images[0]` is the list-card thumbnail**, and detail-page alt text is hardcoded to
   `"<title> screenshot N"`. That wording is inaccurate for anything that isn't a screenshot
   — relevant to the Equalizer entry below, which proposes architecture diagrams.

---

## 1. Portfolio candidates

### 1.1 System Equalizer

```yaml
title: System Equalizer
description: |
  A cross-platform, system-level audio equalizer built around a shared C++17 DSP core,
  with three cooperating modules: a real-time audio daemon and a Windows Audio Processing
  Object in C++, a 10-band visualiser and settings GUI in C#/Avalonia, and a Python
  room-correction curve generator.

  The DSP core is platform-agnostic — RBJ peaking biquad filters cascaded into a 10-band
  equalizer, plus an overlap-add FFT block-convolution engine prepared for FIR filtering
  (implemented and unit-tested, but not yet wired into the audio path). Two independent
  hosts link that core: a Windows APO DLL that hooks the Windows Audio Engine through COM,
  and a cross-platform daemon that runs as a PipeWire filter node on Linux and exposes a
  JSON-line IPC socket. The GUI and the Python tool talk only to the daemon.

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
  Windows or macOS. The Equalizer APO export path exists precisely so the curve-generation
  maths can be validated offline while those gaps stand.

  Tests cover the biquad and 10-band cascade maths, the overlap-add engine, the daemon's
  real-time/non-real-time state handoff, the IPC protocol over a real Unix socket, the APO's
  per-block gain and clamp maths, and the whole Python measurement and correction pipeline.
  The GUI has no automated tests and the PipeWire backend is untested; ARCHITECTURE.md says
  so, and says why.
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
  `Equalizer` and has **no repository description set** — the title is the README's, not mine.
- Three modules / languages / per-module purpose: the module table at the top of `README.md`
  (C++17 daemon+DSP, C#/Avalonia GUI, Python 3.11+ CurveGen).
- APO hooks the Windows Audio Engine; Linux daemon uses a PipeWire filter node: `README.md`,
  paragraph under that table.
- Biquad/10-band/overlap-add: `README.md` "Project Structure" tree (`DSP/Biquad`,
  `Equalizer10Band`, `OverlapAdd.{h,cpp}` — annotated there as *"FFT block-convolution engine
  (FIR-filter prep, not yet wired in)"*) and `ARCHITECTURE.md` §2.1–§2.3. "RBJ peaking" is
  `ARCHITECTURE.md` §2.1's own wording.
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
  Daemon not building on Windows/macOS: §7.3.
- Test coverage list and the "GUI has no automated tests / PipeWire untested" admissions:
  `ARCHITECTURE.md` §9 ("Testing strategy: what's covered, what isn't") and the README's
  "Testing" section.
- Images: both SVGs are in the repo at `docs/diagrams/` and are linked from the README's
  "Diagrams" section. **Both verified 2026-08-07:** HTTP 200, `Content-Type: image/svg+xml`,
  ~7 KB and ~9 KB. Each has an opaque white `<rect>` background, so neither will disappear
  against a dark site theme.

**Needs your input**

- **These are diagrams, not screenshots.** The detail page's alt text will call them
  "System Equalizer screenshot 1/2", which is wrong, and `images[0]` becomes the list-card
  thumbnail. Options: keep them, drop them and ship with `images: []`, or replace them with a
  real screenshot of the Avalonia GUI, which the repo does not currently contain.
- **Dates.** First commit 2026-02-25, most recent 2026-07-21, ~15 commits. I did not put a
  date range in the copy because commit dates are when things were pushed, not when the work
  happened, and I can't tell those apart. Tell me the real period.
- **Is it finished, paused, or active?** The known-issues section reads like work in progress,
  but the repo doesn't say. This matters for how the description ends.
- **What was it for?** There is a `report.md` in the repo titled *"Raport Techniczny —
  Equalizer APO"*, written in Polish and structured like an academic report (target platform,
  technologies, libraries, build configuration). That suggests a university or course origin,
  but the README doesn't say so and I am not going to assert it. Was this coursework, a
  personal project, or a personal project that a course report was later written about?
- **Has the §7.1 APO defect been fixed since?** If it has, this description is out of date the
  day it's published. If it hasn't, keeping the honest paragraph is (my opinion) a strength,
  not a liability — but it's your call whether that level of candour belongs on a portfolio.
- **Is there a demo, release, or downloadable build?** No GitHub release, no `homepage` set,
  no binary in the repo. So `links` has only the two above.
- **AI-assistance disclosure.** The repo contains a `CLAUDE.md`. See §3.4.

---

### 1.2 Animal Vision Simulator

```yaml
title: Animal Vision Simulator
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
  human and animal vision"* (typo in the original). See "Needs your input".
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
- **Dates and status.** First commit 2026-07-05, latest 2026-07-06, ~14 commits. The changelog's
  top section is headed `[Unreleased] - 2026-07-06` and `pyproject.toml` says `version = "0.1.0"`
  — so nothing has been released. Is this finished, or paused mid-way? The `[Unreleased]`
  section describes substantial added features (alternate display modes, a cone-novelty
  overlay) which I have **not** described above, because I can't tell whether they're merged
  and working or in-progress notes.
- **What was it for?** Nothing in the repo says whether this was coursework, a personal
  experiment, or something you were asked to build.
- **Is there a demo?** No release, no `homepage`, no packaged build.

---

### 1.3 Counter App

```yaml
title: Counter App
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
  single-purpose utility rather than a framework; its changelog records version 1.0.0 on
  11 June 2026, and the repository has had no commits since.
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
- "version 1.0.0 on 11 June 2026, no commits since": `CHANGELOG.md` heading
  `## [1.0.0] — 2026-06-11`, plus the repo's latest commit date (2026-06-11).
- Image: `docs/Screenshot.png`, embedded at the top of the README. **Verified 2026-08-07:**
  HTTP 200, `image/png`, 66 KB, on branch `master` (this repo's default branch is `master`,
  not `main` — the `main` URL 404s). I opened it: it shows three counter cards ("Eggs in
  fridge" 7, "CVs sent" 80, "Coffee cups drunk today" 4) in a dark theme with the Counter
  Settings dialog open. It matches what the README claims, and it is a genuine screenshot.

**Needs your input**

- **Does this belong on the portfolio at all?** It's a well-made small utility and the
  screenshot is the best visual asset across all six repos, but it is a counter. Including it
  next to System Equalizer invites the comparison. Two defensible positions: include it as
  deliberate range ("I also finish small things properly"), or leave it out. I'd include it —
  it's the only entry that is unambiguously finished — but say so rather than let it look like
  padding.
- **`dist/CounterApp.exe` (13 MB) is committed to the repo.** I did **not** add a download
  link for it, and I'd advise against one: a portfolio site linking an unsigned Windows
  executable is a bad look regardless of what's in it. Worth deciding whether it should stay
  in the repo.
- **Licence mismatch.** The README ends with "## License — MIT", but the repo has **no
  `LICENSE` file** and GitHub reports no licence. See §3.3.
- **The screenshot shows a "Columns: 3" selector** in the top bar that the README's feature
  list doesn't mention. Minor, but the description above doesn't mention it either — I didn't
  want to describe a control I only saw in a picture.
- **Anything since 1.0.0?** The copy says the repo has had no commits since June; if you've
  worked on it locally and not pushed, that sentence is wrong.

---

## 2. University coursework

Drafted separately and clearly labelled, per the brief. **Read §3.1 before deciding whether
to publish any of these.** Each of the three repos has a README whose framing I deliberately
did not carry over — see §3.2.

### 2.1 Algorithms & Data Structures coursework (C++)

```yaml
title: Algorithms & Data Structures coursework (C++)
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
- "Five": the README lists five, and the repo tree has exactly five project directories.

**Needs your input**

- **Dates.** Folder names say 2024 (`Proj_AISD_1_2024`, `AISD_Proj2_2024 Hex`) but the git
  history starts 2026-02-24 — the repo was clearly pushed long after the work was done. I left
  the year out of the copy rather than guess. Which academic year was this?
- **Which course/institution**, if you want that named. The README says only "a core computer
  science university course".
- **Repo hygiene, before linking it publicly.** This repo is ~317 MB. The bulk is committed
  test fixtures — several `.in` files over 800 KB, one at 1.1 MB, plus a 1 MB `tests.rar`
  archive. Anyone who clicks through and clones gets all of it. Worth pruning or documenting.
- **Repo name is in Polish** (`Repozytorium_Projektow_AISD`) while the README is in English.
  Consistent naming would read better next to an English portfolio entry.
- **Images: empty.** Nothing in this repo is visual. If you want a thumbnail, a rendered graph
  or an AVL diagram would have to be produced; I won't invent one.
- **One entry or five?** I drafted these as a single combined entry, on the theory that five
  separate coursework cards would swamp the three real projects. If you'd rather split out the
  Dijkstra route planner (the most demo-able one) as its own entry, say so.

---

### 2.2 Numerical Methods coursework (Python)

```yaml
title: Numerical Methods coursework (Python)
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

**Needs your input**

- **Dates.** No year appears in any filename or the README; git history starts 2026-02-24,
  which again is when it was pushed, not when it was done.
- **Images: empty, but real candidates exist.** `MN_Proj_3/Figure_1.png` through
  `Figure_12.png`, and `MN_Proj_2/MN_Proj_2/Figure_1.png` and `Figure_2.png`, are genuine
  matplotlib outputs of these projects and I verified two of them resolve (HTTP 200,
  `image/png`). I did **not** put them in `images` for two reasons: I can't tell from the
  filenames which figure shows what, so I'd be picking blind; and the ones I opened are
  **labelled in Polish** ("Porównanie interpolacji profilu wysokościowego dla 10 węzłów",
  axes "Odległość"/"Wysokość"), which sits oddly in an English portfolio. If you pick two or
  three and tell me which, they drop straight in. Verified example URL:
  `https://raw.githubusercontent.com/tarka1939/Repozytorium_Projektow_MN/main/MN_Proj_3/Figure_1.png`
- **A units bug in that figure**, spotted while checking it: the x-axis reads "Odległość (km)"
  and runs to 120000 for what is described as a hiking/cycling elevation profile — the values
  look like metres. Your repo, your call, but don't publish that plot as-is.
- **`MN_Proj_1/MN_Proj_1/Document.pdf`** is in the repo and I did not open or describe it.
  If it's the graded report, it might be worth linking; if it's a course handout that isn't
  yours to publish, it probably shouldn't be in a public repo.
- **Polish repo name** with an English README, same as §2.1.

---

### 2.3 Artificial Intelligence lab exercises (Python)

```yaml
title: Artificial Intelligence lab exercises (Python)
description: |
  Six lab exercises from a university Artificial Intelligence course, working up from
  classical search and optimisation to machine learning and reinforcement learning.

  They cover a brute-force solver for the 0/1 knapsack problem benchmarked on small and large
  datasets; a Connect 4 engine with pluggable agents (random, heuristic, and minimax with
  alpha-beta pruning) and human-versus-agent and agent-versus-agent play modes; decision tree
  and random forest classifiers built from scratch and evaluated on the Titanic dataset;
  k-means and k-means++ clustering implemented from scratch and applied to the Iris dataset
  with intra-cluster variance evaluation; a feed-forward neural network written manually in
  NumPy and then reproduced and trained in PyTorch on a two-spirals classification task; and a
  Q-learning agent trained in a FrozenLake environment, with a pygame interface for manual
  play and model save/load between training and test runs.

  These are course labs built on an instructor-supplied scaffold — several folders contain
  provided files such as for_students.py, grading.py and rl_base.py, and the original lab
  archives are committed alongside the solutions — so the boundary between supplied code and
  my own work is not obvious from the repository alone.
tags:
  - python
  - machine-learning
  - reinforcement-learning
  - numpy
  - pytorch
  - coursework
  - university
links:
  - label: GitHub repository
    url: https://github.com/tarka1939/Repozytorium_Labow_SI
images: []
```

**Sourced from**

- The six lab summaries: the README's "Contents" table, one row per lab, including the
  algorithm names, the datasets (Titanic, Iris, two-spirals, FrozenLake) and the agent types.
- The scaffold observation is **from the file tree, not the README**: `Laby SI - 2` contains
  `for_students.py`; `Laby SI - 3` contains `grading.py` and a `Lab 3.zip`; `Laby SI - 4`,
  `5`, `6` and `7` each contain a `Lab*.zip` / `lab5.zip` / `Laby SI - 7.zip`; `Laby SI - 7`
  contains `rl_base.py`, an `envs/` directory and a `gui/assets/` folder of pre-drawn sprites.
  Those are the fingerprints of a handed-out template. I state the observation, not a
  conclusion about how much is yours — only you can say that.

**Needs your input**

- **How much of this is your code?** This is the single biggest blocker on this entry. If the
  substantive algorithm implementations are yours and the scaffolding is the course's, say so
  explicitly and the entry gets much stronger. If some labs are mostly filled-in templates,
  those should not be presented as portfolio work at all.
- **Dates.** Git history starts 2026-02-26. But `Laby SI - 7/saved_models/FrozenLake/QAgent/`
  contains run directories named `run-2025-06-04_10-15-57` and similar — so the training runs,
  at least, happened in June 2025. I did not put a date in the copy; that's an inference from
  directory names, not a stated fact.
- **The README's own structure claim looks wrong.** It says "`Laby SI - 1` contains the initial
  project scaffold used to bootstrap the later labs", but in the tree `Laby SI - 1` is the
  *parent folder* holding labs 2–7, plus a `Laby SI/` folder and `Laby SI.sln`. There is no
  Lab 1 as such. Worth fixing in the repo; I didn't reproduce the claim above.
- **Images: empty.** `Laby SI - 7/saved_models/.../plots.png` files exist (training curves) but
  I don't know which run is representative, and a training curve from a course lab is a thin
  thumbnail. Not proposing any.
- **Polish repo name**, same as §2.1 and §2.2.

---

## 3. Assessment and cross-cutting questions

### 3.1 My honest read on the three coursework repos

You can overrule any of this — but silently including them would deny you the choice, so
here it is plainly.

**`Repozytorium_Projektow_AISD` (Algorithms & Data Structures, C++) — include, as one clearly
labelled coursework entry.** It's the strongest of the three. Hand-written stacks, queues,
vectors, strings, hash maps and an AVL tree, plus shunting-yard parsing, Dijkstra, flood fill
and graph colouring, all validated against fixture files. That is real evidence of
fundamentals, and it's the sort of thing an interviewer can actually ask you about. Its
liabilities are cosmetic and fixable: a 317 MB repo, a Polish name on an English README, and
no visual. Label it as coursework in the title (the draft does) and it costs you nothing.

**`Repozytorium_Projektow_MN` (Numerical Methods, Python) — borderline; include only if you
want a fourth or fifth entry.** The work is legitimate and the MACD backtest is the most
"interesting to a reader" of the three, but it is standard numerical-methods coursework that
every student on that course produced, and the three sub-projects are small. If your portfolio
has three strong entries plus AISD, this adds breadth without adding much. If you're thin on
entries, it earns its place. If you do include it, fix the Polish plot labels and the km/m
axis first, because those are exactly the details a careful reader notices.

**`Repozytorium_Labow_SI` (AI labs, Python) — my recommendation is to leave it out, for now.**
Not because the topics are weak — knapsack through Q-learning is a reasonable sweep — but
because of the authorship problem. The repo carries `for_students.py`, `grading.py`,
`rl_base.py`, pre-drawn pygame sprites, and the original `Lab*.zip` handouts committed
next to the solutions. A reviewer who opens it cannot tell which lines are yours, and the
default assumption for a lab repo with a visible template is not generous. That's a
presentation problem, not necessarily a substance problem — if you can say clearly "I
implemented the minimax agent, the decision tree, the k-means and the Q-learning agent; the
environment and harness were provided", the entry becomes defensible and I'd revise the draft
to say exactly that. Until that sentence exists, publishing it costs more credibility than it
earns. Second-best option if you want it up regardless: publish one lab you're confident is
substantially yours (the Connect 4 minimax agent looks like the best candidate) rather than
all six.

**A note on all three:** titling them as coursework, as the drafts do, is not a hedge — it's
the thing that makes them safe to include. Coursework presented as coursework reads as honest.
The same work presented as a "project" invites someone to discover it was an assignment and
wonder what else was oversold.

### 3.2 Framing I deliberately did not carry over

All three coursework READMEs contain sections headed "Corporate / real-world value",
"Why this repository matters", "Business value" and "Why it matters beyond the classroom",
which map each exercise onto industry applications — a knapsack solver to "budget/portfolio
selection", Connect 4 minimax to "bidding strategy, negotiation bots", MACD to "any
organization building automated trading, risk-signal, or anomaly-detection pipelines".

**I did not reproduce any of that**, and I'd advise against putting it on the site. The
underlying mappings aren't wrong in the abstract, but applied to a graded lab exercise they
overclaim by a wide margin, and an experienced reader spots that framing immediately — at
which point every other claim on the page gets re-read with suspicion. The coursework
descriptions above say what the code does and stop. That's a deliberate choice you should
know I made, and can reverse.

The same instinct is why the Equalizer entry keeps its known-issues paragraph. The most
credible thing across all six repos is that `ARCHITECTURE.md` documents its own defects; that
is worth more on a portfolio than any "business value" paragraph.

### 3.3 Licences — none of the six repos has one

Verified via the GitHub API: all six report no licence. Counter-App's README says "License:
MIT" but there is no `LICENSE` file to back it. Without a licence, the default is that nobody
may legally reuse the code. That's a legitimate choice, but it's usually not the intended one
for a public portfolio, and "no licence" is the kind of thing a technically-minded reviewer
notices. Not a content-draft issue; flagged because this is the moment you're auditing these
repos anyway.

### 3.4 AI-assistance disclosure — a question, not a recommendation

The Equalizer repo contains a `CLAUDE.md`. Several of the six READMEs read as at least partly
LLM-drafted (the "Corporate / real-world value" tables in particular). Meanwhile this site's
own `SPEC.md` describes it as "a deliberate practice ground for multi-agent development
workflows", and Phase 7b plans to publish the agent build log publicly.

So the site is going to be explicit about agent-assisted development for *itself*. Whether the
portfolio entries say anything about how the *linked* projects were built is your call
entirely — I have no view on what the right answer is, and this draft says nothing about it
either way. It's only worth deciding on purpose rather than by omission, because the two
halves of the site will sit next to each other.

### 3.5 Things the model can't express, that you may want to say

- **No date or period field.** Covered in §0. If "2024" or "in progress" matters for any of
  these, it has to be sentence text inside `description` — tell me the values and I'll write
  them in. (The alternative, adding a field, is a data-model and OpenAPI change and therefore
  a different issue than #49.)
- **No ordering field.** The list endpoint has pagination but the model has no explicit sort
  weight, so you can't currently pin System Equalizer to the top. Worth knowing before you
  enter six projects and find they come back in creation order.
- **Image URL stability.** The `images` URLs above point at branch heads
  (`.../main/...`, `.../master/...`). If a file is renamed or moved, the portfolio silently
  breaks. Commit-pinned equivalents are immutable and I verified all three resolve:
  - `https://raw.githubusercontent.com/tarka1939/Counter-App/3c3d2ee0c5c835362506c72354111b4738879660/docs/Screenshot.png`
  - `https://raw.githubusercontent.com/tarka1939/Equalizer/e3113dd1582cd7d7d783a9606d3c1c4717211116/docs/diagrams/dsp_execution_pipeline.svg`
  - `https://raw.githubusercontent.com/tarka1939/Equalizer/e3113dd1582cd7d7d783a9606d3c1c4717211116/docs/diagrams/curvegen_data_flow_pipeline.svg`

  Trade-off: pinned URLs never break but also never pick up an improved screenshot. Your call;
  the drafts use branch URLs as the more forgiving default.

### 3.6 Proposed tag vocabulary

Tags are matched case-insensitively (`docs/openapi.yaml`), so a `React`/`react` split can't
happen — but `c++`/`cpp` or `ml`/`machine-learning` still can, since those are different
strings. Everything above uses lowercase and hyphenated multi-word names. The full set used:

`algorithms`, `audio`, `c#`, `c++`, `colour-science`, `coursework`, `cross-platform`,
`customtkinter`, `data-structures`, `desktop`, `dsp`, `gui`, `image-processing`,
`machine-learning`, `matplotlib`, `numerical-methods`, `numpy`, `python`, `pyside6`,
`pytorch`, `real-time`, `reinforcement-learning`, `university`

That's 23 tags across six projects, which is arguably too many for a six-project site — the
tag filter becomes noise if most tags match one project. Candidates to cut if you want a
tighter set: `customtkinter`, `matplotlib`, `numpy`, `pyside6` (library-level detail that's
already in the description), and possibly `university` (redundant with `coursework`). I left
them in so you can see the full vocabulary and cut deliberately.

---

## 4. Contract compliance check

All six entries were checked against `ProjectWriteRequest` in `docs/openapi.yaml`.

| Entry | title | description | tags | links | images |
|---|---|---|---|---|---|
| System Equalizer | 16 / 200 | 2386 / 5000 | 8, max name 14 | 2 / 10, max URL 64 | 2 / 20, max URL 104 |
| Animal Vision Simulator | 23 / 200 | 2013 / 5000 | 6, max name 16 | 2 / 10, max URL 89 | 0 / 20 |
| Counter App | 11 / 200 | 924 / 5000 | 4, max name 13 | 2 / 10, max URL 65 | 1 / 20, max URL 82 |
| Algorithms & Data Structures coursework (C++) | 45 / 200 | 1624 / 5000 | 5, max name 15 | 1 / 10, max URL 56 | 0 / 20 |
| Numerical Methods coursework (Python) | 37 / 200 | 1202 / 5000 | 6, max name 17 | 1 / 10, max URL 54 | 0 / 20 |
| Artificial Intelligence lab exercises (Python) | 46 / 200 | 1267 / 5000 | 7, max name 22 | 1 / 10, max URL 50 | 0 / 20 |

Counts measured from the YAML blocks above, not estimated; they'll shift as you edit. Every
description is far inside the 5000-character limit and nothing else is near a bound. Every tag
name is lowercase. Every link and image URL in this document was requested and returned
HTTP 200 on 2026-08-07.

The YAML blocks use only `title` / `description` / `tags` / `links` / `images`, which is
exactly `ProjectWriteRequest`'s property set — each block is the request body, with
`description`'s literal block scalar becoming the `\n`-separated string. Nothing else needs
translating.
