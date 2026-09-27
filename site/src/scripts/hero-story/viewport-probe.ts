// A readout of what the browser reports about its viewport, for tuning the
// story on devices we can't run here (iPhone Safari's floating toolbar).
// Open the page with ?viewport and screenshot it.
export function probe(stage: HTMLElement, next: HTMLElement) {
  const box = document.createElement('pre')
  Object.assign(box.style, {
    position: 'fixed',
    top: '8px',
    right: '8px',
    zIndex: '9999',
    margin: '0',
    padding: '6px 8px',
    borderRadius: '6px',
    background: 'rgba(0,0,0,0.78)',
    color: '#7ff',
    font: '11px/1.35 ui-monospace, monospace',
    pointerEvents: 'none',
  })
  // Elements sized in each viewport unit, and one padded by the safe area.
  const unit = (css: string) => {
    const el = document.createElement('div')
    el.style.cssText = `position:absolute;left:0;top:0;width:0;visibility:hidden;${css}`
    document.body.append(el)
    return el
  }
  const svh = unit('height:100svh')
  const dvh = unit('height:100dvh')
  const lvh = unit('height:100lvh')
  const safe = unit('height:0;padding-bottom:env(safe-area-inset-bottom)')
  document.body.append(box)
  const r = (n: number) => Math.round(n)
  const show = () => {
    const vv = visualViewport
    box.textContent = [
      `screen    ${screen.width}x${screen.height}`,
      `inner     ${innerWidth}x${innerHeight}`,
      `client    ${document.documentElement.clientHeight}`,
      `vv        h${r(vv?.height ?? 0)} top${r(vv?.offsetTop ?? 0)} x${vv?.scale.toFixed(2)}`,
      `svh/dvh/lvh ${svh.offsetHeight}/${dvh.offsetHeight}/${lvh.offsetHeight}`,
      `safe-bot  ${safe.offsetHeight}`,
      `stage     top${r(stage.getBoundingClientRect().top)} h${stage.clientHeight}`,
      `clear     ${Math.max(0, stage.clientHeight - dvh.offsetHeight)}`,
      `next      bottom${r(next.getBoundingClientRect().bottom)}`,
      `scrollY   ${r(scrollY)}`,
    ].join('\n')
  }
  show()
  setInterval(show, 400)
}
