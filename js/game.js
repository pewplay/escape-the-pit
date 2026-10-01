/*
 * Escape the Pit
 * Original game (js13kGames 2014) by Mark Vasilkov — MIT License, see LICENSE.
 * Rebuilt for PewPlay: responsive board scaling, touch controls, Web Audio,
 * readable single-file game logic (merged from the original scripts/*.js).
 */
(function () {
    'use strict'

    var STORE = 'escape-the-pit:'
    var SIZE = 9               // the board is 9 x 9 squares
    var EXIT_X = 8, EXIT_Y = 4 // the orange square
    var START_X = 0, START_Y = 4

    function $id(id) { return document.getElementById(id) }
    function rand0(a) { return a * (Math.random() - 0.5) }
    function clampCell(v) { return v < 0 ? 0 : v > SIZE - 1 ? SIZE - 1 : v }

    function load(key, fallback) {
        try {
            var v = localStorage.getItem(STORE + key)
            return v === null ? fallback : v === '1'
        } catch (e) { return fallback }
    }
    function save(key, value) {
        try { localStorage.setItem(STORE + key, value ? '1' : '0') } catch (e) {}
    }

    /* ------------------------------------------------------------------ */
    /* Board textures (board.js)                                           */
    /* ------------------------------------------------------------------ */

    var TEX_RES = 3 // render textures at 3x so they stay crisp when scaled up

    function btouv(x) { return 45 * x + 4 }

    function createTexture(paint) {
        var canvas = document.createElement('canvas')
        canvas.width = canvas.height = 412 * TEX_RES
        var ctx = canvas.getContext('2d')
        ctx.scale(TEX_RES, TEX_RES)
        paint(ctx)
        return canvas.toDataURL()
    }

    function paintField(ctx) {
        var i, j
        ctx.fillStyle = '#89867e'
        ctx.fillRect(0, 0, 412, 412)

        for (i = 0; i < SIZE; ++i) {
            for (j = 0; j < SIZE; ++j) {
                ctx.fillStyle = (i == EXIT_X && j == EXIT_Y) ? '#fb3' : '#fcf6f0'
                ctx.fillRect(btouv(i), btouv(j), 44, 44)
            }
        }

        // the big arrow in the middle pointing to the exit
        ctx.beginPath()
        ctx.moveTo(btouv(3), btouv(4))
        ctx.lineTo(btouv(4) + 22, btouv(4))
        ctx.lineTo(btouv(4) + 22, btouv(3) + 22)
        ctx.lineTo(btouv(5) + 44, btouv(4) + 22)
        ctx.lineTo(btouv(4) + 22, btouv(5) + 22)
        ctx.lineTo(btouv(4) + 22, btouv(4) + 44)
        ctx.lineTo(btouv(3), btouv(4) + 44)
        ctx.closePath()

        ctx.fillStyle = '#e9e3dd'
        ctx.lineWidth = 4
        ctx.strokeStyle = '#89867e'
        ctx.fill()
        ctx.stroke()
    }

    var GRASS = ['74b44a', '66a63c', '5f9f35', '55952b', 'a0cf70',
                 '63a339', '63a339', '76b64c', '76b64c', '76b64c']

    function paintGrass(ctx) {
        var i, j, u, v, x, y
        ctx.fillStyle = '#fcf6f0'
        ctx.fillRect(0, 0, 412, 412)
        for (i = 0; i < SIZE; ++i) {
            for (j = 0; j < SIZE; ++j) {
                x = btouv(i)
                y = btouv(j)
                for (u = 0; u < 11; ++u) {
                    for (v = 0; v < 11; ++v) {
                        ctx.fillStyle = '#' + GRASS[0 | GRASS.length * Math.random()]
                        ctx.fillRect(4 * u + x, 4 * v + y, 4, 4)
                    }
                }
            }
        }
    }

    var floorTex = createTexture(paintField)
    var grassTex = createTexture(paintGrass)

    var css = '#fl{background-image:url("' + floorTex + '")}' +
              '.win #fl{background-image:url("' + grassTex + '")}'
    for (var n = 0; n < SIZE; ++n) {
        css += '[data-x="' + n + '"]{left:' + btouv(n) + 'px}' +
               '[data-y="' + n + '"]{top:' + btouv(n) + 'px}'
    }
    var styleEl = document.createElement('style')
    styleEl.appendChild(document.createTextNode(css))
    document.head.appendChild(styleEl)

    /* ------------------------------------------------------------------ */
    /* DOM                                                                 */
    /* ------------------------------------------------------------------ */

    var $scr = $id('scr')
    var $psp = $id('psp')
    var $cells = $id('cells')
    var $depth = $id('dp')
    var $msg = $id('msg')
    var $caught = $id('fu')
    var $win = $id('gg')
    var $help = $id('hlp')
    var $hud = $id('hud')
    var $opts = $id('opts')

    // one invisible square per board cell: tap targets for touch / mouse
    var cellEls = []
    for (var cx = 0; cx < SIZE; ++cx) {
        cellEls[cx] = []
        for (var cy = 0; cy < SIZE; ++cy) {
            var cell = document.createElement('div')
            cell.className = 'cell' + (cx == EXIT_X && cy == EXIT_Y ? ' exit' : '')
            cell.dataset.x = cx
            cell.dataset.y = cy
            $cells.appendChild(cell)
            cellEls[cx][cy] = cell
        }
    }

    var isTouch = window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches
    function setTouchMode(on) {
        isTouch = on
        document.body.classList.toggle('touch', on)
        $help.textContent = on
            ? 'Tap a square next to you (or swipe) to move'
            : 'Controls: arrow keys, WASD or HJKL'
        $id('againHint').hidden = on // keyboard hint only
    }
    setTouchMode(isTouch)

    /* ------------------------------------------------------------------ */
    /* Perspective / layout                                                */
    /* ------------------------------------------------------------------ */

    var scale = 1
    var flat = true          // flat top-down view (depth 9) vs. tilted 3D view
    var rotX = 45, rotZ = -25
    var rand9Flip = true

    function rand9(a) {
        rand9Flip = !rand9Flip
        return (rand9Flip ? 1 : -1) * a * Math.max(Math.random(), 0.1)
    }

    function applyTransform() {
        var sc = 'scale3d(' + scale + ',' + scale + ',' + scale + ')' // z too, to keep the 3D proportions
        $psp.style.transform = flat ? sc : sc + ' rotateX(' + rotX + 'deg) rotateZ(' + rotZ + 'deg)'
    }

    function pspOff() {
        flat = true
        $scr.classList.add('nopsp')
        applyTransform()
    }

    function pspAny() {
        flat = false
        $scr.classList.remove('nopsp')
        rotX = 0 | 40 + rand0(10)
        rotZ = 0 | rand9(25)
        applyTransform()
    }

    function place(cx, cy) {
        document.documentElement.style.setProperty('--s', scale)
        $psp.style.left = (cx - 206) + 'px'
        $psp.style.top = (cy - 206) + 'px'
        // as in the original, the eye sits a little below the board centre
        $scr.style.perspectiveOrigin = cx + 'px ' + (cy + 44 * scale) + 'px'
        applyTransform()
    }

    // Projected bounding box of the board (at scale 1, relative to its centre)
    // over the flat view and the most extreme random tilts a level can get.
    function measureFootprint(cx, cy) {
        var saved = { flat: flat, rotX: rotX, rotZ: rotZ, scale: scale, nopsp: $scr.classList.contains('nopsp') }
        var box = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
        // the extremes are not always at the largest angles, so sample the whole range
        var configs = [null], ax, az
        for (ax = 35; ax <= 45; ax += 5)
            for (az = -25; az <= 25; az += 2.5) configs.push([ax, az])
        var fl = $id('fl')
        scale = 1
        for (var i = 0; i < configs.length; ++i) {
            flat = !configs[i]
            $scr.classList.toggle('nopsp', flat)
            if (!flat) { rotX = configs[i][0]; rotZ = configs[i][1] }
            place(cx, cy)
            var r = fl.getBoundingClientRect()
            box.minX = Math.min(box.minX, r.left - cx)
            box.maxX = Math.max(box.maxX, r.right - cx)
            box.minY = Math.min(box.minY, r.top - cy - (flat ? 0 : 30)) // room for cubes on the far row
            box.maxY = Math.max(box.maxY, r.bottom - cy)
        }
        flat = saved.flat; rotX = saved.rotX; rotZ = saved.rotZ; scale = saved.scale
        $scr.classList.toggle('nopsp', saved.nopsp)
        return box
    }

    var $measure = document.createElement('span')
    $measure.style.cssText = 'position:absolute;visibility:hidden;left:0;bottom:0'
    $hud.appendChild($measure)

    function hudTextWidth() {
        var widest = 0
        var texts = msgs.concat(['Depth: 9'])
        for (var i = 0; i < texts.length; ++i) {
            $measure.textContent = texts[i]
            widest = Math.max(widest, $measure.offsetWidth)
        }
        return widest
    }

    function layout() {
        var w = window.innerWidth
        var h = window.innerHeight

        $psp.classList.add('noanim')
        $scr.classList.add('noanim')

        var box = measureFootprint(w / 2, h / 2)
        var fw = box.maxX - box.minX, fh = box.maxY - box.minY
        var top = Math.max($opts.offsetTop + $opts.offsetHeight, $help.offsetHeight) + 6
        var bottom = 8
        var margin = 8

        // Wide screens: the HUD text fits beside the board, so it needs no row of its own.
        var s1 = Math.min((w - 2 * margin) / fw, (h - top - bottom) / fh)
        if (w / 2 - s1 * fw / 2 < hudTextWidth() + 24) {
            bottom = $hud.offsetHeight + 6
        }
        scale = Math.min((w - 2 * margin) / fw, (h - top - bottom) / fh)
        scale = Math.max(0.25, Math.min(scale, 3.5))

        var areaCY = top + (h - top - bottom) / 2
        var cx = w / 2 - scale * (box.minX + box.maxX) / 2
        var cy = areaCY - scale * (box.minY + box.maxY) / 2
        place(cx, cy)

        void $psp.offsetWidth
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                $psp.classList.remove('noanim')
                $scr.classList.remove('noanim')
            })
        })
    }

    window.addEventListener('resize', layout)
    window.addEventListener('orientationchange', function () { setTimeout(layout, 120) })

    /* ------------------------------------------------------------------ */
    /* Audio (aa.js + bgm.js, now on Web Audio)                            */
    /* ------------------------------------------------------------------ */

    var opt = { snd: load('sound', true), mus: load('music', false) }

    var SOUNDS = {
        lvl: [2,0.0703,0.4438,0.1843,0.3133,0.7169,,-0.3947,0.2224,,,-0.8926,,,0.0018,0.5304,0.0024,-0.0733,0.9999,0.0008,,,0.001,0.5],
        bad: [1,0.4882,0.1015,0.0111,0.185,0.5532,,0.2042,-0.2355,-0.0008,0.167,0.1466,0.2996,0.4515,0.0003,0.6633,-0.0922,0.0004,0.4611,0.0765,,0.0034,-0.4309,0.5],
        go:  [0,,0.1095,,0.0704,0.5058,,,,,,,,0.0765,,,,,1,,,0.1,,0.5],
        win: [1,0.1802,0.6588,0.0408,0.5046,0.5889,,-0.4668,0.9709,,0.6701,-0.4295,,-0.4146,0.0436,0.7555,-0.0819,-0.9671,0.1275,0.6194,,0.0893,0.3871,0.5]
    }

    var actx = null
    var buffers = {}
    var musicBuffer = null
    var musicGain = null
    var musicSource = null

    function unlockAudio() {
        if (actx) {
            if (actx.state === 'suspended' && !document.hidden) actx.resume()
            return
        }
        var AC = window.AudioContext || window.webkitAudioContext
        if (!AC) return
        try { actx = new AC() } catch (e) { actx = null; return }
        for (var key in SOUNDS) {
            var data = sfxr(SOUNDS[key])
            var buf = actx.createBuffer(1, Math.max(1, data.length), 44100)
            buf.getChannelData(0).set(data)
            buffers[key] = buf
        }
        if (opt.mus) startMusic()
    }

    function play(key) {
        if (!opt.snd || !actx || !buffers[key]) return
        var src = actx.createBufferSource()
        src.buffer = buffers[key]
        src.connect(actx.destination)
        src.start()
    }

    // The original bytebeat soundtrack: 8-bit, 44.1 kHz, rendered once on demand.
    function makeMusic() {
        var length = 8 << 16
        var buf = actx.createBuffer(1, length, 44100)
        var out = buf.getChannelData(0)
        for (var t = 0; t < length; ++t) {
            var v = ((t * ('36364689'[t >> 13 & 7] & 15)) / 12 & 128) +
                    (((((t >> 12) ^ (t >> 12) - 2) % 11 * t) / 4 | t >> 13) & 127)
            out[t] = (v - 128) / 128
        }
        return buf
    }

    function startMusic() {
        if (!actx || musicSource) return
        if (!musicBuffer) musicBuffer = makeMusic()
        musicGain = actx.createGain()
        musicGain.gain.value = 0.33
        musicGain.connect(actx.destination)
        musicSource = actx.createBufferSource()
        musicSource.buffer = musicBuffer
        musicSource.loop = true
        musicSource.connect(musicGain)
        musicSource.start()
    }

    function stopMusic() {
        if (!musicSource) return
        try { musicSource.stop() } catch (e) {}
        musicSource.disconnect()
        musicGain.disconnect()
        musicSource = musicGain = null
    }

    function bindToggle(id, key, storeKey, onChange) {
        var btn = $id(id)
        btn.setAttribute('aria-pressed', opt[key] ? 'true' : 'false')
        btn.addEventListener('click', function () {
            opt[key] = !opt[key]
            btn.setAttribute('aria-pressed', opt[key] ? 'true' : 'false')
            save(storeKey, opt[key])
            unlockAudio()
            if (onChange) onChange(opt[key])
            btn.blur()
        })
    }

    bindToggle('snd', 'snd', 'sound')
    bindToggle('mus', 'mus', 'music', function (on) { on ? startMusic() : stopMusic() })

    window.addEventListener('pointerdown', unlockAudio, true)
    window.addEventListener('keydown', unlockAudio, true)

    document.addEventListener('visibilitychange', function () {
        if (!actx) return
        if (document.hidden) actx.suspend()
        else actx.resume()
    })

    /* ------------------------------------------------------------------ */
    /* The escapist (player)                                               */
    /* ------------------------------------------------------------------ */

    var escapist = {
        x: START_X, y: START_Y,
        levelComplete: false,
        $: document.querySelector('.pl'),
        $update: function () {
            this.$.dataset.x = this.x
            this.$.dataset.y = this.y
            this.levelComplete = this.x == EXIT_X && this.y == EXIT_Y
            updateHints()
        }
    }

    function updateHints() {
        for (var x = 0; x < SIZE; ++x) {
            for (var y = 0; y < SIZE; ++y) {
                var d = Math.abs(x - escapist.x) + Math.abs(y - escapist.y)
                cellEls[x][y].classList.toggle('adj', d == 1 && !escapist.levelComplete)
            }
        }
    }

    var helpShown = true
    function removeHelp() {
        if (!helpShown) return
        helpShown = false
        $help.classList.add('off')
    }

    var arriveTimer = 0

    // One turn: the player steps (bumping into a wall just passes the turn),
    // then every snake moves one square towards the player.
    function move(dx, dy) {
        if (escapist.levelComplete) return

        escapist.x = clampCell(escapist.x + dx)
        escapist.y = clampCell(escapist.y + dy)
        escapist.$update()
        escapist.levelComplete || testCaught() || enemyTurn()

        play('go')
        removeHelp()

        if (escapist.levelComplete) {
            clearTimeout(arriveTimer)
            arriveTimer = setTimeout(arrived, 450) // fallback if transitionend is missed
        }
    }

    function cheatToExit() {
        if (escapist.levelComplete) return
        escapist.x = EXIT_X
        escapist.y = EXIT_Y
        escapist.$update()
        play('go')
        removeHelp()
        clearTimeout(arriveTimer)
        arriveTimer = setTimeout(arrived, 450)
    }

    function arrived() {
        clearTimeout(arriveTimer)
        if (escapist.levelComplete) nextLevel()
    }

    escapist.$.addEventListener('transitionend', function (event) {
        if (event.target === escapist.$ && (event.propertyName == 'left' || event.propertyName == 'top'))
            arrived()
    })

    /* ------------------------------------------------------------------ */
    /* Snakes (enemy.js)                                                   */
    /* ------------------------------------------------------------------ */

    var autoIncrement = 0

    function insertBlock(cn, x, y) {
        var el = document.createElement('div')
        el.id = 'blk' + (++autoIncrement)
        el.className = 'c h ' + cn
        el.dataset.x = x
        el.dataset.y = y
        el.innerHTML = '<div class="i"></div><div class="j"></div><div class="k"></div><div class="l"></div>'
        $psp.appendChild(el)
        return el
    }

    function Enemy(cname, options) {
        this.cn = cname
        this.x = options.head[0]
        this.y = options.head[1]
        this.$ = insertBlock(cname, this.x, this.y)
        this.$tail = []

        for (var i = 0; i < options.tail.length; ++i) {
            var tail = options.tail[i]
            this.$tail.push({
                x: tail[0], y: tail[1],
                $: insertBlock(cname + ' t' + i, tail[0], tail[1])
            })
        }

        // let the hidden blocks render once, then drop them onto the board
        void this.$.offsetWidth
        var self = this
        requestAnimationFrame(function () { self.reveal() })
    }

    Enemy.prototype.reveal = function () {
        if (!this.$.parentNode) return
        this.$.className = 'c ' + this.cn
        for (var i = 0; i < this.$tail.length; ++i)
            this.$tail[i].$.className = 'c ' + this.cn + ' t' + i
    }

    Enemy.prototype.remove = function () {
        $psp.removeChild(this.$)
        for (var i = 0; i < this.$tail.length; ++i)
            $psp.removeChild(this.$tail[i].$)
    }

    Enemy.prototype.$update = function () {
        this.$.dataset.x = this.x
        this.$.dataset.y = this.y
        for (var i = 0; i < this.$tail.length; ++i) {
            var tail = this.$tail[i]
            tail.$.dataset.x = tail.x
            tail.$.dataset.y = tail.y
        }
    }

    Enemy.prototype.hasPlayer = function () {
        if (this.x == escapist.x && this.y == escapist.y) return true
        for (var i = 0; i < this.$tail.length; ++i) {
            var tail = this.$tail[i]
            if (tail.x == escapist.x && tail.y == escapist.y) return true
        }
        return false
    }

    /* ------------------------------------------------------------------ */
    /* Levels (game.js)                                                    */
    /* ------------------------------------------------------------------ */

    var depth = 9

    var msgs = [
        'This was a triumph',
        'Paint it red',
        'Unlikely',
        'Narrow escape',
        'We swarm',
        'Switchback',
        'Stay with me',
        'Easy mode',
        'You are (not) alone',
        'Escape the Pit'
    ]

    var enemy1setup = [
        {},
        {head: [3, 4], tail: [[4, 4], [5, 4]]},
        {head: [7, 3], tail: [[6, 3], [5, 3], [5, 4], [5, 5]]},
        {head: [3, 6], tail: [[3, 6], [3, 5], [3, 4], [3, 3]]},
        {head: [1, 3], tail: [[1, 2], [2, 2]]},
        {head: [4, 7], tail: [[5, 7], [6, 7], [6, 6]]},
        {head: [2, 1], tail: [[2, 0], [1, 0], [0, 0]]},
        {head: [2, 7], tail: [[2, 8], [3, 8], [4, 8], [5, 8]]},
        {head: [2, 1], tail: [[3, 1], [4, 1], [5, 1]]},
        {}
    ]
    var enemy2setup = [
        {},
        {head: [2, 6], tail: [[2, 7], [1, 7], [1, 8]]},
        {head: [6, 4], tail: [[7, 4], [7, 5]]},
        {head: [5, 2], tail: [[5, 3], [5, 4], [5, 5], [5, 6]]},
        {head: [2, 5], tail: [[2, 6], [3, 6]]},
        {head: [6, 4], tail: [[5, 4], [4, 4], [3, 4], [2, 4]]},
        {head: [7, 3], tail: [[7, 4], [7, 5], [8, 5], [8, 6]]},
        {head: [6, 1], tail: [[7, 1], [8, 1], [8, 2]]},
        {},
        {}
    ]
    var enemy1 = null
    var enemy2 = null

    // nextLevel() goes one level deeper towards the surface (depth - 1);
    // nextLevel(n) jumps to depth n (used when caught and on restart).
    function nextLevel(lvl) {
        var quiet = typeof lvl != 'undefined'

        if (enemy1) { enemy1.remove(); enemy1 = null }
        if (enemy2) { enemy2.remove(); enemy2 = null }

        if (!depth && !quiet) {
            // already out of the pit: just let the player wander on the grass
            escapist.levelComplete = false
            updateHints()
            return
        }

        pspAny()
        escapist.x = START_X
        escapist.y = START_Y
        escapist.$update()

        depth = quiet ? lvl : depth - 1

        $depth.textContent = depth
        $msg.textContent = msgs[depth]

        $scr.classList.toggle('win', !depth)
        $win.classList.toggle('on', !depth)
        if (!depth) {
            play('win')
            quiet = true // no level sound on top of the fanfare
        }

        if (enemy1setup[depth].head) enemy1 = new Enemy('enr', enemy1setup[depth])
        if (enemy2setup[depth].head) enemy2 = new Enemy('enb', enemy2setup[depth])

        quiet || play('lvl')
    }

    function enemyTurn() {
        var first = enemy1, second = enemy2
        if (first && _enemyTurn(first)) return
        // if the player was caught, the level was reset: the new snakes wait
        if (second && second === enemy2) _enemyTurn(second)
    }

    // Move a snake one step along the shortest path to the player.
    // Returns true when the player got caught.
    function _enemyTurn(enemy) {
        var i, j, m = [], g, start, end, path

        for (i = 0; i < SIZE; ++i) {
            m[i] = []
            for (j = 0; j < SIZE; ++j)
                m[i][j] = (i == EXIT_X && j == EXIT_Y) ? 0 : 1 // snakes avoid the exit
        }

        if (enemy1) {
            for (i = 0; i < enemy1.$tail.length; ++i)
                m[enemy1.$tail[i].x][enemy1.$tail[i].y] = 0
        }
        if (enemy2) {
            for (i = 0; i < enemy2.$tail.length; ++i)
                m[enemy2.$tail[i].x][enemy2.$tail[i].y] = 0
        }

        if (enemy === enemy1)
            enemy2 && (m[enemy2.x][enemy2.y] = 0)
        else
            enemy1 && (m[enemy1.x][enemy1.y] = 0)

        g = new Graph(m)
        start = g.grid[enemy.x][enemy.y]
        end = g.grid[escapist.x][escapist.y]
        path = astar.search(g, start, end)

        if (!path.length) return false

        for (i = enemy.$tail.length - 1; i > -1; --i) {
            var tail = enemy.$tail[i]
            var before = i ? enemy.$tail[i - 1] : enemy
            tail.x = before.x
            tail.y = before.y
        }
        enemy.x = path[0].x
        enemy.y = path[0].y
        enemy.$update()

        return testCaught()
    }

    var caughtTimer = 0

    function testCaught() {
        if ((enemy1 && enemy1.hasPlayer()) || (enemy2 && enemy2.hasPlayer())) {
            nextLevel(++depth)
            if (depth == 9) pspOff()
            $caught.classList.add('s')
            clearTimeout(caughtTimer)
            caughtTimer = setTimeout(function () { $caught.classList.remove('s') }, 1000)
            play('bad')
            return true
        }
        return false
    }

    function restartGame() {
        nextLevel(depth = 9)
        pspOff()
    }

    $id('again').addEventListener('click', function () {
        restartGame()
        this.blur()
    })

    /* ------------------------------------------------------------------ */
    /* Keyboard                                                            */
    /* ------------------------------------------------------------------ */

    var KEYS = {
        ArrowUp: [0, -1], Up: [0, -1], w: [0, -1], k: [0, -1],
        ArrowLeft: [-1, 0], Left: [-1, 0], a: [-1, 0], h: [-1, 0],
        ArrowDown: [0, 1], Down: [0, 1], s: [0, 1], j: [0, 1],
        ArrowRight: [1, 0], Right: [1, 0], d: [1, 0], l: [1, 0]
    }

    window.addEventListener('keydown', function (event) {
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
        var key = event.key || ''
        var dir = KEYS[key] || KEYS[key.toLowerCase()]

        if (isTouch) setTouchMode(false)

        if (dir) {
            event.preventDefault()
            move(dir[0], dir[1])
        } else if (key == '9') {
            event.preventDefault()
            restartGame()
        } else if (key == ']') { // the original's cheat: skip the level
            event.preventDefault()
            cheatToExit()
        }
    }, true)

    /* ------------------------------------------------------------------ */
    /* Touch / mouse: tap a square, tap towards a direction, or swipe      */
    /* ------------------------------------------------------------------ */

    function centerOf(el) {
        var r = el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }

    // Convert a screen-space vector into one grid step, using the projected
    // directions of the board's x and y axes (the board is rotated in 3D).
    function stepFromScreen(vx, vy) {
        var a0 = centerOf(cellEls[0][4]), a1 = centerOf(cellEls[8][4])
        var b0 = centerOf(cellEls[4][0]), b1 = centerOf(cellEls[4][8])
        var ax = a1.x - a0.x, ay = a1.y - a0.y
        var bx = b1.x - b0.x, by = b1.y - b0.y
        var la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1
        ax /= la; ay /= la; bx /= lb; by /= lb
        // solve v = alpha * A + beta * B
        var det = ax * by - ay * bx
        if (Math.abs(det) < 1e-6) return null
        var alpha = (vx * by - vy * bx) / det
        var beta = (ax * vy - ay * vx) / det
        if (Math.abs(alpha) >= Math.abs(beta)) return [alpha > 0 ? 1 : -1, 0]
        return [0, beta > 0 ? 1 : -1]
    }

    function cellAt(x, y) {
        var el = document.elementFromPoint(x, y)
        return el && el.classList && el.classList.contains('cell') ? el : null
    }

    var gesture = null

    $scr.addEventListener('pointerdown', function (event) {
        if (event.pointerType === 'touch' && !isTouch) setTouchMode(true)
        if (event.button > 0) return
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY }
        event.preventDefault()
    })

    $scr.addEventListener('pointercancel', function () { gesture = null })

    window.addEventListener('pointerup', function (event) {
        if (!gesture || gesture.id !== event.pointerId) return
        var g = gesture
        gesture = null
        if (escapist.levelComplete) return

        var dx = event.clientX - g.x, dy = event.clientY - g.y
        var dist = Math.hypot(dx, dy)
        var step = null

        if (dist > 24) {
            step = stepFromScreen(dx, dy) // swipe
        } else {
            var cell = cellAt(g.x, g.y)
            if (cell) {
                var tx = +cell.dataset.x - escapist.x
                var ty = +cell.dataset.y - escapist.y
                if (!tx && !ty) return
                step = Math.abs(tx) >= Math.abs(ty)
                    ? [tx > 0 ? 1 : -1, 0]
                    : [0, ty > 0 ? 1 : -1]
            } else {
                var p = centerOf(escapist.$)
                step = stepFromScreen(g.x - p.x, g.y - p.y)
            }
        }

        if (step) move(step[0], step[1])
    })

    $scr.addEventListener('contextmenu', function (event) { event.preventDefault() })

    /* ------------------------------------------------------------------ */
    /* Start                                                               */
    /* ------------------------------------------------------------------ */

    layout()
    pspOff()
    escapist.$update()

    // for automated screenshots / debugging
    window.escapeThePit = {
        jumpTo: function (d) { nextLevel(d); if (d == 9) pspOff() },
        move: move,
        state: function () { return { depth: depth, x: escapist.x, y: escapist.y } }
    }
})()
