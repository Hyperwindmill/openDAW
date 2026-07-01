import {readFileSync} from "fs"

const sampleRate = 48000
const src = readFileSync(new URL("./vowel_bass.js", import.meta.url), "utf8")
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

// 1) Sustained note: finite, bounded, audible
{
    const p = new Processor()
    const r = record(p, 1.0, [{at: 0, fn: pr => pr.noteOn(33, 0.9, 0, 1)}])
    check("finite", !r.anyNaN)
    check("bounded (<=1)", r.peak <= 1.0, `peak=${r.peak.toFixed(3)}`)
    check("audible", r.peak > 0.05, `peak=${r.peak.toFixed(3)}`)
}
// 2) noteOff releases and culls
{
    const p = new Processor()
    const r = record(p, 1.5, [
        {at: 0, fn: pr => pr.noteOn(33, 0.9, 0, 1)},
        {at: sampleRate * 0.5 | 0, fn: pr => pr.noteOff(1)}
    ])
    check("releases & culls", p.voices.length === 0, `left=${p.voices.length}`)
    check("release finite/bounded", !r.anyNaN && r.peak <= 1.0)
}
// 3) Vowel morph changes timbre (different spectral content at vowel=0 vs vowel=4)
{
    const p0 = new Processor()
    p0.paramChanged("morphLFO", 0)
    p0.paramChanged("vowel", 0)
    const r0 = record(p0, 0.8, [{at: 0, fn: pr => pr.noteOn(48, 0.9, 0, 1)}])
    const p4 = new Processor()
    p4.paramChanged("morphLFO", 0)
    p4.paramChanged("vowel", 4)
    const r4 = record(p4, 0.8, [{at: 0, fn: pr => pr.noteOn(48, 0.9, 0, 1)}])
    let energy0 = 0, energy4 = 0
    for (let i = 0; i < r0.out.length; i++) { energy0 += r0.out[i] * r0.out[i]; energy4 += r4.out[i] * r4.out[i] }
    check("vowel morph changes output", Math.abs(energy0 - energy4) / Math.max(energy0, energy4) > 0.05,
        `e0=${energy0.toExponential(2)} e4=${energy4.toExponential(2)}`)
}
// 4) morphLFO modulates amplitude
{
    const frame = 256
    const p = new Processor()
    p.paramChanged("morphLFO", 6)
    p.paramChanged("morphDepth", 0.8)
    const r = record(p, 1.5, [{at: 0, fn: pr => pr.noteOn(48, 0.9, 0, 1)}])
    const env = []
    for (let i = 0; i + frame <= r.out.length; i += frame) {
        let s = 0
        for (let j = 0; j < frame; j++) s += r.out[i + j] * r.out[i + j]
        env.push(Math.sqrt(s / frame))
    }
    const steady = env.slice(Math.floor(env.length * 0.2))
    const mx = Math.max(...steady), mn = Math.min(...steady)
    const depth = (mx - mn) / Math.max(mx, 1e-10)
    check("morphLFO modulates", depth > 0.05, `depth=${(depth * 100).toFixed(0)}%`)
}
// 5) Poly + reset
{
    const p = new Processor()
    const r = record(p, 0.6, [
        {at: 0, fn: pr => pr.noteOn(33, 0.8, 0, 1)},
        {at: 0, fn: pr => pr.noteOn(40, 0.8, 0, 2)},
        {at: 0, fn: pr => pr.noteOn(45, 0.8, 0, 3)},
        {at: sampleRate * 0.3 | 0, fn: pr => pr.reset()}
    ])
    check("chord max voices == 3", r.maxVoices === 3, `maxVoices=${r.maxVoices}`)
    check("reset culls all", p.voices.length === 0, `left=${p.voices.length}`)
    check("chord finite/bounded", !r.anyNaN && r.peak <= 1.0, `peak=${r.peak.toFixed(3)}`)
}
// 6) Stereo width decorrelates channels; width=0 is exact mono
{
    const runStereo = (width) => {
        const p = new Processor()
        p.paramChanged("width", width)
        p.paramChanged("morphLFO", 6)
        p.paramChanged("morphDepth", 0.8)
        const total = Math.floor(0.8 * sampleRate)
        const outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK)
        let pos = 0, diff = 0, sawNote = false
        while (pos < total) {
            outL.fill(0); outR.fill(0)
            if (!sawNote) { p.noteOn(48, 0.9, 0, 1); sawNote = true }
            p.process([outL, outR], {s0: 0, s1: BLOCK, index: pos / BLOCK, bpm: 140, p0: 0, p1: 0, flags: 5})
            for (let i = 0; i < BLOCK && pos + i < total; i++) diff = Math.max(diff, Math.abs(outL[i] - outR[i]))
            pos += BLOCK
        }
        return diff
    }
    check("width>0 decorrelates L!=R", runStereo(0.8) > 1e-4, `maxDiff=${runStereo(0.8).toFixed(4)}`)
    check("width=0 exact mono L==R", runStereo(0) === 0, `maxDiff=${runStereo(0).toExponential(2)}`)
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURE(S)`)
process.exit(fail === 0 ? 0 : 1)