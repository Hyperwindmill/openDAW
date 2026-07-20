// @label Sampler
// @group Pitch orange
// @param rootNote 60    0     127   linear
// @group Amp green
// @param attack   0.005 0.001 2.0   exp     s
// @param release  0.30  0.01  6.0   exp     s
// @param volume   0.8

// Replace SAMPLE with the output of scripts/wav2sampler.mjs (mono Int16 base64).
// Default placeholder: one seamless-looping cycle of a 100Hz sine at 44100Hz.
const SAMPLE = {
    sampleRate: 44100,
    loopStart: 0,
    loopEnd: 441,
    data: "AADpANMBvAKlA44EdwVfBkcHLwgWCf0J4wrJC64Mkw13DloPPBAdEf4R3RK8E5kUdhVRFisXBBjcGLIZhxpbGy4c/hzOHZseaB8yIPsgwiGIIksjDSTNJIslRyYBJ7knbygjKdUphCoyK90rhiwsLdAtci4SL68vSTDhMHYxCTKZMiczsjM6NMA0QzXDNUA2ujYyN6c3GDiHOPM4XDnCOSU6hTriOjw7kzvnOzc8hTzPPBY9Wj2bPdk9Ez5KPn4+rz7cPgc/LT9RP3E/jj+oP78/0j/hP+4/9z/9P/8//z/6P/M/6D/aP8k/tD+cP4A/Yj9APxo/8j7GPpc+ZT4vPvY9uj17PTk98zyqPF48Dzy9O2g7EDu0OlY69DmQOSg5vjhQOOA3bTf2Nn02AjaDNQE1fTT2M20z4TJSMsAxLDGVMPwvYC/CLiIufy3ZLDIsiCvbKi0qfCnJKBUoXSekJuklLCVtJKwj6iIlIl8hlyDNHwIfNR5mHZYcxRvyGh0aRxlwGJgXvhbjFQgVKxRNE20SjRGtEMsP6A4FDiENPAxWC3AKigmjCLsH0wbrBQMFGgQxA0cCXgF1AIv/ov65/c/85vv9+hX6LflF+F33dvaQ9ar0xPPf8vvxGPE18FPvc+6T7bPs1ev46h3qQulo6JDnuebj5Q7lO+Rq45riy+H+4DPgad+h3tvdFt1U3JPb1NoX2lzZo9jr1zfXhNbT1SXVeNTO0yfTgdLe0T7RoNAE0GvP1M5Azq7NH82TzArMg8v/yn3K/smDyQrJk8ggyLDHQsfYxnDGDMaqxUzF8MSYxEPE8cOiw1bDDcPHwoXCRsIKwtHBm8FpwTrBDsHmwMDAnsCAwGTATMA3wCbAGMANwAbAAcABwAPACcASwB/ALsBBwFjAcsCPwK/A08D5wCTBUcGCwbbB7cEnwmXCpsLqwjHDe8PJwxnEbcTExB7Fe8XbxT7GpMYNx3nH6MdZyM7IRsnAyT3KvcpAy8bLTszZzGfN982Kzh/Pt89R0O7QjtEw0tTSetMj1M7UfNUr1t3WkddH2P/Yudl12jPb89u13HjdPt4F387fmOBl4TLiAuPS46XkeeVO5iTn/OfV6K/piupn60TsI+0C7uPuxO+m8InxbfJS8zf0HfUD9ur20fe5+KH5ifpy+1v8RP0t/hf/"
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function decodeSample(sample) {
    const b64 = sample.data
    const lut = new Uint8Array(128)
    for (let i = 0; i < B64_CHARS.length; i++) lut[B64_CHARS.charCodeAt(i)] = i
    const len = b64.length
    let pad = 0
    if (len > 0 && b64.charCodeAt(len - 1) === 61) pad++
    if (len > 1 && b64.charCodeAt(len - 2) === 61) pad++
    const byteLen = (len >> 2) * 3 - pad
    const frames = byteLen >> 1
    const out = new Float32Array(frames)
    let bytePos = 0, outPos = 0, low = 0
    for (let i = 0; i < len; i += 4) {
        const word = (lut[b64.charCodeAt(i)] << 18) | (lut[b64.charCodeAt(i + 1)] << 12)
            | (lut[b64.charCodeAt(i + 2)] << 6) | lut[b64.charCodeAt(i + 3)]
        for (let shift = 16; shift >= 0 && bytePos < byteLen; shift -= 8, bytePos++) {
            const byte = (word >> shift) & 0xff
            if ((bytePos & 1) === 0) { low = byte } else {
                let value = low | (byte << 8)
                if (value >= 0x8000) value -= 0x10000
                out[outPos++] = value / 32768
            }
        }
    }
    return out
}

class Processor {
    constructor() {
        this.voices = []
        this.params = {rootNote: 60, attack: 0.005, release: 0.30, volume: 0.8}
        this.buffer = decodeSample(SAMPLE)
        this.frames = this.buffer.length
        this.rateBase = SAMPLE.sampleRate / sampleRate
        this.loopStart = Math.max(0, Math.min(this.frames - 1, SAMPLE.loopStart | 0))
        this.loopEnd = SAMPLE.loopEnd > 0 ? Math.min(this.frames, SAMPLE.loopEnd | 0) : this.frames
        if (this.loopEnd <= this.loopStart + 1) { this.loopStart = 0; this.loopEnd = this.frames }
        const loopLen = this.loopEnd - this.loopStart
        this.xfade = Math.max(0, Math.min(256, (loopLen / 2) | 0))
    }
    paramChanged(label, value) {
        this.params[label] = value
    }
    noteOn(pitch, velocity, cent, id) {
        const {rootNote, attack, release} = this.params
        const rate = this.rateBase * Math.pow(2, (pitch - rootNote + cent / 100) / 12)
        if (this.voices.length >= 8) this.voices.shift()
        this.voices.push({
            id, releasing: false, env: 0, pos: 0, rate,
            level: 0.3 + 0.7 * velocity,
            attackRate: 1 / Math.max(1, attack * sampleRate),
            releaseCoef: Math.exp(-7 / (release * sampleRate))
        })
    }
    noteOff(id) {
        for (const voice of this.voices) if (voice.id === id && !voice.releasing) voice.releasing = true
    }
    reset() {
        for (const voice of this.voices) {
            voice.releasing = true
            voice.releaseCoef = Math.exp(-7 / (0.005 * sampleRate))
        }
    }
    process(output, block) {
        const [outL, outR] = output
        const {volume} = this.params
        const buffer = this.buffer
        const {loopStart, loopEnd, xfade} = this
        const loopLen = loopEnd - loopStart
        const zoneStart = loopEnd - xfade
        for (let v = this.voices.length - 1; v >= 0; v--) {
            const voice = this.voices[v]
            const {rate, attackRate, releaseCoef, releasing, level} = voice
            let {pos, env} = voice
            for (let s = block.s0; s < block.s1; s++) {
                if (releasing) env *= releaseCoef
                else if (env < 1) { env += attackRate; if (env > 1) env = 1 }
                const i = pos | 0
                const frac = pos - i
                const a = buffer[i] || 0
                let value = a + ((buffer[i + 1] || 0) - a) * frac
                if (xfade > 0 && pos > zoneStart) {
                    const t = (pos - zoneStart) / xfade
                    const hp = loopStart + (pos - zoneStart)
                    const hi = hp | 0
                    const ha = buffer[hi] || 0
                    const head = ha + ((buffer[hi + 1] || 0) - ha) * (hp - hi)
                    value = value * (1 - t) + head * t
                }
                const amp = env * level * volume
                outL[s] += value * amp
                outR[s] += value * amp
                pos += rate
                while (pos >= loopEnd) pos -= loopLen
            }
            voice.pos = pos
            voice.env = env
            if (releasing && env < 2e-4) this.voices.splice(v, 1)
        }
        for (let s = block.s0; s < block.s1; s++) {
            outL[s] = Math.tanh(outL[s])
            outR[s] = Math.tanh(outR[s])
        }
    }
}
