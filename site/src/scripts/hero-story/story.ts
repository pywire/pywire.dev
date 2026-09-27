// "The live conduit" hero: a pinned scroll story over a circuit-board grid.
//   0 hero      the pywire chip sits on a live circuit board
//   1 python    the server card compiles out of the grid (a .wire component)
//   2 conduit   the old stack's tangle of routes merges into one live wire
//   3 patch     a click crosses the wire, the server bumps state, and only the
//               changed text node patches; three scripted clicks, then yours
//   4 transport the conduit splits into WebSocket, WebTransport, long polling
//   5 edge      stateless: the server and its wire go, a world map of edge
//               locations comes up, and you travel around it; every click
//               lands on whichever edge is nearest
// The camera frames each beat; HTML cards ride the same camera transform.
import { createShaderHero, reducedMotion, type HeroState } from './runtime'
import { storyFrag } from './shader'
import { snapScroll } from './snap'
import { EDGES, MAP_H, MAP_W, TRIP, project } from './world'

type V2 = [number, number]
/** Center x, y (world, origin bottom-left) and half width, half height. */
type Rect = [number, number, number, number]
interface Layout {
  srv: Rect
  brw: Rect
  /** The hero's chip: center x, y and half size. */
  chip: [number, number, number]
  /** The edge beat's world map, and where the browser moves for it. */
  map: Rect
  brwEdge: V2
  /** Base zoom: the diagram scaled to fit the screen, and the screen band
   * (top-down) it has to fit in, above the step copy. */
  z0: number
  band: V2
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
const ARC = 0.07 // seconds for an arc to cross the wire
const HOP = 0.16 // seconds for a packet to cross to an edge on the map
const GLIDE = 1.3 // seconds travelling between two cities
const STAY = 1.5 // seconds in each city
const MAP_AR = MAP_W / MAP_H
const LANES = [-1, 0, 1]

/** Where the page's copy sits (screen px, top-down), measured from the DOM. */
interface Fit {
  /** Top of the tallest step copy. */
  copyTop: number
  /** Bottom of the hero copy, and top of the next button on the hero. */
  heroBottom: number
  nextTop: number
}

function layout(w: number, h: number, fit: Fit): Layout {
  const portrait = w < 800 || w / h < 1.05
  // Positions are picked top-down, then flipped into world space.
  const y = (top: number) => h - top
  if (portrait) {
    // The server card above the browser, fitted into the band above the step
    // copy: the base camera (w/2, h/2, z0) scales the pair up on tablets and
    // down on short phones (Safari with its toolbars showing).
    const top = Math.max(20, h * 0.05)
    const bottom = Math.max(top + 120, fit.copyTop - 18)
    const room = bottom - top
    const bw = 150
    const bh = 88
    const gap = 64 + 40 * clamp01((room - 300) / 200)
    const need = 128 + gap + 2 * bh
    const z0 = Math.min(1.5, (0.88 * w) / (2 * bw), room / need)
    // Screen top-down to world top-down, through the base camera.
    const wy = (v: number) => h / 2 + (v - h / 2) / z0
    const t0 = wy(top) + (room / z0 - need) / 2
    const srv: Rect = [sn(w * 0.5), sn(y(t0 + 64)), 136, 64]
    const brw: Rect = [sn(w * 0.5), sn(y(t0 + 128 + gap + bh)), bw, bh]
    // The hero's chip sits between the hero copy and the next button, if it fits.
    const hg = fit.nextTop - fit.heroBottom
    const ch = Math.round(Math.min(52, w * 0.13, hg / 2 - 30))
    // The map takes the server card's place, over the browser.
    const brwTop = h / 2 + (y(brw[1] + brw[3]) - h / 2) * z0
    const mh = Math.min(Math.min(w * 0.96, 720) / MAP_AR, brwTop - top - 24)
    const mc = (top + brwTop - 12) / 2
    return {
      srv,
      brw,
      map: [sn(w * 0.5), y(wy(mc)), (mh * MAP_AR) / 2 / z0, mh / 2 / z0],
      brwEdge: [brw[0], brw[1]],
      chip: ch >= 22 ? [sn(w * 0.5), sn(y((fit.heroBottom + fit.nextTop) / 2)), ch] : [0, 0, 0],
      ta: [srv[0] - C, srv[1] - srv[3]],
      tb: [brw[0] + C, brw[1] + brw[3]],
      vert: true,
      z0,
      band: [top, bottom],
    }
  }
  // Landscape: the diagram is laid out for a W x H screen, at least 1440 x 900,
  // and the base camera (w/2, h/2, z0) scales it down to fit, so smaller
  // screens (tablets, Safari with its toolbars) get the same composition.
  const top = Math.max(24, h * 0.06)
  const bottom = fit.copyTop - 16
  const z0 = Math.min(1, w / 1440, (bottom - top) / 300)
  const W = w / z0
  const H = h / z0
  const bw = Math.min(210, W * 0.17)
  const bh = Math.min(136, H * 0.17)
  // Virtual to world, top-down: the virtual screen's center lands on the
  // camera's, unless that runs the browser into the copy; then the pair
  // centers in the band above the copy instead.
  const wy = (v: number) => h / 2 + (v - h / 2) / z0
  const [st, bb] = [H * 0.33 - 80, H * 0.4 + bh]
  let shift = (h - H) / 2
  if (wy(bottom) < bb + shift) shift = wy((top + bottom) / 2) - (st + bb) / 2
  const dx = sn((w - W) / 2)
  const dy = -sn(shift)
  const srv: Rect = [sn(W * 0.2) + dx, sn(h - H * 0.33) + dy, 148, 80]
  const brw: Rect = [sn(W * 0.7) + dx, sn(h - H * 0.4) + dy, bw, bh]
  const ch = Math.round(Math.min(88, Math.max(56, w * 0.055)))
  // The map spans the top; the browser tucks under it, right of the copy.
  // Picked on screen, then taken through the base camera into the world.
  const wx = (v: number) => w / 2 + (v - w / 2) / z0
  const mh = Math.min(h * 0.21, (w * 0.46) / MAP_AR)
  const mt = h * 0.09
  const bt = Math.max(mt + 2 * mh + bh * z0 + 28, h * 0.62)
  return {
    srv,
    brw,
    map: [w / 2, y(wy(mt + mh)), (mh * MAP_AR) / z0, mh / z0],
    brwEdge: [wx(Math.min(w * 0.78, w - bw * z0 - 48)), y(wy(bt))],
    chip: [sn(w * 0.72), sn(h * 0.5), ch],
    ta: [srv[0] + srv[2], srv[1]],
    tb: [brw[0] - brw[2], brw[1]],
    vert: false,
    z0,
    band: [0, fit.copyTop],
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
  const { srv, brw, z0 } = L
  // Frame both cards; on landscape keep the pair in the top of the screen so
  // the step copy has the bottom. Portrait centers on the cards (on the grid).
  const both: V2 = [(srv[0] + brw[0]) / 2, h / 2]
  let patch: V2 = [(srv[0] + brw[0]) / 2, (srv[1] + brw[1]) / 2 - 90]
  let zs = 1.7 * z0
  let zp = 1.18 * z0
  let focus: V2 = [srv[0], srv[1] - 30]
  if (L.vert) {
    // Portrait: zoom about the middle of the band, so what's in the band stays in it.
    const mid = (L.band[0] + L.band[1]) / 2
    const room = L.band[1] - L.band[0]
    const aim = (p: number, z: number) => p + (mid - h / 2) / z // world y seen at `mid`
    zs = Math.min(1.35 * Math.max(1, z0), (0.94 * w) / (2 * srv[2]), room / 150)
    zp = Math.min(1.06 * z0, (0.94 * w) / (2 * brw[2]))
    focus = [srv[0], aim(srv[1], zs)]
    patch = [srv[0], aim(h / 2 - (mid - h / 2) / z0, zp)]
  }
  const k = keyed(s, [
    [0.06, ...c, 1],
    [0.2, ...focus, zs],
    [0.32, ...focus, zs],
    [0.44, ...both, z0],
    [0.56, ...both, z0],
    [0.64, ...patch, zp],
    [0.76, ...patch, zp],
    [0.86, ...both, z0],
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
  const mapEl = q('[data-ov="map"]')
  const beacons = [...root.querySelectorAll<SVGGElement>('[data-beacon]')]
  const link = root.querySelector<SVGLineElement>('[data-link]')!
  const packet = root.querySelector<SVGCircleElement>('[data-packet]')!
  const you = root.querySelector<SVGGElement>('[data-you]')!
  const youMark = you.firstElementChild as SVGGElement
  const edgeAt = EDGES.map(([, lon, lat]) => project(lon, lat))
  const cities = TRIP.map(([lon, lat]) => project(lon, lat))
  const next = q<HTMLButtonElement>('[data-next]')
  const nextLabel = q('[data-next-label]')

  let count = 0
  let geom = ''
  let L = layout(1, 1, { copyTop: 1, heroBottom: 0, nextTop: 1 })
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
  // The edge beat: where you are on the trip, the edge serving you, and the
  // edge your latest event went to.
  let leg = 0
  let legT = GLIDE
  let near = -1
  let sentTo = 0
  let youAt: V2 = cities[0]
  let edgeClick = 9 // seconds since the trip last clicked
  let brwAt = ''
  let chipAt: V2 = [0, 0]
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
  const flash = (el: Element, cls: string) => {
    el.classList.remove(cls)
    void el.getBoundingClientRect()
    el.classList.add(cls)
  }
  const send = () => {
    up = { t: 0, lane, i: 1 }
    // Stateless: the event carries its signed state along to the nearest edge.
    setText(chipText, edge > 0.5 ? '@click + state' : '@click')
    sentTo = Math.max(0, near)
    if (edge > 0.5) flash(youMark, 'hit')
    chipT = 0
  }
  const onServer = () => {
    count++
    setText(serverCount, String(count))
    if (edge < 0.5) flash(srvEl, 'hit')
    else flash(beacons[sentTo], 'hit')
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

  // The edge beat on the map (in map units): you, the edge nearest you, and
  // an event's packet crossing to its edge and the patch coming back.
  const trip = (on: number) => {
    const a = cities[leg]
    const b = cities[(leg + 1) % cities.length]
    // The last leg heads east over the Pacific and wraps around.
    const bx = b[0] < a[0] ? b[0] + MAP_W : b[0]
    const t = ss(Math.min(1, legT / GLIDE))
    youAt = [(a[0] + (bx - a[0]) * t) % MAP_W, a[1] + (b[1] - a[1]) * t]
    let n = 0
    edgeAt.forEach((e, i) => {
      const d = (p: V2) => Math.hypot(p[0] - youAt[0], p[1] - youAt[1])
      if (d(e) < d(edgeAt[n])) n = i
    })
    if (n !== near) {
      beacons[near]?.classList.remove('on')
      beacons[n].classList.add('on')
      near = n
    }
    you.setAttribute('transform', `translate(${youAt[0].toFixed(2)} ${youAt[1].toFixed(2)})`)
    you.style.opacity = String(on)
    const e = edgeAt[near]
    link.setAttribute('x1', youAt[0].toFixed(2))
    link.setAttribute('y1', youAt[1].toFixed(2))
    link.setAttribute('x2', String(e[0]))
    link.setAttribute('y2', String(e[1]))
    link.style.opacity = String(on * 0.9)
    // Packet: out along the link, then the patch back.
    let f = -1
    let o = 0
    if (dn && dn.t >= 0 && dn.i > 0.9) {
      f = 1 - Math.min(1, dn.t / HOP)
      o = clamp01(1 - (dn.t - HOP) * 8)
    } else if (up) {
      f = Math.min(1, up.t / HOP)
      o = 1
    }
    const to = edgeAt[sentTo]
    if (f >= 0) {
      packet.setAttribute('cx', (youAt[0] + (to[0] - youAt[0]) * f).toFixed(2))
      packet.setAttribute('cy', (youAt[1] + (to[1] - youAt[1]) * f).toFixed(2))
    }
    packet.style.opacity = String(o * on)
    link.classList.toggle('busy', f >= 0 && o > 0.5)
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
      L = layout(w, h, {
        copyTop: Math.min(...steps.slice(1).map((el) => el.offsetTop)),
        heroBottom: steps[0].offsetTop + steps[0].offsetHeight,
        // On the hero the next button sits 80px up, plus what's kept clear (see .next).
        nextTop: h - 80 - clear() - next.offsetHeight,
      })
      main = lanePath(L, 0, 0)
      len = pathLength(main)
      size(srvEl, L.srv, h)
      size(brwEl, L.brw, h)
      size(chipEl, [L.chip[0], L.chip[1], L.chip[2], L.chip[2]], h)
      size(mapEl, L.map, h)
      // Keep the map's markers and labels legible when the map is small.
      const k = Math.min(2.4, Math.max(1, (11 * MAP_W) / (3.6 * 2 * L.map[2] * L.z0))).toFixed(2)
      beacons.forEach((b) => b.setAttribute('transform', `scale(${k})`))
      youMark.setAttribute('transform', `scale(${k})`)
      packet.setAttribute('r', String(1.3 * +k))
      mapEl.style.setProperty('--k', k)
      brwAt = ''
      root.dataset.orient = L.vert ? 'portrait' : 'landscape'
      scrollRange = Math.max(1, root.offsetHeight - innerHeight)
      chipAt = pointAt(main, len / 2)
      stackEls.forEach((el, k) => {
        const pts = lanePath(L, stackShift[k][0], stackShift[k][1])
        const p = pointAt(pts, pathLength(pts) * 0.5)
        place(el, p[0], p[1], h)
      })
      const lanes = LANES.map((o) => lanePath(L, o * C, 0))
      // Portrait: the labels stack beside the lanes, where there's room.
      const right = Math.max(...lanes.flat().map((p) => p[0])) + 10
      const mid = (L.ta[1] + L.tb[1]) / 2
      // Keep them on screen: portrait frames this beat at (srv x, h/2, z0).
      const rim = L.srv[0] + (w / 2 - 8) / L.z0
      txEls.forEach((el, k) => {
        const x = Math.min(right, rim - el.offsetWidth)
        const p = L.vert ? [x, mid + (1 - k) * 20] : pointAt(lanes[k], 96)
        place(el, p[0], p[1], h)
      })
    }
    const { s: sa, out } = split(st.scroll)
    const s = Math.min(1, sa / CORE)
    const cam = camera(s, out, L, w, h)

    // Reveals follow the scroll but never faster than their own pace, so a
    // quick scroll can't rush the server compiling or the wire drawing in.
    const srvOn = pace(0, ramp(s, 0.14, 0.14), 1.1, dt)
    const brwOn = pace(1, ramp(s, 0.36, 0.1), 1.0, dt)
    const draw = pace(2, ramp(s, 0.4, 0.08), 0.7, dt)
    const stackVis = ramp(s, 0.4, 0.04)
    const merge = pace(3, ramp(s, 0.47, 0.07), 1.0, dt)
    const tx = pace(4, ramp(s, 0.8, 0.06), 0.7, dt)
    const chipOn = 1 - ramp(s, 0.02, 0.09)
    edge = pace(5, ramp(sa, EDGE, 0.06), 1.2, dt)
    // In the edge beat the server and its wire go, and the browser makes room
    // for the map.
    const ee = ss(edge)
    const gone = 1 - ramp(edge, 0, 0.4)
    const bx = (L.brwEdge[0] - L.brw[0]) * ee
    const by = (L.brwEdge[1] - L.brw[1]) * ee
    const brwR: Rect = [L.brw[0] + bx, L.brw[1] + by, L.brw[2], L.brw[3]]
    const tb: V2 = [L.tb[0] + bx, L.tb[1] + by]
    // Landscape recenters on the map; portrait is framed for it already.
    const cx = L.vert ? cam[0] : cam[0] + (w / 2 - cam[0]) * ee
    const cy = L.vert ? cam[1] : cam[1] + (h / 2 - cam[1]) * ee
    const z = cam[2]
    const bk = `${bx.toFixed(1)} ${by.toFixed(1)}`
    if (bk !== brwAt) {
      brwAt = bk
      brwEl.style.translate = `${bx}px ${-by}px`
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
      // The trip: glide to the next city, stay a moment, click on arrival.
      if (edge > 0.9) {
        legT += dt
        if (legT >= GLIDE + STAY) {
          legT -= GLIDE + STAY
          leg = (leg + 1) % cities.length
        }
        // Two clicks in each city: on arrival, then once more.
        const clicked = (at: number) => legT - dt < at && legT >= at
        if (live && (clicked(GLIDE) || clicked(GLIDE + 0.8))) {
          flash(button, 'pressed')
          edgeClick = 0
          queued = Math.min(queued + 1, 4)
        }
      }
      edgeClick += dt
      // The cursor that presses Add one: the scripted demo in beat 3, then
      // every click on the trip in the edge beat.
      if (demo >= 0 && !demoDone) {
        const t = demo - (0.6 + clicks - 1)
        ghost.style.opacity = String(clamp01(demo * 4) * (s >= 0.6 && s < 0.8 ? 1 : 0))
        ghost.classList.toggle('down', clicks > 0 && t >= 0 && t < 0.15)
      } else if (edge > 0.9 && live) {
        ghost.style.opacity = String(clamp01((edge - 0.9) * 10))
        ghost.classList.toggle('down', edgeClick < 0.15)
      } else ghost.style.opacity = '0'
      const hop = edge > 0.5 ? HOP : ARC
      if (up) {
        const before = up.t
        up.t += dt
        if (before < hop && up.t >= hop) onServer()
        if (up.t > 0.4) up = null
      }
      if (dn) {
        const before = dn.t
        dn.t += dt
        if (before < hop && dn.t >= hop && dn.i > 0.9) onBrowser()
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
    set('u_amb', (1 - 0.6 * srvOn) * (1 - 0.5 * ee))
    set('u_srv', ...L.srv)
    set('u_brw', ...brwR)
    set('u_ta', ...L.ta)
    set('u_tb', ...tb)
    set('u_vert', L.vert ? 1 : 0)
    set('u_srvOn', srvOn * gone)
    set('u_brwOn', brwOn)
    set('u_srvHit', srvHit)
    set('u_brwHit', brwHit)
    set('u_conv', conv)
    set('u_draw', draw * gone)
    set('u_stack', stackVis, merge)
    set('u_tx', tx * gone)
    set('u_arcUp', ...arcU(up))
    set('u_arcDn', ...arcU(dn))
    set('u_chip', ...L.chip, L.chip[2] ? chipOn : 0)

    // HTML overlays share the camera: one transform maps world to screen.
    world.style.transform = `translate(${w / 2 - cx * z}px, ${h / 2 - (h - cy) * z}px) scale(${z})`
    const fade = clamp01(1 - out * 2.2)
    chipEl.style.opacity = String(L.chip[2] ? ramp(chipOn, 0.4, 0.6) : 0)
    const mapOn = ramp(edge, 0.25, 0.5) * fade
    mapEl.style.opacity = String(mapOn)
    if (mapOn > 0) trip(ramp(edge, 0.75, 0.25))
    // Stateless: no one server holds the app any more; it runs on every node.
    srvEl.style.opacity = String(ramp(srvOn, 0.55, 0.45) * fade * gone)
    brwEl.style.opacity = String(ramp(brwOn, 0.5, 0.5) * fade)
    const cardOn = live && brwOn > 0.9 && fade > 0.5
    if (button.disabled === cardOn) {
      button.disabled = !cardOn
      brwEl.toggleAttribute('inert', !cardOn)
    }
    if (edge > 0.5) {
      // In the edge beat the event label rides along with you.
      const u = L.map[2] / MAP_W
      place(chip, L.map[0] - L.map[2] + youAt[0] * 2 * u, L.map[1] + L.map[3] - youAt[1] * 2 * u, h)
    } else place(chip, chipAt[0], chipAt[1], h)
    chip.style.opacity = String(live ? clamp01(1 - (chipT - 0.5) / 0.4) * fade : 0)
    stackEls.forEach((el) => (el.style.opacity = String(stackVis * (1 - merge) * fade)))
    txEls.forEach((el, k) => {
      el.style.opacity = String(ramp(tx, 0.4, 0.6) * fade * gone)
      el.classList.toggle('on', tx > 0.5 && (up?.lane ?? dn?.lane) === LANES[k])
    })
    updateSteps(sa, out)
  }

  // The stage is 100svh, but some browsers show less than that (iPhone Safari
  // counts the strip under its floating toolbar); keep the part below what's
  // shown clear, so the copy and the next button stay in view.
  let over = 0
  const clear = () => over + (parseFloat(getComputedStyle(root).getPropertyValue('--dock')) || 0)
  const fitOver = () => {
    const vv = visualViewport
    if (vv && Math.abs(vv.scale - 1) > 0.01) return // pinch zoom
    const v = Math.max(0, Math.round(canvas.clientHeight - (vv?.height ?? innerHeight)))
    if (v === over) return
    over = v
    root.style.setProperty('--over', `${v}px`)
    geom = ''
  }
  fitOver()
  visualViewport?.addEventListener('resize', fitOver)
  addEventListener('resize', fitOver)

  const hero = createShaderHero(root, canvas, storyFrag, UNIFORMS, frame)
  // The layout measures the copy, which moves once the web fonts load.
  void document.fonts?.ready.then(() => (geom = ''))
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
    visualViewport?.removeEventListener('resize', fitOver)
    removeEventListener('resize', fitOver)
    snap.destroy()
    hero?.destroy()
  }
}
