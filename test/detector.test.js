// Testa o detector com fotos sintéticas de peças de dominó.
// Rodar com: node --test
const test = require('node:test');
const assert = require('node:assert');
const { detectPips } = require('../detector.js');

// Posições dos pips (em fração da metade da peça) para cada valor 0..6.
const LAYOUT = {
  0: [],
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.25, 0.2], [0.75, 0.2], [0.25, 0.5], [0.75, 0.5], [0.25, 0.8], [0.75, 0.8]],
};

function makeImage(width, height, bg) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function setPx(img, x, y, c) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const p = (y * img.width + x) * 4;
  img.data[p] = c[0];
  img.data[p + 1] = c[1];
  img.data[p + 2] = c[2];
}

function fillRect(img, x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPx(img, x, y, c);
}

function fillCircle(img, cx, cy, r, c) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) setPx(img, x, y, c);
    }
  }
}

// Desenha uma peça vertical [a|b] com canto superior esquerdo em (x, y).
function drawTile(img, x, y, size, a, b, tileColor, pipColor) {
  fillRect(img, x, y, size, size * 2, tileColor);
  // Linha divisória fina no meio.
  fillRect(img, x + size * 0.1, y + size - 1, size * 0.8, 2, [120, 120, 120]);
  const r = size * 0.08;
  [a, b].forEach((v, half) => {
    for (const [fx, fy] of LAYOUT[v]) {
      fillCircle(img, x + fx * size, y + half * size + fy * size, r, pipColor);
    }
  });
}

function addNoise(img, amount, seed) {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < img.width * img.height * 4; i++) {
    if (i % 4 === 3) continue;
    img.data[i] = img.data[i] + (rand() - 0.5) * amount;
  }
}

// Adiciona gradiente de iluminação (sombra) da esquerda para a direita.
function addShading(img, strength) {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const k = 1 - strength * (x / img.width);
      const p = (y * img.width + x) * 4;
      for (let c = 0; c < 3; c++) img.data[p + c] = img.data[p + c] * k;
    }
  }
}

function scene(tiles, opts = {}) {
  const size = opts.size || 70;
  const img = makeImage(opts.width || 800, opts.height || 500, opts.bg || [40, 110, 60]);
  tiles.forEach(([a, b], i) => {
    const col = i % 6;
    const row = Math.floor(i / 6);
    drawTile(img, 30 + col * (size + 40), 30 + row * (size * 2 + 30), size, a, b,
      opts.tile || [245, 245, 240], opts.pip || [20, 20, 20]);
  });
  if (opts.shading) addShading(img, opts.shading);
  if (opts.noise) addNoise(img, opts.noise, 42);
  return img;
}

const sum = (tiles) => tiles.reduce((s, [a, b]) => s + a + b, 0);

test('conta pips em peças brancas sobre mesa verde', () => {
  const tiles = [[6, 6], [5, 3], [2, 1], [0, 4]];
  const img = scene(tiles);
  assert.strictEqual(detectPips(img.data, img.width, img.height).count, sum(tiles));
});

test('peça [0|0] vale zero', () => {
  const img = scene([[0, 0]]);
  assert.strictEqual(detectPips(img.data, img.width, img.height).count, 0);
});

test('resiste a ruído e sombra', () => {
  const tiles = [[6, 5], [4, 4], [3, 2], [1, 0], [6, 1], [5, 5]];
  const img = scene(tiles, { noise: 40, shading: 0.5 });
  assert.strictEqual(detectPips(img.data, img.width, img.height).count, sum(tiles));
});

test('peças pequenas em foto maior', () => {
  const tiles = [[6, 6], [5, 4], [3, 3], [2, 2], [1, 6], [4, 0], [5, 2]];
  const img = scene(tiles, { width: 1000, height: 600, size: 45, noise: 20 });
  assert.strictEqual(detectPips(img.data, img.width, img.height).count, sum(tiles));
});

test('pips claros em peça escura (modo invertido)', () => {
  const tiles = [[6, 2], [3, 5]];
  const img = scene(tiles, { tile: [25, 25, 30], pip: [240, 240, 240], bg: [180, 150, 110] });
  const r = detectPips(img.data, img.width, img.height, { lightPips: true });
  assert.strictEqual(r.count, sum(tiles));
});

test('pips coloridos (estilo dominó com cores)', () => {
  const tiles = [[6, 6], [4, 2]];
  const img = scene(tiles, { pip: [30, 60, 200], noise: 15 });
  assert.strictEqual(detectPips(img.data, img.width, img.height).count, sum(tiles));
});
