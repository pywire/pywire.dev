// "The live conduit" hero: a pinned scroll story over a circuit-board grid.
//   0 hero      the pywire chip sits on a live circuit board
//   1 python    the server card compiles out of the grid (a .wire component)
//   2 conduit   the old stack's tangle of routes merges into one live wire
//   3 patch     a click crosses the wire, the server bumps state, and only the
//               changed text node patches; three scripted clicks, then yours
//   4 transport the conduit splits into WebSocket, WebTransport, long polling
//   5 edge      stateless: an edge node next to the browser answers instead of
//               the far-off origin, and the wire gets short
// The camera frames each beat; HTML cards ride the same camera transform.
import { createShaderHero, reducedMotion, type HeroState } from './runtime'
import { storyFrag } from './shader'
import { snapScroll } from './snap'

type V2 = [number, number]
/** Center x, y (world, origin bottom-left) and half width, half height. */
type Rect = [number, number, number, number]
interface Layout {
  srv: Rect
  brw: Rect
  /** The hero's chip: center x, y and half size. */
  chip: [number, number, number]
  /** The edge node in step 5 (center x, y, half size) and its wire port. */
  edge: [number, number, number]
  edgePort: V2
  ta: V2
  tb: V2
  vert: boolean
}

const C = 32
const sn = (v: number) => Math.round(v / C) * C
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const ss = (t: number) => {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}
const ramp = (s: number, a: number, d: number) => ss((s - a) / d)
const TAIL = 1 / 6.4 // share of the scroll spent pulling the camera out
// Beats 1 to 4 run on their own clock `s` over the first CORE of the story;
// the edge beat takes the rest.
const CORE = 0.82
const EDGE = 0.84
const BEATS = [...[0.14, 0.36, 0.58, 0.8].map((b) => b * CORE), EDGE]
const stepOf = (s: number) => BEATS.filter((b) => s >= b).length
// Where the next button lands for each step (story progress), and what it says.
// These are also the stops that scrolling snaps between.
const NEXT: [number, string][] = [
  [0.27 * CORE, 'Write Python, not a frontend'],
  [0.555 * CORE, 'One conduit, no API layer'],
  [0.67 * CORE, 'Click. Patch. Done.'],
  [0.9 * CORE, "Any wire you've got"],
  [0.93, 'Stateless, at the edge'],
  [-1, 'Why pywire'],
]
const DROP = 64 // portrait: how far the browser moves down for the edge node
const ARC = 0.07 // seconds for an arc to cross the wire
const LANES = [-1, 0, 1]

function layout(w: number, h: number): Layout {
  const portrait = w < 800 || w / h < 1.05
  // Positions are picked top-down, then flipped into world space.
  const y = (top: number) => h - top
  if (portrait) {
    // Keep the diagram in the top half; the step copy owns the bottom.
    const sw = Math.min(136, w * 0.4)
    const srv: Rect = [sn(w * 0.5), sn(y(h * 0.17)), sw, 64]
    const bw = Math.min(260, w * 0.43)
    const bh = Math.min(110, h * 0.1)
    const brw: Rect = [sn(w * 0.5), sn(y(h * 0.45)), bw, bh]
    const ch = Math.round(Math.min(52, w * 0.13))
    // The edge node takes the browser's spot; the browser drops by DROP.
    const et = brw[1] + brw[3] + 20
    return {
      srv,
      brw,
      edge: [brw[0] + C, et, 24],
      edgePort: [brw[0] + C, et - 24],
      chip: [sn(w * 0.5), sn(h * 0.33), ch],
      ta: [srv[0] - C, srv[1] - srv[3]],
      tb: [brw[0] + C, brw[1] + brw[3]],
      vert: true,
    }
  }
  const srv: Rect = [sn(w * 0.2), sn(y(h * 0.33)), 148, 80]
  const bw = Math.min(210, w * 0.17)
  const bh = Math.min(136, h * 0.17)
  const brw: Rect = [sn(w * 0.7), sn(y(h * 0.4)), bw, bh]
  const ch = Math.round(Math.min(88, Math.max(56, w * 0.055)))
  const ex = sn(brw[0] - brw[2] - 128)
  return {
    srv,
    brw,
    edge: [ex, brw[1], 34],
    edgePort: [ex + 34, brw[1]],
    chip: [sn(w * 0.72), sn(h * 0.5), ch],
    ta: [srv[0] + srv[2], srv[1]],
    tb: [brw[0] - brw[2], brw[1]],
    vert: false,
  }
}

/** A lane as polyline points, matching `lane()` in the shader. */
function lanePath(L: Layout, o: number, sh: number): V2[] {
  const sw = (p: V2): V2 => (L.vert ? [p[1], p[0]] : p)
  const A = sw(L.ta)
  const B = sw(L.tb)
  const sx = B[0] >= A[0] ? 1 : -1
  const sy = B[1] >= A[1] ? 1 : -1
  const mx = Math.floor(((A[0] + B[0]) * 0.5) / C + 0.5) * C + sh - o * sx * sy
  const pts: V2[] = [
    [A[0], A[1] + o],
    [mx, A[1] + o],
    [mx, B[1] + o],
    [B[0], B[1] + o],
  ]
  return pts.map(sw)
}
const pathLength = (pts: V2[]) =>
  pts.slice(1).reduce((n, p, i) => n + Math.abs(p[0] - pts[i][0]) + Math.abs(p[1] - pts[i][1]), 0)
function pointAt(pts: V2[], d: number): V2 {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const l = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1])
    if (d <= l || i === pts.length - 1) {
      const t = l ? clamp01(d / l) : 0
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    d -= l
  }
  return pts[pts.length - 1]
}

type Key = [number, number, number, number]
function keyed(s: number, keys: Key[]): [number, number, number] {
  if (s <= keys[0][0]) return [keys[0][1], keys[0][2], keys[0][3]]
  for (let i = 1; i < keys.length; i++) {
    if (s <= keys[i][0]) {
      const a = keys[i - 1]
      const b = keys[i]
      const t = ss((s - a[0]) / (b[0] - a[0]))
      return [
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        Math.exp(Math.log(a[3]) + (Math.log(b[3]) - Math.log(a[3])) * t),
      ]
    }
  }
  const k = keys[keys.length - 1]
  return [k[1], k[2], k[3]]
}

function camera(s: number, out: number, L: Layout, w: number, h: number): [number, number, number] {
  const c: V2 = [w / 2, h / 2]
  const { srv, brw } = L
  // Frame both cards; on landscape keep the pair in the top of the screen so
  // the step copy has the bottom.
  const both: V2 = L.vert ? c : [(srv[0] + brw[0]) / 2, h / 2]
  const patch: V2 = L.vert ? c : [(srv[0] + brw[0]) / 2, (srv[1] + brw[1]) / 2 - 90]
  const zs = L.vert ? 1.35 : 1.7
  const zp = L.vert ? 1.06 : 1.18
  const k = keyed(s, [
    [0.06, ...c, 1],
    [0.2, srv[0], srv[1] - 30, zs],
    [0.32, srv[0], srv[1] - 30, zs],
    [0.44, ...both, 1],
    [0.56, ...both, 1],
    [0.64, ...patch, zp],
    [0.76, ...patch, zp],
    [0.86, ...both, 1],
  ])
  k[2] *= 1 - 0.3 * ss(out)
  return k
}

const UNIFORMS = [
  'u_cam',
  'u_out',
  'u_amb',
  'u_flow',
  'u_energy',
  'u_srv',
  'u_brw',
  'u_ta',
  'u_tb',
  'u_vert',
  'u_srvOn',
  'u_brwOn',
  'u_srvHit',
  'u_brwHit',
  'u_conv',
  'u_draw',
  'u_stack',
  'u_tx',
  'u_arcUp',
  'u_arcDn',
  'u_chip',
]

interface Arc {
  t: number // seconds since it left
  lane: number
  i: number // peak intensity
}

export function mountStory(root: HTMLElement) {
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!
  const world = root.querySelector<HTMLElement>('[data-world]')!
  const steps = [...root.querySelectorAll<HTMLElement>('[data-step]')]
  const bar = root.querySelector<HTMLElement>('[data-progress]')
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!
  const srvEl = q('[data-ov="server"]')
  const brwEl = q('[data-ov="browser"]')
  const chip = q('[data-ov="chip"]')
  const chipText = q('[data-chip-text]')
  const ghost = q('[data-ghost]')
  const stackEls = [...root.querySelectorAll<HTMLElement>('[data-ov="stack"]')]
  const txEls = [...root.querySelectorAll<HTMLElement>('[data-ov="tx"]')]
  const serverCount = q('[data-count="server"]')
  const browserCount = q('[data-count="browser"]')
  const button = q<HTMLButtonElement>('[data-add]')
  const reduce = reducedMotion()
  const chipEl = q('[data-ov="core"]')
  const edgeEl = q('[data-ov="edge"]')
  const srvTag = q('[data-srv-tag]')
  const next = q<HTMLButtonElement>('[data-next]')
  const nextLabel = q('[data-next-label]')

  let count = 0
  let geom = ''
  let L = layout(1, 1)
  let main = lanePath(L, 0, 0)
  let len = 1
  let cur = -2
  let live = false
  // Round trip: the event arc goes up, the server bumps state, the patch comes down.
  let up: Arc | null = null
  let dn: Arc | null = null
  let queued = 0
  let srvHit = 0
  let brwHit = 0
  let chipT = 9
  let lane = 0
  let ping = 0
  // Scripted demo: three clicks a second apart the first time beat 3 is reached.
  let demo = -1 // seconds into the demo, -1 = not started
  let demoDone = false
  let clicks = 0
  let flow = 0
  let energy = 0
  let lastScroll = 0
  let edge = 0
  let coreAt = ''
  let laneAt = -1
  const paced: number[] = []
  // Move toward `to`, forward no faster than 1/`secs` per second. Backward is
  // quick, and without a frame delta (a still frame) it snaps.
  const pace = (k: number, to: number, secs: number, dt: number) => {
    const v = paced[k] ?? to
    paced[k] = dt > 0 && to > v ? Math.min(to, v + dt / secs) : dt > 0 ? Math.max(to, v - dt * 3) : to
    return paced[k]
  }
  let scrollRange = 1

  const setText = (n: HTMLElement, v: string) => {
    if (n.textContent !== v) n.textContent = v
  }
  const flash = (el: HTMLElement, cls: string) => {
    el.classList.remove(cls)
    void el.offsetWidth
    el.classList.add(cls)
  }
  const send = () => {
    up = { t: 0, lane, i: 1 }
    // Stateless: the event carries its signed state along.
    setText(chipText, edge > 0.5 ? '@click + state' : '@click')
    chipT = 0
  }
  const onServer = () => {
    count++
    setText(serverCount, String(count))
    if (edge < 0.5) flash(srvEl, 'hit')
    srvHit = 1
    dn = { t: -0.02, lane: up?.lane ?? lane, i: 1 }
  }
  const onBrowser = () => {
    setText(browserCount, String(count))
    flash(browserCount, 'patched')
    setText(chipText, `patch "${count}"`)
    chipT = 0
    brwHit = 1
  }

  const place = (el: HTMLElement, x: number, y: number, h: number) => {
    el.style.transform = `translate(${x}px, ${h - y}px)`
  }
  const size = (el: HTMLElement, r: Rect, h: number) => {
    Object.assign(el.style, {
      left: `${r[0] - r[2]}px`,
      top: `${h - r[1] - r[3]}px`,
      width: `${2 * r[2]}px`,
      height: `${2 * r[3]}px`,
    })
  }

  const split = (p: number) => ({ s: Math.min(1, p / (1 - TAIL)), out: Math.max(0, (p - (1 - TAIL)) / TAIL) })
  const updateSteps = (s: number, out: number) => {
    let i = stepOf(s)
    // Hysteresis, so hovering around the hand-off doesn't flicker the copy.
    if (out > (cur === -1 ? 0.14 : 0.22)) i = -1
    if (i !== cur) {
      cur = i
      steps.forEach((node, j) => node.classList.toggle('on', j === i))
      root.dataset.step = String(i)
      if (i >= 0) setText(nextLabel, NEXT[i][1])
      next.classList.toggle('gone', i < 0)
      next.disabled = i < 0
    }
    if (bar) bar.style.transform = `scaleX(${s})`
  }

  const stackShift = [
    [-48, -128],
    [40, 96],
    [88, 192],
  ]

  const frame = (st: HeroState, set: (n: string, ...v: number[]) => void) => {
    const { w, h, dt } = st
    const key = `${w}x${h}`
    if (key !== geom) {
      geom = key
      L = layout(w, h)
      main = lanePath(L, 0, 0)
      len = pathLength(main)
      size(srvEl, L.srv, h)
      size(brwEl, L.brw, h)
      coreAt = ''
      laneAt = -1
      root.dataset.orient = L.vert ? 'portrait' : 'landscape'
      scrollRange = Math.max(1, root.offsetHeight - innerHeight)
      const mid = pointAt(main, len / 2)
      place(chip, mid[0], mid[1], h)
      stackEls.forEach((el, k) => {
        const pts = lanePath(L, stackShift[k][0], stackShift[k][1])
        const p = pointAt(pts, pathLength(pts) * 0.5)
        place(el, p[0], p[1], h)
      })
      txEls.forEach((el, k) => {
        const pts = lanePath(L, LANES[k] * C, 0)
        const p = pointAt(pts, L.vert ? 56 : 96)
        place(el, p[0], p[1], h)
      })
    }
    const { s: sa, out } = split(st.scroll)
    const s = Math.min(1, sa / CORE)
    const [cx, cy, z] = camera(s, out, L, w, h)

    // Reveals follow the scroll but never faster than their own pace, so a
    // quick scroll can't rush the server compiling or the wire drawing in.
    const srvOn = pace(0, ramp(s, 0.14, 0.14), 1.1, dt)
    const brwOn = pace(1, ramp(s, 0.36, 0.1), 1.0, dt)
    const draw = pace(2, ramp(s, 0.4, 0.08), 0.7, dt)
    const stackVis = ramp(s, 0.4, 0.04)
    const merge = pace(3, ramp(s, 0.47, 0.07), 1.0, dt)
    const tx = pace(4, ramp(s, 0.8, 0.06), 0.7, dt)
    const chipOn = 1 - ramp(s, 0.02, 0.09)
    edge = pace(5, ramp(sa, EDGE, 0.06), 0.8, dt)
    // In the edge beat the server end of the wire slides over to the edge node.
    const ee = ss(edge)
    const mix = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] - v) * ee)
    const edgeRect: Rect = [L.edge[0], L.edge[1], L.edge[2], L.edge[2]]
    const ta = mix(L.ta, L.edgePort) as V2
    const drop = L.vert ? DROP * ee : 0
    const brwR: Rect = [L.brw[0], L.brw[1] - drop, L.brw[2], L.brw[3]]
    const tb: V2 = [L.tb[0], L.tb[1] - drop]
    if (ee !== laneAt) {
      laneAt = ee
      brwEl.style.translate = `0 ${drop}px`
      main = lanePath({ ...L, ta, tb }, 0, 0)
      len = pathLength(main)
      // On the short edge wire the label sits over the edge node instead.
      const [ex, ey, er] = L.edge
      const mid = ee > 0.5 ? (L.vert ? [ex + er, ey] : [ex, ey + er + 16]) : pointAt(main, len / 2)
      place(chip, mid[0], mid[1], h)
    }
    const conv = ramp(s, 0.12, 0.06) * (1 - ramp(s, 0.3, 0.06))
    live = s >= 0.56 && out < 0.9

    if (dt > 0) {
      // Scripted demo clicks, then it's the visitor's turn.
      if (live && !demoDone && s >= 0.6 && s < 0.8) {
        demo = Math.max(demo, 0) + dt
        const at = 0.6 + clicks
        if (clicks < 3 && demo >= at) {
          clicks++
          flash(button, 'pressed')
          queued++
        }
        if (demo >= 3.4) {
          demoDone = true
          button.classList.add('your-turn')
        }
      }
      if (demo >= 0 && !demoDone) {
        const t = demo - (0.6 + clicks - 1)
        ghost.style.opacity = String(clamp01(demo * 4) * (s >= 0.6 && s < 0.8 ? 1 : 0))
        ghost.classList.toggle('down', clicks > 0 && t >= 0 && t < 0.15)
      } else ghost.style.opacity = '0'

      if (live) {
        // In the transport beat, keepalive pings walk the three lanes.
        // Stateless holds no connection open, so no keepalives in the edge beat.
        if (tx > 0.5 && edge < 0.5) {
          ping -= dt
          if (ping <= 0 && !up && !dn && queued === 0) {
            lane = LANES[(LANES.indexOf(lane) + 1) % 3]
            dn = { t: 0, lane, i: 0.55 }
            ping = 0.8
          }
        } else lane = 0
        if (queued > 0 && !up && !(dn && dn.i > 0.9)) {
          queued--
          send()
        }
      } else {
        up = dn = null
        queued = 0
      }
      if (up) {
        const before = up.t
        up.t += dt
        if (before < ARC && up.t >= ARC) onServer()
        if (up.t > 0.4) up = null
      }
      if (dn) {
        const before = dn.t
        dn.t += dt
        if (before < ARC && dn.t >= ARC && dn.i > 0.9) onBrowser()
        if (dn.t > 0.4) dn = null
      }
      srvHit = Math.max(0, srvHit - dt * 2.2)
      brwHit = Math.max(0, brwHit - dt * 2.2)
      chipT += dt
    }
    const arcU = (a: Arc | null): [number, number, number, number] =>
      a && a.t >= 0
        ? [(len * Math.min(a.t, ARC)) / ARC, a.i * Math.exp(-Math.max(0, a.t - ARC) * 6), a.lane, 0]
        : [0, 0, 0, 0]

    set('u_cam', cx, cy, z)
    // Scrolling energizes the board: its clock runs up to 3.5x faster and it glows.
    const sv = dt > 0 ? (Math.abs(st.scroll - lastScroll) * scrollRange) / dt : 0
    lastScroll = st.scroll
    energy += (Math.min(1, sv / 1400) - energy) * (1 - Math.exp(-dt * (sv > 0 ? 6 : 1.5)))
    flow += dt * (1 + 2.5 * energy)
    set('u_flow', flow)
    set('u_energy', energy)
    set('u_out', out * 0.8)
    set('u_amb', 1 - 0.6 * srvOn)
    set('u_srv', ...mix(L.srv, edgeRect))
    set('u_brw', ...brwR)
    set('u_ta', ...ta)
    set('u_tb', ...tb)
    set('u_vert', L.vert ? 1 : 0)
    set('u_srvOn', srvOn)
    set('u_brwOn', brwOn)
    set('u_srvHit', srvHit)
    set('u_brwHit', brwHit)
    set('u_conv', conv)
    set('u_draw', draw)
    set('u_stack', stackVis, merge)
    set('u_tx', tx * (1 - ee))
    set('u_arcUp', ...arcU(up))
    set('u_arcDn', ...arcU(dn))
    // The chip uniform is the hero's chip early on and the edge node later.
    const onHero = sa < 0.4
    set('u_chip', ...(onHero ? L.chip : L.edge), onHero ? chipOn : edge)

    // HTML overlays share the camera: one transform maps world to screen.
    world.style.transform = `translate(${w / 2 - cx * z}px, ${h / 2 - (h - cy) * z}px) scale(${z})`
    const fade = clamp01(1 - out * 2.2)
    const at = onHero ? 'hero' : 'edge'
    if (at !== coreAt) {
      coreAt = at
      const c = onHero ? L.chip : L.edge
      size(chipEl, [c[0], c[1], c[2], c[2]], h)
      if (L.vert) place(edgeEl, L.edge[0] - L.edge[2], L.edge[1], h)
      else place(edgeEl, L.edge[0], L.edge[1] - L.edge[2] - 10, h)
    }
    chipEl.style.opacity = String(onHero ? ramp(chipOn, 0.4, 0.6) : ramp(edge, 0.3, 0.6) * fade)
    edgeEl.style.opacity = String(ramp(edge, 0.5, 0.5) * fade)
    setText(srvTag, edge > 0.5 ? 'origin' : 'server')
    srvEl.style.opacity = String(ramp(srvOn, 0.55, 0.45) * fade * (1 - 0.6 * ee))
    brwEl.style.opacity = String(ramp(brwOn, 0.5, 0.5) * fade)
    const cardOn = live && brwOn > 0.9 && fade > 0.5
    if (button.disabled === cardOn) {
      button.disabled = !cardOn
      brwEl.toggleAttribute('inert', !cardOn)
    }
    chip.style.opacity = String(live ? clamp01(1 - (chipT - 0.5) / 0.4) * fade : 0)
    stackEls.forEach((el) => (el.style.opacity = String(stackVis * (1 - merge) * fade)))
    txEls.forEach((el, k) => {
      el.style.opacity = String(ramp(tx, 0.4, 0.6) * fade * (1 - ee))
      el.classList.toggle('on', tx > 0.5 && (up?.lane ?? dn?.lane) === LANES[k])
    })
    updateSteps(sa, out)
  }

  const hero = createShaderHero(root, canvas, storyFrag, UNIFORMS, frame)
  // Without WebGL the copy still steps through on scroll over a static grid.
  const onScroll = () => {
    const r = root.getBoundingClientRect()
    const { s, out } = split(clamp01(-r.top / Math.max(1, r.height - innerHeight)))
    updateSteps(s, out)
  }
  if (!hero) {
    root.classList.add('no-gl')
    addEventListener('scroll', onScroll, { passive: true })
    onScroll()
  }

  const onAdd = () => {
    button.classList.remove('your-turn')
    if (reduce.matches || !hero) {
      count++
      setText(serverCount, String(count))
      setText(browserCount, String(count))
      hero?.still()
      return
    }
    queued = Math.min(queued + 1, 4)
  }
  button.addEventListener('click', onAdd)

  // Stops, as page scroll offsets: the hero, each beat, and the end of the
  // story. Scrolling snaps between them (see snap.ts); reduced motion keeps
  // native scrolling.
  const stops = () => {
    const r = root.getBoundingClientRect()
    const range = r.height - innerHeight
    const top = scrollY + r.top
    const st = [0, ...NEXT.map(([t]) => (t < 0 ? 1 : t * (1 - TAIL)))].map((f) => Math.round(top + f * range))
    // The story starts just under the nav: the hero stop is the page top.
    if (top < innerHeight) st[0] = 0
    return st
  }
  const snap = snapScroll(stops, () => !!hero && !reduce.matches)

  const onNext = () => {
    if (!snap.go(1)) scrollTo(0, stops()[Math.max(0, cur) + 1] ?? stops().at(-1)!)
  }
  next.addEventListener('click', onNext)

  return () => {
    button.removeEventListener('click', onAdd)
    next.removeEventListener('click', onNext)
    removeEventListener('scroll', onScroll)
    snap.destroy()
    hero?.destroy()
  }
}
