export function startLoop(update, render) {
  const STEP = 1 / 60;
  let last = performance.now() / 1000;
  let acc = 0;

  function frame() {
    const now = performance.now() / 1000;
    let dt = now - last;
    last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      update(STEP);
      acc -= STEP;
      n++;
    }
    render(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
