// Snap scrolling for a pinned scroll story. Between the first and last stop,
// a scroll gesture (wheel, swipe or arrow keys) glides to the next stop on a
// critically damped spring instead of scrolling freely. New input retargets
// the spring mid-glide, so steps chain and reverse without waiting, while the
// momentum tail of a gesture that already moved a step is swallowed. Outside
// the stops, and while a native gesture is still running, the page scrolls
// natively; if it comes to rest between stops it settles onto the next one.

const RATE = 9 // spring rate: a glide settles in about 0.7 s
const KEYS: Record<string, number> = { ArrowDown: 1, PageDown: 1, ' ': 1, ArrowUp: -1, PageUp: -1 }

export interface Snap {
  /** Glide one stop in `dir` (1 down, -1 up). False when there is no stop that way. */
  go(dir: number): boolean
  destroy(): void
}

export function snapScroll(stops: () => number[], enabled: () => boolean): Snap {
  let target: number | null = null
  let dir = 0
  let pos = 0
  let vel = 0
  let raf = 0
  let last = 0
  let stepAt = -Infinity // when the latest step was taken
  let restAt = -Infinity // when the latest glide settled
  let nativeAt = -Infinity // latest wheel event left to the page
  let wheelAt = -Infinity
  let wheelMag = 0
  let acc = 0
  let settle = 0
  let lastY = scrollY
  let lastDir = 1

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
      restAt = performance.now()
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

  const go = (d: number) => {
    if (target !== null) {
      // Same way: one stop past the current target, at most two ahead of us.
      // The other way: the nearest stop behind us.
      const t = beyond(d === dir ? target : pos, d)
      if (t === null) return true
      const lead = stops().filter((v) => (d > 0 ? v > pos + 2 && v <= t : v < pos - 2 && v >= t)).length
      if (d === dir && lead > 2) return true
      target = t
      dir = d
      stepAt = performance.now()
      return true
    }
    if (!inside(scrollY)) return false
    const t = beyond(scrollY, d)
    if (t === null) return false
    pos = scrollY
    vel = 0
    target = t
    dir = d
    stepAt = last = performance.now()
    raf = requestAnimationFrame(tick)
    return true
  }

  const onWheel = (e: WheelEvent) => {
    if (!enabled() || e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    const now = performance.now()
    const d = Math.sign(e.deltaY)
    const mag = Math.abs(e.deltaY) * (e.deltaMode === 1 ? 32 : 1)
    const gap = now - wheelAt
    // A new push rather than the tail of the last one: after a pause, a
    // clearly stronger delta once the last step has had time to decay, or
    // another mouse-wheel notch.
    const since = now - stepAt
    const fresh = gap > 120 || (since > 300 && mag > wheelMag * 1.4 + 4) || (mag >= 100 && gap > 40 && since > 150)
    wheelAt = now
    wheelMag = mag
    if (target !== null) {
      e.preventDefault()
      if (d !== dir || fresh) go(d)
      return
    }
    // Let a gesture the page is already scrolling natively run its course.
    if (now - nativeAt < 160) {
      nativeAt = now
      return
    }
    // The momentum tail of a glide that just settled.
    if (now - restAt < 200 && !fresh) {
      if (inside(scrollY)) {
        e.preventDefault()
        restAt = now
      }
      return
    }
    if (!inside(scrollY) || beyond(scrollY, d) === null) {
      nativeAt = now
      return
    }
    e.preventDefault()
    if (Math.sign(acc) !== d || gap > 200) acc = 0
    acc += mag * d
    if (Math.abs(acc) > 30) {
      acc = 0
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
    if (go(e.shiftKey && e.key === ' ' ? -1 : d)) e.preventDefault()
  }

  // Coming to rest between stops (a native gesture, a scrollbar drag) settles
  // onto the next stop the way you were going.
  const onScroll = () => {
    const y = scrollY
    if (y !== lastY) lastDir = Math.sign(y - lastY)
    lastY = y
    clearTimeout(settle)
    if (target !== null || !enabled()) return
    settle = window.setTimeout(() => {
      if (target !== null || !enabled() || !inside(scrollY)) return
      if (stops().some((v) => Math.abs(v - scrollY) <= 2)) return
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
