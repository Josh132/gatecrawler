// WebGL1 post-process over the finished 2D frame: bright-pass bloom, a mild
// filmic grade, vignette and grain. Hand-written GLSL, no libraries. Everything
// is optional — with no GL (or after a context loss) createPostFX returns null
// and the plain 2D canvas is what the player sees.

const VERT = `attribute vec2 p; varying vec2 v;
void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const BRIGHT = `precision mediump float; varying vec2 v; uniform sampler2D t;
void main(){
  vec3 c = texture2D(t, v).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(l - 0.68, 0.0) / max(l, 0.0001);
  gl_FragColor = vec4(c * k * 1.1, 1.0);
}`;

const BLUR = `precision mediump float; varying vec2 v; uniform sampler2D t; uniform vec2 dir;
void main(){
  vec3 s = texture2D(t, v).rgb * 0.2270;
  s += (texture2D(t, v + dir * 1.3846).rgb + texture2D(t, v - dir * 1.3846).rgb) * 0.3162;
  s += (texture2D(t, v + dir * 3.2308).rgb + texture2D(t, v - dir * 3.2308).rgb) * 0.0702;
  gl_FragColor = vec4(s, 1.0);
}`;

const COMP = `precision mediump float; varying vec2 v;
uniform sampler2D t; uniform sampler2D b; uniform float time; uniform vec2 res;
void main(){
  vec3 c = texture2D(t, v).rgb;
  c += texture2D(b, v).rgb * 0.38;                 // gentle bloom, keeps neon lines as lines
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.08);                       // a touch more saturation
  c = (c - 0.5) * 1.03 + 0.5 + 0.008;             // slight contrast + lifted black
  c *= mix(vec3(0.95, 0.98, 1.06), vec3(1.04, 1.01, 0.96), smoothstep(0.12, 0.8, l));
  vec2 q = (v - 0.5) * vec2(1.0, 1.08);
  c *= mix(0.86, 1.0, smoothstep(0.82, 0.22, length(q)));
  float n = fract(sin(dot(v * res + time, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * 0.018;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    gl.attachShader(p, s);
    gl.deleteShader(s);
  }
  gl.bindAttribLocation(p, 0, 'p');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
  return p;
}

function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fb, w, h };
}

// src is the finished 2D game canvas; the output canvas is stacked over it
export function createPostFX(src) {
  let cv = null;
  let gl = null;
  try {
    cv = document.getElementById('fx');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = 'fx';
      document.body.appendChild(cv);
    }
    cv.style.position = 'fixed';
    cv.style.left = '0';
    cv.style.top = '0';
    cv.style.width = '100%';
    cv.style.height = '100%';
    cv.style.zIndex = '1';
    cv.style.pointerEvents = 'none';
    gl = cv.getContext('webgl', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
    if (!gl || typeof gl.createShader !== 'function') return null;
  } catch (e) {
    return null;
  }

  let dead = false;
  let progs;
  let quad;
  let srcTex;
  let a;
  let b;
  try {
    progs = {
      bright: compile(gl, VERT, BRIGHT),
      blur: compile(gl, VERT, BLUR),
      comp: compile(gl, VERT, COMP),
    };
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    srcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  } catch (e) {
    return null;
  }
  cv.addEventListener('webglcontextlost', () => {
    dead = true;
    cv.style.display = 'none';
  });

  let w = 0;
  let h = 0;
  function sized() {
    if (src.width === w && src.height === h) return;
    w = src.width;
    h = src.height;
    cv.width = w;
    cv.height = h;
    const bw = Math.max(2, w >> 1);
    const bh = Math.max(2, h >> 1);
    if (a) {
      gl.deleteTexture(a.tex);
      gl.deleteFramebuffer(a.fb);
      gl.deleteTexture(b.tex);
      gl.deleteFramebuffer(b.fb);
    }
    a = target(gl, bw, bh);
    b = target(gl, bw, bh);
  }

  function pass(prog, t, dst) {
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    gl.viewport(0, 0, dst ? dst.w : w, dst ? dst.h : h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(gl.getUniformLocation(prog, 't'), 0);
    return prog;
  }

  return {
    draw(time) {
      if (dead || !src.width) return;
      try {
        sized();
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);

        pass(progs.bright, srcTex, a);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        let p = pass(progs.blur, a.tex, b);
        gl.uniform2f(gl.getUniformLocation(p, 'dir'), 1 / a.w, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        p = pass(progs.blur, b.tex, a);
        gl.uniform2f(gl.getUniformLocation(p, 'dir'), 0, 1 / a.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        p = pass(progs.comp, srcTex, null);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, a.tex);
        gl.uniform1i(gl.getUniformLocation(p, 'b'), 1);
        gl.uniform1f(gl.getUniformLocation(p, 'time'), (time || 0) % 100);
        gl.uniform2f(gl.getUniformLocation(p, 'res'), w, h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.activeTexture(gl.TEXTURE0);
      } catch (e) {
        dead = true;
        try {
          cv.style.display = 'none';
        } catch (e2) {
          /* ignore */
        }
      }
    },
  };
}
