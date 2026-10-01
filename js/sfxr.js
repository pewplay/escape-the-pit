/*
 * Tiny sfxr synthesiser (readable rewrite of the "jsfxr" mini build bundled with
 * the original game; jsfxr is a JavaScript port of Tomas Pettersson's sfxr).
 *
 * sfxr(params) takes the classic 24-number sfxr parameter list and returns a
 * Float32Array of mono samples at 44100 Hz, ready to copy into an AudioBuffer.
 */
(function () {
    'use strict'

    var PARAM_NAMES = [
        'waveType', 'attack', 'sustain', 'punch', 'decay',
        'startFrequency', 'minFrequency', 'slide', 'deltaSlide',
        'vibratoDepth', 'vibratoSpeed', 'changeAmount', 'changeSpeed',
        'squareDuty', 'dutySweep', 'repeatSpeed', 'phaserOffset', 'phaserSweep',
        'lpCutoff', 'lpCutoffSweep', 'lpResonance', 'hpCutoff', 'hpCutoffSweep',
        'masterVolume'
    ]

    function readParams(list) {
        var p = {}, i, total, k
        for (i = 0; i < 24; i++) p[PARAM_NAMES[i]] = list[i] || 0
        if (p.sustain < 0.01) p.sustain = 0.01
        total = p.attack + p.sustain + p.decay
        if (total < 0.18) {
            k = 0.18 / total
            p.attack *= k
            p.sustain *= k
            p.decay *= k
        }
        return p
    }

    function sfxr(list) {
        var p = readParams(list)

        // State that is (re)initialised on start and on every "repeat".
        var period, maxPeriod, slide, deltaSlide, duty, dutySlide,
            changeAmount, changeTime, changeLimit

        function reset() {
            period = 100 / (p.startFrequency * p.startFrequency + 0.001)
            maxPeriod = 100 / (p.minFrequency * p.minFrequency + 0.001)
            slide = 1 - 0.01 * p.slide * p.slide * p.slide
            deltaSlide = 1e-6 * -p.deltaSlide * p.deltaSlide * p.deltaSlide
            if (!p.waveType) {
                duty = 0.5 - p.squareDuty / 2
                dutySlide = 5e-5 * -p.dutySweep
            }
            changeAmount = 1 + p.changeAmount * p.changeAmount * (p.changeAmount > 0 ? -0.9 : 10)
            changeTime = 0
            changeLimit = p.changeSpeed == 1 ? 0 : 2e4 * (1 - p.changeSpeed) * (1 - p.changeSpeed) + 32
        }

        reset()

        var envLength = [
            1e5 * p.attack * p.attack,
            1e5 * p.sustain * p.sustain,
            1e5 * p.decay * p.decay + 12
        ]
        var totalLength = 3 * ((envLength[0] + envLength[1] + envLength[2]) / 3 | 0)

        var filtersOn = p.lpCutoff != 1 || p.hpCutoff,
            hpCutoff = 0.1 * p.hpCutoff * p.hpCutoff,
            hpCutoffMult = 1 + 3e-4 * p.hpCutoffSweep,
            lpCutoff = 0.1 * p.lpCutoff * p.lpCutoff * p.lpCutoff,
            lpCutoffMult = 1 + 1e-4 * p.lpCutoffSweep,
            lpFilterOn = p.lpCutoff != 1,
            volume = p.masterVolume * p.masterVolume,
            minFreqOn = p.minFrequency,
            phaserOn = p.phaserOffset || p.phaserSweep,
            phaserDeltaOffset = 0.2 * p.phaserSweep * p.phaserSweep * p.phaserSweep,
            phaserOffset = p.phaserOffset * p.phaserOffset * (p.phaserOffset < 0 ? -1020 : 1020),
            repeatLimit = p.repeatSpeed ? (2e4 * (1 - p.repeatSpeed) * (1 - p.repeatSpeed) | 0) + 32 : 0,
            punch = p.punch,
            vibratoDepth = p.vibratoDepth / 2,
            vibratoSpeed = 0.01 * p.vibratoSpeed * p.vibratoSpeed,
            waveType = p.waveType

        var damping = 5 / (1 + 20 * p.lpResonance * p.lpResonance) * (0.01 + lpCutoff)
        if (damping > 0.8) damping = 0.8
        damping = 1 - damping

        var finished = false,
            envStage = 0, envTime = 0, envVolume = 0, envCurrentLength = envLength[0],
            hpFilterPos = 0, lpFilterDeltaPos = 0, lpFilterPos = 0, lpFilterOldPos,
            phase = 0, phaserPos = 0, phaserInt = 0,
            repeatTime = 0, vibratoPhase = 0,
            periodTemp, sample, superSample,
            phaserBuffer = new Array(1024),
            noiseBuffer = new Array(32),
            out = new Float32Array(totalLength),
            i, j, n

        for (i = 0; i < 1024; i++) phaserBuffer[i] = 0
        for (i = 0; i < 32; i++) noiseBuffer[i] = 2 * Math.random() - 1

        for (i = 0; i < totalLength; i++) {
            if (finished) break

            if (repeatLimit && ++repeatTime >= repeatLimit) {
                repeatTime = 0
                reset()
            }

            if (changeLimit && ++changeTime >= changeLimit) {
                changeLimit = 0
                period *= changeAmount
            }

            slide += deltaSlide
            period *= slide
            if (period > maxPeriod) {
                period = maxPeriod
                if (minFreqOn > 0) finished = true
            }

            periodTemp = period
            if (vibratoDepth > 0) {
                vibratoPhase += vibratoSpeed
                periodTemp *= 1 + Math.sin(vibratoPhase) * vibratoDepth
            }
            periodTemp |= 0
            if (periodTemp < 8) periodTemp = 8

            if (!waveType) {
                duty += dutySlide
                if (duty < 0) duty = 0
                else if (duty > 0.5) duty = 0.5
            }

            // Volume envelope: attack, sustain (with punch), decay.
            if (++envTime > envCurrentLength) {
                envTime = 0
                envStage++
                if (envStage == 1) envCurrentLength = envLength[1]
                else if (envStage == 2) envCurrentLength = envLength[2]
            }
            switch (envStage) {
                case 0: envVolume = envTime / envLength[0]; break
                case 1: envVolume = 1 + 2 * (1 - envTime / envLength[1]) * punch; break
                case 2: envVolume = 1 - envTime / envLength[2]; break
                case 3: envVolume = 0; finished = true
            }

            if (phaserOn) {
                phaserOffset += phaserDeltaOffset
                phaserInt = phaserOffset | 0
                if (phaserInt < 0) phaserInt = -phaserInt
                else if (phaserInt > 1023) phaserInt = 1023
            }

            if (filtersOn && hpCutoffMult) {
                hpCutoff *= hpCutoffMult
                if (hpCutoff < 1e-5) hpCutoff = 1e-5
                else if (hpCutoff > 0.1) hpCutoff = 0.1
            }

            // 8x supersampling
            superSample = 0
            for (j = 8; j--;) {
                phase++
                if (phase >= periodTemp) {
                    phase %= periodTemp
                    if (waveType == 3) {
                        for (n = 32; n--;) noiseBuffer[n] = 2 * Math.random() - 1
                    }
                }

                switch (waveType) {
                    case 0: // square
                        sample = phase / periodTemp < duty ? 0.5 : -0.5
                        break
                    case 1: // sawtooth
                        sample = 1 - 2 * (phase / periodTemp)
                        break
                    case 2: // sine (fast approximation)
                        sample = phase / periodTemp
                        sample = 6.28318531 * (sample > 0.5 ? sample - 1 : sample)
                        sample = 1.27323954 * sample + 0.405284735 * sample * sample * (sample < 0 ? 1 : -1)
                        sample = 0.225 * ((sample < 0 ? -1 : 1) * sample * sample - sample) + sample
                        break
                    case 3: // noise
                        sample = noiseBuffer[Math.abs(32 * phase / periodTemp | 0)]
                }

                if (filtersOn) {
                    lpFilterOldPos = lpFilterPos
                    lpCutoff *= lpCutoffMult
                    if (lpCutoff < 0) lpCutoff = 0
                    else if (lpCutoff > 0.1) lpCutoff = 0.1
                    if (lpFilterOn) {
                        lpFilterDeltaPos += (sample - lpFilterPos) * lpCutoff
                        lpFilterDeltaPos *= damping
                    } else {
                        lpFilterPos = sample
                        lpFilterDeltaPos = 0
                    }
                    lpFilterPos += lpFilterDeltaPos
                    hpFilterPos += lpFilterPos - lpFilterOldPos
                    sample = hpFilterPos *= 1 - hpCutoff
                }

                if (phaserOn) {
                    phaserBuffer[phaserPos % 1024] = sample
                    sample += phaserBuffer[(phaserPos - phaserInt + 1024) % 1024]
                    phaserPos++
                }

                superSample += sample
            }

            superSample *= 0.125 * envVolume * volume
            out[i] = superSample >= 1 ? 1 : superSample <= -1 ? -1 : superSample
        }

        return out.subarray(0, i)
    }

    window.sfxr = sfxr
})()
