import {readFileSync} from "fs"

const sampleRate = 48000
const src = readFileSync(new URL("./breakbeat.js", import.meta.url), "utf8")
const Processor = new Function("sampleRate", src + "\n; return Processor")(sampleRate)

const BLOCK = 128
const run = (proc, seconds, events) => {
    const total = Math.floor(seconds * sampleRate)
    const outL = new Float32Array(BLOCK)
    const outR = new Float32Array(BLOCK)
    let peak = 0, anyNaN = false, pos = 0, maxVoices = 0
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
        }
        maxVoices = Math.max(maxVoices, proc.voices.length)
        pos += BLOCK
    }
    return {peak, anyNaN, maxVoices, voicesLeft: proc.voices.length}
}

const record = (proc, seconds, events) => {
    const total = Math.floor(seconds * sampleRate)
    const out = new Float32Array(total)
    const outL = new Float32Array(BLOCK)
    const outR = new Float32Array(BLOCK)
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

const energyWindow = (buf, fromSec, toSec, sr) => {
    const from = Math.floor(fromSec * sr), to = Math.floor(toSec * sr)
    let energy = 0
    for (let i = from; i < to && i < buf.length; i++) energy += buf[i] * buf[i]
    return energy
}

const stereo = (proc, seconds, events) => {
    const total = Math.floor(seconds * sampleRate)
    const outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK)
    let pos = 0, maxDiff = 0, anyNaN = false, peak = 0
    while (pos < total) {
        outL.fill(0); outR.fill(0)
        for (const ev of events) if (ev.at >= pos && ev.at < pos + BLOCK) ev.fn(proc)
        proc.process([outL, outR], {s0: 0, s1: BLOCK, index: pos / BLOCK, bpm: 120, p0: 0, p1: 0, flags: 5})
        for (let i = 0; i < BLOCK; i++) {
            if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) anyNaN = true
            const d = Math.abs(outL[i] - outR[i]); if (d > maxDiff) maxDiff = d
            const a = Math.max(Math.abs(outL[i]), Math.abs(outR[i])); if (a > peak) peak = a
        }
        pos += BLOCK
    }
    return {maxDiff, anyNaN, peak}
}

let fail = 0
const check = (name, cond, extra = "") => {
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${extra}`)
    if (!cond) fail++
}

// 1) Each drum piece triggers, is finite/bounded/audible and self-culls
const pieceName = {36: "kick", 38: "snare", 39: "clap", 42: "closedHat", 46: "openHat"}
for (const pitch of [36, 38, 39, 42, 46]) {
    const name = pieceName[pitch]
    const p = new Processor()
    const r = run(p, 1.5, [{at: 0, fn: pr => pr.noteOn(pitch, 0.9, 0, 1)}])
    check(`${name} finite`, !r.anyNaN)
    check(`${name} bounded (<=1.0)`, r.peak <= 1.0, `peak=${r.peak.toFixed(3)}`)
    check(`${name} audible (>0.02)`, r.peak > 0.02, `peak=${r.peak.toFixed(3)}`)
    check(`${name} self-culls`, r.voicesLeft === 0, `left=${r.voicesLeft}`)
}

// 2) reset() fast-releases a kick
{
    const p = new Processor()
    const r = run(p, 1.5, [
        {at: 0, fn: pr => pr.noteOn(36, 0.9, 0, 1)},
        {at: sampleRate * 0.1 | 0, fn: pr => pr.reset()}
    ])
    check("reset finite", !r.anyNaN)
    check("reset culls", r.voicesLeft === 0, `left=${r.voicesLeft}`)
}

// 3) Spam 40 hits across all 5 pitches -> cap at 32, finite, bounded
{
    const p = new Processor()
    const pitches = [36, 38, 39, 42, 46]
    const events = []
    for (let n = 0; n < 40; n++) events.push({at: n * 64, fn: pr => pr.noteOn(pitches[n % 5], 0.8, 0, 100 + n)})
    const r = run(p, 2, events)
    check("spam caps at 32 voices", r.maxVoices <= 32, `maxVoices=${r.maxVoices}`)
    check("spam finite/bounded", !r.anyNaN && r.peak <= 1.0, `peak=${r.peak.toFixed(3)}`)
}

// 4) Choke: closed hat cuts off the open-hat tail
{
    const unchoked = record(new Processor(), 0.6, [{at: 0, fn: pr => pr.noteOn(46, 0.9, 0, 1)}])
    const chokedProc = new Processor()
    const choked = record(chokedProc, 0.6, [
        {at: 0, fn: pr => pr.noteOn(46, 0.9, 0, 1)},
        {at: sampleRate * 0.05 | 0, fn: pr => pr.noteOn(42, 0.9, 0, 2)}
    ])
    const eUn = energyWindow(unchoked.out, 0.15, 0.30, sampleRate)
    const eCh = energyWindow(choked.out, 0.15, 0.30, sampleRate)
    check("choke finite/bounded", !unchoked.anyNaN && !choked.anyNaN && unchoked.peak <= 1.0 && choked.peak <= 1.0)
    check("choke cuts open-hat tail (<0.3x)", eCh < 0.3 * eUn,
        `unchoked=${eUn.toExponential(2)} choked=${eCh.toExponential(2)} ratio=${(eCh / Math.max(eUn, 1e-30)).toFixed(3)}`)
}

// 5) Drive: higher drive yields >= peak of lower drive on a fixed kick
{
    const lowProc = new Processor()
    lowProc.paramChanged("drive", 0.1)
    const lowR = run(lowProc, 0.5, [{at: 0, fn: pr => pr.noteOn(36, 0.9, 0, 1)}])
    const highProc = new Processor()
    highProc.paramChanged("drive", 0.9)
    const highR = run(highProc, 0.5, [{at: 0, fn: pr => pr.noteOn(36, 0.9, 0, 1)}])
    check("drive raises peak (high >= low)", highR.peak >= lowR.peak,
        `low=${lowR.peak.toFixed(3)} high=${highR.peak.toFixed(3)}`)
}

// 6) Stereo width: width=0 is exact mono, width=1 decorrelates noise voices
{
    const monoProc = new Processor(); monoProc.paramChanged("width", 0)
    const mono = stereo(monoProc, 0.5, [{at: 0, fn: pr => pr.noteOn(38, 0.9, 0, 1)}])
    check("width=0 exact mono (L==R)", mono.maxDiff === 0, `maxDiff=${mono.maxDiff}`)
    check("width=0 finite/bounded", !mono.anyNaN && mono.peak <= 1.0, `peak=${mono.peak.toFixed(3)}`)
    const wideProc = new Processor(); wideProc.paramChanged("width", 1)
    const wide = stereo(wideProc, 0.5, [{at: 0, fn: pr => pr.noteOn(38, 0.9, 0, 1)}])
    check("width=1 decorrelates snare (L!=R)", wide.maxDiff > 1e-3, `maxDiff=${wide.maxDiff.toExponential(2)}`)
    check("width=1 finite/bounded", !wide.anyNaN && wide.peak <= 1.0, `peak=${wide.peak.toFixed(3)}`)
}

// 7) Anti-alias: extreme drive stays finite/bounded on both channels
{
    const p = new Processor(); p.paramChanged("drive", 1.0)
    const r = stereo(p, 0.5, [{at: 0, fn: pr => pr.noteOn(36, 1.0, 0, 1)}])
    check("max drive finite (both ch)", !r.anyNaN)
    check("max drive bounded (<=1.0)", r.peak <= 1.0, `peak=${r.peak.toFixed(3)}`)
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURE(S)`)
process.exit(fail === 0 ? 0 : 1)
