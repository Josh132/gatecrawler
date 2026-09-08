export const keys = new Set();
export const mouse = { x: 0, y: 0, down: false };
const justPressed = new Set();

export function initInput(canvas) {
  addEventListener('keydown', (e) => {
    if (!e.repeat) justPressed.add(e.code);
    keys.add(e.code);
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));

  const setPos = (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
  };
  canvas.addEventListener('mousemove', setPos);
  canvas.addEventListener('mousedown', (e) => {
    setPos(e);
    if (e.button === 0) mouse.down = true;
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.down = false;
  });
  addEventListener('blur', () => {
    keys.clear();
    mouse.down = false;
  });
  addEventListener('contextmenu', (e) => e.preventDefault());
}

export function pressed(code) {
  return justPressed.has(code);
}

export function endFrameInput() {
  justPressed.clear();
}
