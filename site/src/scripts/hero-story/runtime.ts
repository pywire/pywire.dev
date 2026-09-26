// Shared runtime for the hero canvas: DPR cap, adaptive render scale, pause when
// offscreen or in a background tab, a still frame for reduced motion, and a
// smoothed pointer that drifts on its own while idle.

export interface HeroState {
  time: number
  dt: number
  mouse: [number, number]
  scroll: number
  px: number
  w: number
  h: number
  scale: number
  light: boolean
}

export interface HeroTheme {
  bg: [number, number, number]
  ink: [number, number, number]
  acc: [number, number, number]
}

const hex = (h: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]

// Mirrors --theme-{dark,light}-bg/text and --color-wire-{90,65} in _root.scss.
export const themes: Record<'dark' | 'light', HeroTheme> = {
  dark: { bg: hex('#0a0c14'), ink: hex('#e3e6ee'), acc: hex('#5feaff') },
  light: { bg: hex('#fdfdff'), ink: hex('#0e1525'), acc: hex('#00b3c4') },
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const isLight = () => !document.documentElement.classList.contains('darkmode')

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)')

interface RunnerOptions {
  /** Called every frame (or once per still frame) with the current state. */
  render(st: HeroState): void
  resize(st: HeroState): void
  /** Scene time used for the reduced-motion still frame. */
  stillTime?: number
}

/** Drives `render` for a pinned (sticky) scroll story. Returns a teardown function. */
export function runHero(section: HTMLElement, canvas: HTMLCanvasElement, o: RunnerOptions) {
  const coarse = matchMedia('(pointer: coarse)').matches
  const reduce = reducedMotion()
  const st: HeroState = { time: 0, dt: 0, mouse: [0.5, 0.5], scroll: 0, px: 1, w: 1, h: 1, scale: 1, light: isLight() }
  const target = [0.5, 0.5]
  const maxDpr = coarse ? 1.5 : 2
  let visible = false
  let raf = 0
  let last = 0
  let lastMove = -1e9
  let accT = 0
  let frames = 0
  let lastAdapt = 0

  const scrollP = () => {
    const r = section.getBoundingClientRect()
    return clamp01(-r.top / Math.max(1, r.height - innerHeight))
  }
  const still = () => {
    if (!visible) return
    st.scroll = scrollP()
    st.dt = 0
    if (reduce.matches) st.time = o.stillTime ?? 9
    o.render(st)
  }
  const measure = () => {
    const r = canvas.getBoundingClientRect()
    st.w = Math.max(1, r.width)
    st.h = Math.max(1, r.height)
    st.px = Math.min(devicePixelRatio || 1, maxDpr) * st.scale
    o.resize(st)
    if (!raf) still()
  }
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.1, (now - (last || now)) / 1000)
    last = now
    st.dt = dt
    st.time += dt
    const idle = now - lastMove > 2500
    if (idle) {
      target[0] = 0.5 + 0.3 * Math.sin(st.time * 0.23)
      target[1] = 0.5 + 0.22 * Math.sin(st.time * 0.17 + 1.3)
    }
    const k = 1 - Math.exp(-dt * (idle ? 1.2 : 5))
    st.mouse[0] += (target[0] - st.mouse[0]) * k
    st.mouse[1] += (target[1] - st.mouse[1]) * k
    st.scroll = scrollP()
    o.render(st)
    // Adaptive resolution: drop render scale when frames run long, recover slowly.
    accT += dt
    frames++
    if (frames >= 45) {
      const avg = accT / frames
      accT = 0
      frames = 0
      if (now - lastAdapt > 1500) {
        if (avg > 0.024 && st.scale > 0.5) {
          st.scale = Math.max(0.5, st.scale * 0.8)
          lastAdapt = now
          measure()
        } else if (avg < 0.0175 && st.scale < 1 && now - lastAdapt > 4000) {
          st.scale = Math.min(1, st.scale / 0.8)
          lastAdapt = now
          measure()
        }
      }
    }
  }
  const start = () => {
    if (raf || reduce.matches || document.hidden || !visible) return
    last = 0
    accT = 0
    frames = 0
    raf = requestAnimationFrame(frame)
  }
  const stop = () => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  const io = new IntersectionObserver(
    (es) => {
      visible = es[0].isIntersecting
      if (visible) {
        start()
        if (!raf) still()
      } else stop()
    },
    { rootMargin: '80px' },
  )
  io.observe(section)
  const onVis = () => (document.hidden ? stop() : start())
  const onReduce = () => {
    stop()
    start()
    still()
  }
  const onPtr = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    target[0] = (e.clientX - r.left) / r.width
    target[1] = 1 - (e.clientY - r.top) / r.height
    lastMove = performance.now()
  }
  const onTheme = () => {
    st.light = isLight()
    if (!raf) still()
  }
  const onScroll = () => {
    if (!raf && visible) still()
  }
  const ro = new ResizeObserver(measure)
  ro.observe(canvas)
  const mo = new MutationObserver(onTheme)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  document.addEventListener('visibilitychange', onVis)
  reduce.addEventListener('change', onReduce)
  section.addEventListener('pointermove', onPtr, { passive: true })
  section.addEventListener('pointerdown', onPtr, { passive: true })
  addEventListener('scroll', onScroll, { passive: true })
  measure()

  return {
    st,
    /** Render once now, e.g. after an interaction while paused for reduced motion. */
    still,
    destroy() {
      stop()
      io.disconnect()
      ro.disconnect()
      mo.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      reduce.removeEventListener('change', onReduce)
      section.removeEventListener('pointermove', onPtr)
      section.removeEventListener('pointerdown', onPtr)
      removeEventListener('scroll', onScroll)
    },
  }
}

const COMMON_UNIFORMS = ['u_res', 'u_time', 'u_mouse', 'u_light', 'u_px', 'u_bg', 'u_ink', 'u_acc'] as const

/**
 * Compile a full-screen fragment shader onto `canvas` and run it. `frame` is
 * called before each draw to set scene uniforms. Returns null without WebGL.
 */
export function createShaderHero(
  section: HTMLElement,
  canvas: HTMLCanvasElement,
  frag: string,
  uniforms: readonly string[],
  frame: (st: HeroState, set: UniformSetter) => void,
) {
  const gl = canvas.getContext('webgl', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  })
  if (!gl) return null
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s))
    return s
  }
  const prog = gl.createProgram()!
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'))
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog))
    return null
  }
  gl.useProgram(prog)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  const U: Record<string, WebGLUniformLocation | null> = {}
  for (const k of [...COMMON_UNIFORMS, ...uniforms]) U[k] = gl.getUniformLocation(prog, k)
  const set: UniformSetter = (name, ...v) => {
    const loc = U[name]
    if (v.length === 1) gl.uniform1f(loc, v[0])
    else if (v.length === 2) gl.uniform2f(loc, v[0], v[1])
    else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2])
    else gl.uniform4f(loc, v[0], v[1], v[2], v[3])
  }

  const runner = runHero(section, canvas, {
    resize(st) {
      canvas.width = Math.max(1, Math.round(st.w * st.px))
      canvas.height = Math.max(1, Math.round(st.h * st.px))
      gl.viewport(0, 0, canvas.width, canvas.height)
    },
    render(st) {
      const T = themes[st.light ? 'light' : 'dark']
      set('u_res', canvas.width, canvas.height)
      set('u_time', st.time)
      set('u_mouse', st.mouse[0], st.mouse[1])
      set('u_light', st.light ? 1 : 0)
      set('u_px', canvas.width / st.w)
      set('u_bg', ...T.bg)
      set('u_ink', ...T.ink)
      set('u_acc', ...T.acc)
      frame(st, set)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
  })

  return {
    ...runner,
    destroy() {
      runner.destroy()
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}

export type UniformSetter = (name: string, ...v: number[]) => void
