import {readFileSync} from "fs"

const sampleRate = 48000
const src = readFileSync(new URL("./shamisen.js", import.meta.url), "utf8")
const Processor = new Function("sampleRate", src + "\n; return Processor")(sampleRate)

const BLOCK = 128
const run = (proc, seconds, events) => {
    const total = Math.floor(seconds * sampleRate)
    const outL = new Float32Array(BLOCK)
    const outR = new Float32Array(BLOCK)
    let peak = 0, anyNaN = false, pos = 0, maxVoices = 0
    let energyEarly = 0, energyLate = 0
    while (pos < total) {
        outL.fill(0); outR.fill(0)
        for (const ev of events) {
            if (ev.at >= pos && ev.at < pos + BLOCK) ev.fn(proc)
        }
        proc.process([outL, outR], {s0: 0, s1: BLOCK, index: pos / BLOCK, bpm: 120, p0: 0, p1: 0, flags: 5})
        for (let i = 0; i < BLOCK; i++) {
            const l = outL[i]
            if (!Number.isFinite(l)) anyNaN = true
            const a = Math.abs(l)
            if (a > peak) peak = a
            if (pos < sampleRate * 0.2) energyEarly += l * l
            if (pos > total - sampleRate * 0.3) energyLate += l * l
        }
        maxVoices = Math.max(maxVoices, proc.voices.length)
        pos += BLOCK
    }
    return {peak, anyNaN, maxVoices, voicesLeft: proc.voices.length, energyEarly, energyLate}
}

let fail = 0
const check = (name, cond, extra = "") => {
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${extra}`)
    if (!cond) fail++
}

// 1) Single gated note (no noteOff): must be finite, bounded, decay to silence and self-cull
{
    const p = new Processor()
    const r = run(p, 4, [{at: 0, fn: pr => pr.noteOn(57, 0.9, 0, 1)}])
    check("single note finite", !r.anyNaN)
    check("single note bounded (<1.0 after tanh)", r.peak <= 1.0, `peak=${r.peak.toFixed(3)}`)
    check("single note has signal", r.peak > 0.05, `peak=${r.peak.toFixed(3)}`)
    check("single note decays", r.energyLate < r.energyEarly * 1e-3,
        `early=${r.energyEarly.toExponential(2)} late=${r.energyLate.toExponential(2)}`)
    check("single note self-culls", r.voicesLeft === 0, `left=${r.voicesLeft}`)
}

// 2) Pitch sweep across the range: every note finite & bounded (tuning stability / no blow-up)
{
    let ok = true, worstPeak = 0
    for (let pitch = 24; pitch <= 96; pitch += 6) {
        const p = new Processor()
        const r = run(p, 1.0, [{at: 0, fn: pr => pr.noteOn(pitch, 0.8, 0, 1)}])
        if (r.anyNaN || r.peak > 1.0 || r.peak < 0.02) ok = false
        worstPeak = Math.max(worstPeak, r.peak)
    }
    check("pitch sweep 24..96 all finite/bounded/audible", ok, `worstPeak=${worstPeak.toFixed(3)}`)
}

// 3) Chord (polyphony) + noteOff release  (glide must be 0 for chords)
{
    const p = new Processor()
    p.paramChanged("glide", 0)
    const r = run(p, 3, [
        {at: 0, fn: pr => pr.noteOn(50, 0.9, 0, 1)},
        {at: 0, fn: pr => pr.noteOn(57, 0.9, 0, 2)},
        {at: 0, fn: pr => pr.noteOn(62, 0.9, 0, 3)},
        {at: sampleRate, fn: pr => pr.noteOff(1)},
        {at: sampleRate, fn: pr => pr.noteOff(2)},
        {at: sampleRate, fn: pr => pr.noteOff(3)}
    ])
    check("chord finite", !r.anyNaN)
    check("chord bounded", r.peak <= 1.0, `peak=${r.peak.toFixed(3)}`)
    check("chord max voices == 3", r.maxVoices === 3, `maxVoices=${r.maxVoices}`)
    check("chord released & culled", r.voicesLeft === 0, `left=${r.voicesLeft}`)
}

// 4) Voice steal cap (spam 40 notes -> never exceed 16 voices, stays finite)
{
    const p = new Processor()
    const events = []
    for (let n = 0; n < 40; n++) events.push({at: n * 64, fn: pr => pr.noteOn(40 + (n % 24), 0.7, 0, 100 + n)})
    const r = run(p, 2, events)
    check("voice steal caps at 16", r.maxVoices <= 16, `maxVoices=${r.maxVoices}`)
    check("spam finite/bounded", !r.anyNaN && r.peak <= 1.0, `peak=${r.peak.toFixed(3)}`)
}

// 5) reset() fast-releases everything
{
    const p = new Processor()
    const r = run(p, 1, [
        {at: 0, fn: pr => pr.noteOn(57, 0.9, 0, 1)},
        {at: sampleRate * 0.3 | 0, fn: pr => pr.reset()}
    ])
    check("reset finite & culls", !r.anyNaN && r.voicesLeft === 0, `left=${r.voicesLeft}`)
}

// --- glide helpers ---
const record = (proc, seconds, events) => {
    const total = Math.floor(seconds * sampleRate)
    const out = new Float32Array(total)
    const outR = new Float32Array(BLOCK)
    const outL = new Float32Array(BLOCK)
    let pos = 0, maxVoices = 0, anyNaN = false, peak = 0
    while (pos < total) {
        outL.fill(0); outR.fill(0)
        for (const ev of events) if (ev.at >= pos && ev.at < pos + BLOCK) ev.fn(proc)
        proc.process([outL, outR], {s0: 0, s1: BLOCK, index: pos / BLOCK, bpm: 120, p0: 0, p1: 0, flags: 5})
        for (let i = 0; i < BLOCK && pos + i < total; i++) {
            const l = outL[i]
            if (!Number.isFinite(l)) anyNaN = true
            const a = Math.abs(l); if (a > peak) peak = a
            out[pos + i] = l
        }
        maxVoices = Math.max(maxVoices, proc.voices.length)
        pos += BLOCK
    }
    return {out, maxVoices, anyNaN, peak}
}
const detectPitch = (buf, atSec, sr, fmin = 70, fmax = 700) => {
    const start = Math.floor(atSec * sr)
    const len = 2048
    const lagMin = Math.floor(sr / fmax), lagMax = Math.floor(sr / fmin)
    let bestLag = lagMin, best = -Infinity
    for (let lag = lagMin; lag <= lagMax; lag++) {
        let sum = 0
        for (let i = 0; i < len; i++) sum += buf[start + i] * buf[start + i + lag]
        if (sum > best) { best = sum; bestLag = lag }
    }
    return sr / bestLag
}
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12)
const near = (a, b, tol = 0.06) => Math.abs(a - b) / b < tol

// 6) Legato glide: A2 -> A3 should slide continuously to the target pitch, staying mono
{
    const p = new Processor()
    p.paramChanged("glide", 0.10)
    const r = record(p, 1.0, [
        {at: 0, fn: pr => pr.noteOn(45, 0.9, 0, 1)},
        {at: sampleRate * 0.25 | 0, fn: pr => pr.noteOn(57, 0.9, 0, 2)}
    ])
    const fStart = detectPitch(r.out, 0.12, sampleRate)
    const fMid = detectPitch(r.out, 0.30, sampleRate)
    const fEnd = detectPitch(r.out, 0.60, sampleRate)
    check("glide finite/bounded", !r.anyNaN && r.peak <= 1.0, `peak=${r.peak.toFixed(3)}`)
    check("glide is monophonic (1 voice)", r.maxVoices === 1, `maxVoices=${r.maxVoices}`)
    check("glide starts ~A2 (110Hz)", near(fStart, hz(45)), `f=${fStart.toFixed(1)} want=${hz(45).toFixed(1)}`)
    check("glide ends ~A3 (220Hz)", near(fEnd, hz(57)), `f=${fEnd.toFixed(1)} want=${hz(57).toFixed(1)}`)
    check("glide actually moves (mid between)", fMid > fStart * 1.05 && fMid < fEnd * 0.98,
        `start=${fStart.toFixed(1)} mid=${fMid.toFixed(1)} end=${fEnd.toFixed(1)}`)
}

// 7) Staccato (non-overlapping) with glide on still retriggers fresh (no unwanted slide)
{
    const p = new Processor()
    p.paramChanged("glide", 0.12)
    const r = record(p, 1.2, [
        {at: 0, fn: pr => pr.noteOn(57, 0.9, 0, 1)},
        {at: sampleRate * 0.3 | 0, fn: pr => pr.noteOff(1)},
        {at: sampleRate * 0.5 | 0, fn: pr => pr.noteOn(45, 0.9, 0, 2)}
    ])
    const fEnd = detectPitch(r.out, 0.9, sampleRate)
    check("staccato retriggers (no glide leftover)", near(fEnd, hz(45)), `f=${fEnd.toFixed(1)} want=${hz(45).toFixed(1)}`)
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURE(S)`)
process.exit(fail === 0 ? 0 : 1)
