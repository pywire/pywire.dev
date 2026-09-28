// Snap scrolling for a pinned scroll story, one step per gesture. Between the
// first and last stop, a scroll gesture (a wheel or trackpad swipe, a touch
// swipe, an arrow key) glides to the next stop on a critically damped spring.
// While a step plays, input is ignored, and the rest of the gesture that took
// it (a trackpad's momentum, a spun wheel) is swallowed, so however fast you
// scroll you see every step, one at a time. Past the ends the page scrolls
// natively; a gesture that starts at the last stop heading out simply scrolls
// the page. If the page comes to rest between stops (a scrollbar drag, a
// native gesture that ran into the story), it settles onto the next stop.

const RATE = 9 // spring rate: a glide settles in about 0.7 s
const HOLD = 850 // ms after a step starts before another can
const QUIET = 160 // ms without wheel events that ends a gesture
const KEYS: Record<string, number> = { ArrowDown: 1, PageDown: 1, ' ': 1, ArrowUp: -1, PageUp: -1 }

export interface Snap {
  /** Glide one stop in `dir` (1 down, -1 up). False when there is no stop that way. */
  go(dir: number): boolean
  destroy(): void
}

export function snapScroll(stops: () => number[], enabled: () => boolean): Snap {
  let target: number | null = null
  let pos = 0
  let vel = 0
  let raf = 0
  let last = 0
  let stepAt = -Infinity // when the latest step started
  let settle = 0
  let lastY = scrollY
  let lastDir = 1
  // The wheel gesture in progress: when its latest event came, whether it
  // already did its one thing (took a step, or ran into a step playing), and
  // whether it's the page's to scroll.
  let wheelAt = -Infinity
  let spent = false
  let native = false
  let acc = 0

  // 'instant': the site sets scroll-behavior: smooth, which would lag every frame.
  const put = (y: number) => scrollTo({ top: y, behavior: 'instant' })
  const tick = (now: number) => {
    const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000))
    last = now
    vel += (RATE * RATE * (target! - pos) - 2 * RATE * vel) * dt
    pos += vel * dt
    if (Math.abs(target! - pos) < 0.5 && Math.abs(vel) < 20) {
      put(target!)
      target = null
      vel = 0
      raf = 0
      return
    }
    put(pos)
    raf = requestAnimationFrame(tick)
  }
  const inside = (y: number) => {
    const st = stops()
    return y >= st[0] - 2 && y <= st[st.length - 1] + 2
  }
  const beyond = (from: number, d: number) => {
    const st = stops()
    return (d > 0 ? st.filter((v) => v > from + 2) : st.filter((v) => v < from - 2).reverse())[0] ?? null
  }
  const busy = () => target !== null || performance.now() - stepAt < HOLD

  const go = (d: number) => {
    // A step is playing: this input is spent on it.
    if (busy()) return true
    if (!inside(scrollY)) return false
    const t = beyond(scrollY, d)
    if (t === null) return false
    pos = scrollY
    vel = 0
    target = t
    stepAt = last = performance.now()
    raf = requestAnimationFrame(tick)
    return true
  }

  const onWheel = (e: WheelEvent) => {
    if (!enabled() || e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    const now = performance.now()
    const d = Math.sign(e.deltaY)
    if (now - wheelAt > QUIET) {
      spent = false
      native = false
      acc = 0
    }
    wheelAt = now
    if (native) return
    if (spent || busy()) {
      spent = true
      if (inside(scrollY) || target !== null) e.preventDefault()
      return
    }
    // Outside the stops, or at the end heading out: the page scrolls, for
    // the whole of this gesture.
    if (!inside(scrollY) || beyond(scrollY, d) === null) {
      native = true
      return
    }
    e.preventDefault()
    if (Math.sign(acc) !== d) acc = 0
    acc += Math.abs(e.deltaY) * (e.deltaMode === 1 ? 32 : 1) * d
    if (Math.abs(acc) > 30) {
      spent = true
      go(d)
    }
  }

  let touchY: number | null = null
  const onTouchStart = (e: TouchEvent) => {
    touchY = e.touches.length === 1 ? e.touches[0].clientY : null
  }
  const onTouchMove = (e: TouchEvent) => {
    if (!enabled() || touchY === null) return
    const dy = touchY - e.touches[0].clientY
    if (target !== null || (Math.abs(dy) > 6 && inside(scrollY) && beyond(scrollY, Math.sign(dy)) !== null))
      e.preventDefault()
  }
  const onTouchEnd = (e: TouchEvent) => {
    if (!enabled() || touchY === null) return
    const dy = touchY - e.changedTouches[0].clientY
    touchY = null
    if (Math.abs(dy) >= 30) go(Math.sign(dy))
  }

  const onKey = (e: KeyboardEvent) => {
    const d = KEYS[e.key]
    const el = e.target as HTMLElement
    if (
      !enabled() ||
      !d ||
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      el.closest('input, textarea, select, [contenteditable]') ||
      (e.key === ' ' && el.closest('button, a'))
    )
      return
    // A held key doesn't run through the steps.
    if (e.repeat ? inside(scrollY) : go(e.shiftKey && e.key === ' ' ? -1 : d)) e.preventDefault()
  }

  // Coming to rest between stops settles onto the next stop the way you were going.
  const onScroll = () => {
    const y = scrollY
    if (y !== lastY) lastDir = Math.sign(y - lastY)
    lastY = y
    clearTimeout(settle)
    if (target !== null || !enabled()) return
    settle = window.setTimeout(() => {
      if (target !== null || !enabled() || !inside(scrollY)) return
      if (stops().some((v) => Math.abs(v - scrollY) <= 2)) return
      stepAt = -Infinity
      go(lastDir)
    }, 250)
  }

  addEventListener('wheel', onWheel, { passive: false })
  addEventListener('touchstart', onTouchStart, { passive: true })
  addEventListener('touchmove', onTouchMove, { passive: false })
  addEventListener('touchend', onTouchEnd, { passive: true })
  addEventListener('keydown', onKey)
  addEventListener('scroll', onScroll, { passive: true })

  return {
    go,
    destroy() {
      cancelAnimationFrame(raf)
      clearTimeout(settle)
      removeEventListener('wheel', onWheel)
      removeEventListener('touchstart', onTouchStart)
      removeEventListener('touchmove', onTouchMove)
      removeEventListener('touchend', onTouchEnd)
      removeEventListener('keydown', onKey)
      removeEventListener('scroll', onScroll)
    },
  }
}
