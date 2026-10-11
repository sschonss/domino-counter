/*
 * Detector de pontos (pips) de dominó.
 *
 * Funciona sobre um buffer RGBA (como o ImageData do canvas) sem dependências.
 * Etapas:
 *   1. Converte para tons de cinza.
 *   2. Limiarização adaptativa (média local via imagem integral) para isolar
 *      manchas mais escuras (ou mais claras) que a vizinhança.
 *   3. Rotula componentes conexos.
 *   4. Filtra componentes com formato de círculo (proporção, preenchimento).
 *   5. Mantém apenas os de tamanho parecido com o tamanho típico dos pips.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DominoDetector = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function toGray(rgba, width, height) {
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    }
    return gray;
  }

  function integralImage(gray, width, height) {
    const w1 = width + 1;
    const integral = new Float64Array(w1 * (height + 1));
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        rowSum += gray[y * width + x];
        integral[(y + 1) * w1 + (x + 1)] = integral[y * w1 + (x + 1)] + rowSum;
      }
    }
    return integral;
  }

  // Marca pixels que são `offset` mais escuros que a média da janela ao redor.
  function adaptiveThreshold(gray, width, height, windowSize, offset) {
    const integral = integralImage(gray, width, height);
    const w1 = width + 1;
    const half = Math.max(1, Math.floor(windowSize / 2));
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - half);
      const y1 = Math.min(height, y + half + 1);
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - half);
        const x1 = Math.min(width, x + half + 1);
        const sum =
          integral[y1 * w1 + x1] - integral[y0 * w1 + x1] -
          integral[y1 * w1 + x0] + integral[y0 * w1 + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0));
        if (gray[y * width + x] < mean - offset) mask[y * width + x] = 1;
      }
    }
    return mask;
  }

  // Rotulagem de componentes conexos (8-vizinhança) com pilha explícita.
  function connectedComponents(mask, width, height) {
    const labels = new Int32Array(width * height);
    const components = [];
    const stack = new Int32Array(width * height);
    let next = 0;
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start]) continue;
      next++;
      let top = 0;
      stack[top++] = start;
      labels[start] = next;
      let area = 0, sumX = 0, sumY = 0;
      let minX = width, minY = height, maxX = 0, maxY = 0;
      let touchesBorder = false;
      while (top > 0) {
        const idx = stack[--top];
        const x = idx % width;
        const y = (idx - x) / width;
        area++;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const n = ny * width + nx;
            if (mask[n] && !labels[n]) {
              labels[n] = next;
              stack[top++] = n;
            }
          }
        }
      }
      components.push({
        area,
        cx: sumX / area,
        cy: sumY / area,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
        touchesBorder,
      });
    }
    return components;
  }

  function median(values) {
    if (!values.length) return 0;
    const s = values.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Encontra a área "típica" dos pips: a janela (em escala log) que contém
  // mais candidatos. Isso ignora ruído pequeno e manchas grandes isoladas.
  function dominantArea(areas) {
    if (!areas.length) return 0;
    const logs = areas.map(Math.log).sort((a, b) => a - b);
    const span = Math.log(2.2); // pips variam pouco de tamanho numa mesma foto
    let best = 0, bestStart = 0;
    for (let i = 0, j = 0; i < logs.length; i++) {
      while (logs[i] - logs[j] > span) j++;
      // Em caso de empate, prefere manchas maiores (ruído tende a ser pequeno).
      if (i - j + 1 >= best) {
        best = i - j + 1;
        bestStart = j;
      }
    }
    return Math.exp(median(logs.slice(bestStart, bestStart + best)));
  }

  /**
   * Detecta pips.
   * @param {Uint8ClampedArray|Uint8Array} rgba  pixels RGBA
   * @param {number} width
   * @param {number} height
   * @param {object} [options]
   * @param {boolean} [options.lightPips=false]  pips claros em peça escura
   * @param {number}  [options.sensitivity=0.5]  0..1, maior = detecta mais
   * @returns {{pips: Array<{x:number,y:number,r:number}>, count: number}}
   */
  function detectPips(rgba, width, height, options) {
    const opts = Object.assign({ lightPips: false, sensitivity: 0.5 }, options);
    const gray = toGray(rgba, width, height);
    if (opts.lightPips) {
      for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i];
    }

    const minSide = Math.min(width, height);
    const windowSize = Math.max(15, Math.round(minSide / 10)) | 1;
    // Sensibilidade 0 → offset 45 (rígido); 1 → offset 8 (permissivo).
    const offset = 45 - 37 * Math.min(1, Math.max(0, opts.sensitivity));
    const mask = adaptiveThreshold(gray, width, height, windowSize, offset);
    const components = connectedComponents(mask, width, height);

    const minArea = Math.max(6, (minSide * minSide) * 0.00003);
    const maxArea = (minSide * minSide) * 0.02;

    const round = components.filter((c) => {
      if (c.touchesBorder) return false;
      if (c.area < minArea || c.area > maxArea) return false;
      const aspect = c.w / c.h;
      if (aspect < 0.6 || aspect > 1.67) return false;
      // Círculo ideal preenche π/4 ≈ 0.785 do retângulo envolvente.
      const fill = c.area / (c.w * c.h);
      return fill > 0.55 && fill < 0.97;
    });

    const typical = dominantArea(round.map((c) => c.area));
    const pips = round
      .filter((c) => c.area > typical * 0.4 && c.area < typical * 2.5)
      .map((c) => ({ x: c.cx, y: c.cy, r: Math.sqrt(c.area / Math.PI) }));

    return { pips, count: pips.length };
  }

  return { detectPips, toGray, adaptiveThreshold, connectedComponents };
});
