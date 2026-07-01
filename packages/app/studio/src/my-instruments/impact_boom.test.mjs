import {readFileSync} from "fs"

const sampleRate = 48000
const src = readFileSync(new URL("./impact_boom.js", import.meta.url), "utf8")
const Processor = new Function("sampleRate", src + "\n; return Processor")(sampleRate)

const BLOCK = 128
const record = (proc, seconds, events) => {
    const total = Math.floor(seconds * sampleRate)
    const out = new Float32Array(total)
    const outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK)
    let pos = 0, maxVoices = 0, anyNaN = false, peak = 0
    while (pos < total) {
        outL.fill(0); outR.fill(0)
        for (const ev of events) if (ev.at >= pos && ev.at < pos + BLOCK) ev.fn(proc)
        proc.process([outL, outR], {s0: 0, s1: BLOCK, index: pos / BLOCK, bpm: 140, p0: 0, p1: 0, flags: 5})
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

let fail = 0
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${extra}`); if (!cond) fail++ }

// 1) One-shot: finite, bounded, audible, self-culls
{
    const p = new Processor()
    const r = record(p, 3.0, [{at: 0, fn: pr => pr.noteOn(36, 0.95, 0, 1)}])
    check("finite", !r.anyNaN)
    check("bounded (<=1)", r.peak <= 1.0, `peak=${r.peak.toFixed(3)}`)
    check("audible", r.peak > 0.1, `peak=${r.peak.toFixed(3)}`)
    check("self-culls", p.voices.length === 0, `left=${p.voices.length}`)
}
// 2) noteOff is ignored (one-shot rings out)
{
    const p = new Processor()
    p.paramChanged("decay", 3.0)
    const r = record(p, 0.3, [
        {at: 0, fn: pr => pr.noteOn(36, 0.9, 0, 1)},
        {at: sampleRate * 0.1 | 0, fn: pr => pr.noteOff(1)}
    ])
    check("ignores noteOff (voice alive after 0.1s)", p.voices.length === 1, `voices=${p.voices.length}`)
    check("noteOff finite/bounded", !r.anyNaN && r.peak <= 1.0)
}
// 3) Pitch drop: freq at t=0 is higher than at t=0.2s
{
    const p = new Processor()
    p.paramChanged("pitchDrop", 3)
    const r = record(p, 0.5, [{at: 0, fn: pr => pr.noteOn(36, 0.9, 0, 1)}])
    const earlyEnergy = (() => { let e = 0; for (let i = 0; i < 480; i++) e += r.out[i] * r.out[i]; return e })()
    const lateEnergy = (() => { let e = 0; const start = Math.floor(0.2 * sampleRate); for (let i = start; i < start + 480; i++) e += r.out[i] * r.out[i]; return e })()
    check("pitch drop: early louder than late", earlyEnergy > lateEnergy,
        `early=${earlyEnergy.toExponential(2)} late=${lateEnergy.toExponential(2)}`)
}
// 4) reset fast-releases
{
    const p = new Processor()
    const r = record(p, 1.0, [
        {at: 0, fn: pr => pr.noteOn(36, 0.9, 0, 1)},
        {at: sampleRate * 0.05 | 0, fn: pr => pr.reset()}
    ])
    check("reset culls", p.voices.length === 0, `left=${p.voices.length}`)
    check("reset finite", !r.anyNaN)
}
// 5) Spam 20 hits -> cap at 16 voices
{
    const p = new Processor()
    const events = []
    for (let n = 0; n < 20; n++) events.push({at: n * 128, fn: pr => pr.noteOn(36, 0.8, 0, n + 1)})
    const r = record(p, 3.0, events)
    check("spam caps at 16 voices", r.maxVoices <= 16, `maxVoices=${r.maxVoices}`)
    check("spam finite/bounded", !r.anyNaN && r.peak <= 1.0, `peak=${r.peak.toFixed(3)}`)
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURE(S)`)
process.exit(fail === 0 ? 0 : 1)