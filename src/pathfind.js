// Flow field: BFS distance map from a target tile over open ground.
// grid: Uint8Array, 1 = wall. w,h in tiles.
export function makeFlowField(grid, w, h) {
  const dist = new Int32Array(w * h);
  const queue = new Int32Array(w * h);

  function compute(tx, ty) {
    dist.fill(-1);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return;
    if (grid[ty * w + tx] === 1) return;
    let head = 0;
    let tail = 0;
    dist[ty * w + tx] = 0;
    queue[tail++] = ty * w + tx;
    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % w;
      const cy = (cur / w) | 0;
      const dc = dist[cur];
      for (let k = 0; k < 4; k++) {
        const ox = k === 0 ? 1 : k === 1 ? -1 : 0;
        const oy = k === 2 ? 1 : k === 3 ? -1 : 0;
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (grid[ni] === 1 || dist[ni] !== -1) continue;
        dist[ni] = dc + 1;
        queue[tail++] = ni;
      }
    }
  }

  // unit vector from a tile toward lower distance (toward the target)
  function dir(tx, ty) {
    if (tx < 1 || ty < 1 || tx >= w - 1 || ty >= h - 1) return [0, 0];
    const here = dist[ty * w + tx];
    if (here <= 0) return [0, 0];
    let best = here;
    let bx = 0;
    let by = 0;
    const offs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];
    for (const [ox, oy] of offs) {
      if (ox !== 0 && oy !== 0) {
        if (grid[ty * w + (tx + ox)] === 1 || grid[(ty + oy) * w + tx] === 1) continue;
      }
      const d = dist[(ty + oy) * w + (tx + ox)];
      if (d !== -1 && d < best) {
        best = d;
        bx = ox;
        by = oy;
      }
    }
    const l = Math.hypot(bx, by) || 1;
    return [bx / l, by / l];
  }

  return { dist, compute, dir };
}
