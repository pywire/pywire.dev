// "The camera story" hero: a pinned scroll story in four steps. The camera
// zooms into the server node, follows the wire and pulls back to the page,
// then a live counter runs the pywire loop for real: a click in the page
// sends an event up the wire, the server's state changes, and a diff comes
// back down and patches the card.
import { createShaderHero, reducedMotion, type HeroState } from './runtime'
import { storyFrag } from './shader'

type V2 = [number, number]
interface Layout {
  node: V2
  nodeS: number
  panel: [number, number, number, number]
  ta: V2
  tb: V2
  vert: boolean
}

const C = 32
const sn = (v: number) => Math.round(v / C) * C
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const ss = (t: number) => t * t * (3 - 2 * t)
const TAIL = 1 / 4.5 // share of the scroll spent pulling the camera out
const stepOf = (s: number) => (s < 0.22 ? 0 : s < 0.5 ? 1 : s < 0.76 ? 2 : 3)

// World space is CSS px of the stage with the origin at the bottom-left.
function layout(w: number, h: number, portrait: boolean): Layout {
  if (portrait) {
    const node: V2 = [sn(w * 0.5), sn(h * 0.84)]
    const panel: Layout['panel'] = [w * 0.07, h * 0.4, w * 0.86, h * 0.34]
    return {
      node,
      nodeS: 6,
      panel,
      ta: [node[0], node[1] - 16],
      tb: [sn(panel[0] + panel[2] * 0.3), sn(panel[1] + panel[3])],
      vert: true,
    }
  }
  const node: V2 = [sn(w * 0.1), sn(h * 0.78)]
  const panel: Layout['panel'] = [w * 0.5, h * 0.14, w * 0.43, h * 0.7]
  return {
    node,
    nodeS: 6,
    panel,
    ta: [node[0] + 16, node[1]],
    tb: [sn(panel[0]), sn(panel[1] + panel[3] * 0.62)],
    vert: false,
  }
}

/** The wire as polyline points, matching `lane()` in the shader. */
function wirePath(L: Layout): V2[] {
  const sw = (p: V2): V2 => (L.vert ? [p[1], p[0]] : p)
  const A = sw(L.ta)
  const B = sw(L.tb)
  const mx = Math.floor(((A[0] + B[0]) * 0.5) / C + 0.5) * C
  return [A, [mx, A[1]], [mx, B[1]], B].map((p) => sw(p as V2))
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

/** The live card, the page layout's bottom-right region, snapped like the shader's `R()`. */
function cardRect(L: Layout) {
  const [px, py, pw, ph] = L.panel
  const lo: V2 = [sn(px + 0.62 * pw), sn(py)]
  const hi: V2 = [Math.max(sn(px + pw), lo[0] + C), Math.max(sn(py + 0.5 * ph), lo[1] + C)]
  return { lo, hi }
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
  // Portrait: frame the node a little lower so its chip (above it) stays in view.
  const n: V2 = L.vert ? [L.node[0], L.node[1] + 24] : L.node
  const zn = L.vert ? 2 : 2.4
  const m: V2 = [(L.ta[0] + L.tb[0]) / 2, (L.ta[1] + L.tb[1]) / 2]
  const k = keyed(s, [
    [0.1, ...c, 1],
    [0.3, ...n, zn],
    [0.44, ...n, zn],
    [0.58, ...m, 1.4],
    [0.68, ...m, 1.4],
    [0.86, ...c, 1],
  ])
  k[2] *= 1 - 0.3 * ss(out)
  return k
}

const UNIFORMS = [
  'u_s',
  'u_out',
  'u_node',
  'u_nodeS',
  'u_panel',
  'u_ta',
  'u_tb',
  'u_cam',
  'u_vert',
  'u_pk',
  'u_hit',
  'u_patch',
  'u_live',
]

export function mountStory(root: HTMLElement) {
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!
  const world = root.querySelector<HTMLElement>('[data-world]')!
  const steps = [...root.querySelectorAll<HTMLElement>('[data-step]')]
  const bar = root.querySelector<HTMLElement>('[data-progress]')
  const el = (name: string) => root.querySelector<HTMLElement>(`[data-ov="${name}"]`)!
  const ov = {
    server: el('server'),
    browser: el('browser'),
    card: el('card'),
    diff: el('diff'),
    event: el('event'),
  }
  const serverCount = root.querySelector<HTMLElement>('[data-count="server"]')!
  const browserCount = root.querySelector<HTMLElement>('[data-count="browser"]')!
  const diffCount = root.querySelector<HTMLElement>('[data-count="diff"]')!
  const button = root.querySelector<HTMLButtonElement>('[data-add]')!
  const reduce = reducedMotion()

  // Live loop state.
  let count = 0
  let shown = 0
  let diff = -1 // distance along the wire, server -> browser
  let event = -1 // distance along the wire, browser -> server
  let queued = 0 // clicks waiting to be sent
  let hit = 0
  let patch = 0
  let auto = 1.2
  let live = false
  let geom = ''
  let L = layout(1, 1, false)
  let pts = wirePath(L)
  let len = 1
  let cur = -2
  let cardOn = false

  const setCount = (n: HTMLElement, v: number) => {
    n.textContent = String(v)
  }
  const land = () => {
    shown = count
    setCount(browserCount, shown)
    patch = 1
  }
  const bump = () => {
    count++
    setCount(serverCount, count)
    setCount(diffCount, count)
    hit = 1
  }

  const place = (node: HTMLElement, x: number, y: number, h: number) => {
    node.style.transform = `translate(${x}px, ${h - y}px)`
  }

  const split = (p: number) => ({ s: Math.min(1, p / (1 - TAIL)), out: Math.max(0, (p - (1 - TAIL)) / TAIL) })
  const updateSteps = (s: number, out: number) => {
    let i = stepOf(s)
    if (out > 0.2) i = -1
    if (i !== cur) {
      cur = i
      steps.forEach((node, j) => node.classList.toggle('on', j === i))
      root.dataset.step = String(i)
    }
    if (bar) bar.style.transform = `scaleX(${s})`
  }

  const frame = (st: HeroState, set: (n: string, ...v: number[]) => void) => {
    const { w, h, dt } = st
    const portrait = w < 800 || w / h < 1.05
    const key = `${w}x${h}`
    if (key !== geom) {
      geom = key
      L = layout(w, h, portrait)
      pts = wirePath(L)
      len = pathLength(pts)
      const { lo, hi } = cardRect(L)
      Object.assign(ov.card.style, {
        left: `${lo[0]}px`,
        top: `${h - hi[1]}px`,
        width: `${hi[0] - lo[0]}px`,
        height: `${hi[1] - lo[1]}px`,
      })
      place(ov.server, L.node[0], L.node[1], h)
      place(ov.browser, sn(L.panel[0]), sn(L.panel[1] + L.panel[3]), h)
      root.dataset.orient = portrait ? 'portrait' : 'landscape'
    }
    const { s, out } = split(st.scroll)
    const [cx, cy, z] = camera(s, out, L, w, h)

    // The loop runs once the wire is fully drawn and the page is showing.
    live = s >= 0.7 && out < 0.85
    if (dt > 0) {
      const speed = len / 1.1
      if (live) {
        if (event >= 0) {
          event -= speed * 1.25 * dt
          if (event <= 0) {
            event = -1
            bump()
            diff = 0
          }
        } else if (queued > 0 && diff < 0) {
          queued--
          event = len
        }
        if (diff >= 0) {
          diff += speed * dt
          if (diff >= len) {
            diff = -1
            land()
          }
        }
        auto -= dt
        if (auto <= 0 && diff < 0 && event < 0 && queued === 0) {
          bump()
          diff = 0
          auto = 2.8
        }
      } else {
        diff = -1
        event = -1
        queued = 0
        if (shown !== count) land()
      }
      hit = Math.max(0, hit - dt * 1.6)
      patch = Math.max(0, patch - dt * 1.3)
    }

    set('u_s', s)
    set('u_out', out * 0.8)
    set('u_node', ...L.node)
    set('u_nodeS', L.nodeS)
    set('u_panel', ...L.panel)
    set('u_ta', ...L.ta)
    set('u_tb', ...L.tb)
    set('u_cam', cx, cy, z)
    set('u_vert', L.vert ? 1 : 0)
    set('u_pk', diff, event)
    set('u_hit', hit)
    set('u_patch', patch)
    set('u_live', live ? 1 : 0)

    // HTML overlays share the camera: one transform maps world to screen.
    world.style.transform = `translate(${w / 2 - cx * z}px, ${h / 2 - (h - cy) * z}px) scale(${z})`
    const fadeOut = clamp01(1 - out * 2.2)
    const grow = ss(clamp01((s - 0.74) / 0.22)) * (w + h)
    const { lo, hi } = cardRect(L)
    const cardDist = Math.abs((lo[0] + hi[0]) / 2 - L.tb[0]) + Math.abs((lo[1] + hi[1]) / 2 - L.tb[1])
    const cardA = clamp01((grow - cardDist) / 160) * fadeOut
    ov.server.style.opacity = String(clamp01((s - 0.2) / 0.08) * fadeOut)
    ov.browser.style.opacity = String(clamp01((s - 0.74) / 0.06) * fadeOut)
    ov.card.style.opacity = String(cardA)
    const on = cardA > 0.6
    if (on !== cardOn) {
      cardOn = on
      button.disabled = !on
      ov.card.toggleAttribute('inert', !on)
    }
    ov.card.style.setProperty('--patch', patch.toFixed(3))
    ov.server.style.setProperty('--hit', hit.toFixed(3))
    for (const [node, d] of [
      [ov.diff, diff],
      [ov.event, event],
    ] as const) {
      if (d >= 0) {
        const [x, y] = pointAt(pts, d)
        place(node, x, y, h)
        node.style.opacity = String(fadeOut * clamp01(Math.min(d, len - d) / 60))
      } else node.style.opacity = '0'
    }

    updateSteps(s, out)
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
    if (reduce.matches || !hero) {
      // No animation: the round trip happens instantly.
      bump()
      land()
      hero?.still()
      return
    }
    queued = Math.min(queued + 1, 3)
    auto = 4
  }
  button.addEventListener('click', onAdd)

  return () => {
    button.removeEventListener('click', onAdd)
    removeEventListener('scroll', onScroll)
    hero?.destroy()
  }
}
