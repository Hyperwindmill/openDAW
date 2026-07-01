import {readFileSync} from "fs"

const sampleRate = 48000
const src = readFileSync(new URL("./neuro_bass.js", import.meta.url), "utf8")
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
// 3) indexLFO modulates timbre
{
    const frame = 256
    const p = new Processor()
    p.paramChanged("indexLFO", 6)
    p.paramChanged("indexDepth", 0.8)
    const r = record(p, 1.5, [{at: 0, fn: pr => pr.noteOn(33, 0.9, 0, 1)}])
    const env = []
    for (let i = 0; i + frame <= r.out.length; i += frame) {
        let s = 0
        for (let j = 0; j < frame; j++) s += r.out[i + j] * r.out[i + j]
        env.push(Math.sqrt(s / frame))
    }
    const steady = env.slice(Math.floor(env.length * 0.2))
    const mx = Math.max(...steady), mn = Math.min(...steady)
    const depth = (mx - mn) / Math.max(mx, 1e-10)
    check("indexLFO modulates", depth > 0.05, `depth=${(depth * 100).toFixed(0)}%`)
}
// 4) Poly + reset
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

// 5) Stereo width decorrelates channels
{
    const p = new Processor()
    p.paramChanged("width", 0.8)
    p.paramChanged("indexLFO", 6)
    p.paramChanged("indexDepth", 0.8)
    const total = Math.floor(1.0 * sampleRate)
    const outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK)
    let pos = 0, diff = 0, sawNote = false
    while (pos < total) {
        outL.fill(0); outR.fill(0)
        if (!sawNote) { p.noteOn(33, 0.9, 0, 1); sawNote = true }
        p.process([outL, outR], {s0: 0, s1: BLOCK, index: pos / BLOCK, bpm: 140, p0: 0, p1: 0, flags: 5})
        for (let i = 0; i < BLOCK && pos + i < total; i++) diff += Math.abs(outL[i] - outR[i])
        pos += BLOCK
    }
    check("width decorrelates L!=R", diff > 1e-3, `diff=${diff.toFixed(4)}`)
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURE(S)`)
process.exit(fail === 0 ? 0 : 1)