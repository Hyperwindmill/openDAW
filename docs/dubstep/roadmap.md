# Dubstep Instruments — Build Roadmap

A curated set of Apparat `Processor` instruments to cover a dubstep palette, ordered
from **open / talking** sounds → **growls** → **impacts**. Each entry is one
self-contained `.js` in `packages/app/studio/src/my-instruments/` (see the root
`CLAUDE.md` "openDAW Apparat instruments" section for how a file becomes a preset).

**Status:** ✅ done · 🔜 next · ⏳ planned · 💭 stretch
**Difficulty:** S small · M medium · L large

---

## Foundation (done)

| Sound | Type | Notes |
|-------|------|-------|
| **Dubstep Drone** ✅ | Reese + Wobble | Detuned saws → resonant LP wobble (LFO), pre-filter drive, steady sub, stereo, resonant peak. |
| **Breakbeat Kit** ✅ | Drums | Synth GM kit (kick/snare/clap/closed+open hat), choke group. |

---

## Phase 1 — Talking / open (formant)

The "vocal", more **open** sounds: a rich source through movable formant (vowel)
filters. Less aggressive than a growl, more articulate.

### 1. Vowel Bass ("Talking") 🔜 · M
- **Sound:** bass/lead that pronounces vowels (a-e-i-o-u); the "talking" timbre.
- **Synthesis:** saw/pulse source → 3 parallel bandpass formant filters whose center
  frequencies morph between vowel presets; a `vowel` param scrubs the morph, an LFO
  (sync to wobble) can animate it.
- **Key params:** `vowel` (morph), `morphLFO` (Hz), `morphDepth`, `tone`, `drive`,
  `sub`, `volume`.
- **Reuse:** formant bandpass bank = same SVF math already used in `shamisen.js` body
  modes and `dubstep_drone.js` filter.

### 2. Yoi Bass ⏳ · S (variant of #1)
- **Sound:** per-note vowel **glide** (e.g. i→o = "yoi", e→a = "wow").
- **Synthesis:** Vowel Bass engine + a per-note formant envelope/glide between two
  vowel targets. Likely a `mode`/`glide` param on #1 rather than a separate file.

---

## Phase 2 — Growls (aggressive)

The core of modern dubstep: metallic, clangy, screaming basses.

### 3. FM Growl 🔜 · M
- **Sound:** clangy/metallic "growl" (Skrillex-style). Bite from FM, not just filtering.
- **Synthesis:** 2-op FM (carrier + modulator, `ratio` + `index`); modulate `index`
  with an LFO and/or velocity for movement; → formant emphasis → drive.
- **Key params:** `ratio`, `index`, `indexLFO` (Hz), `indexDepth`, `formant`, `drive`,
  `sub`, `volume`.

### 4. Screech / Tearout 💭 · M
- **Sound:** high, screaming, lacerating lead.
- **Synthesis:** hard-sync oscillator (master vs slave freq, `syncRatio`), sync ratio
  modulated by LFO/env, → heavy waveshaper, higher register.
- **Key params:** `syncRatio`, `syncLFO`, `syncDepth`, `drive`, `tone`, `volume`.

### 5. Neuro Bass 💭 · L
- **Sound:** complex, evolving, multiband-processed growl (neurofunk crossover).
- **Synthesis:** growl source → split into 3 bands → per-band distortion/processing →
  recombine. Heaviest item; build after FM Growl is solid.

---

## Phase 3 — Impacts & hits

One-shot punctuation for drops and transitions.

### 6. Impact / Boom 🔜 · S
- **Sound:** the drop hit — deep boom + transient.
- **Synthesis:** sine with a fast downward pitch envelope (e.g. 120→40 Hz) + filtered
  noise burst + short decaying tail; light drive. One-shot (ignore noteOff, ring out).
- **Key params:** `tune`, `pitchDrop`, `decay`, `noise`, `drive`, `volume`.

### 7. Braam ⏳ · M
- **Sound:** cinematic, brassy, grave hit (trailer-style).
- **Synthesis:** detuned saws + sub, slow-ish attack, lowpass + drive, longer release.
- **Key params:** `tune`, `attack`, `release`, `brightness`, `drive`, `sub`, `volume`.

---

## Optional appendix — transition FX (💭)

- **Riser / Uplifter** — pitched/filtered noise sweep that rises into the drop.
- **Downlifter** — falling sweep after the drop.
- **Noise Sweep / Reverse Cymbal** — filtered noise / reversed-envelope shimmer.

---

## Suggested build order

1. **Vowel Bass** (Phase 1) — opens up the "talking" range.
2. **FM Growl** (Phase 2) — the central aggressive bass.
3. **Impact / Boom** (Phase 3) — fast win, needed for drops.
4. **Braam** — pairs with Impact for drop hits.
5. Then **Yoi** (extend Vowel Bass), **Screech**, and finally **Neuro Bass**.
