/*
 * Detector de pontos (pips) de dominó.
 *
 * Funciona sobre um buffer RGBA (como o ImageData do canvas) sem dependências.
 * Etapas:
 *   1. Converte para uma imagem em que a peça é clara e o pip é escuro
 *      (usando o menor canal de cor, para pips coloridos também contrastarem).
 *   2. Limiarização adaptativa (média local via imagem integral) para isolar
 *      manchas mais escuras que a vizinhança.
 *   3. Rotula componentes conexos.
 *   4. Filtra componentes com formato de círculo (proporção, preenchimento).
 *   5. Descarta manchas que não estão cercadas pela cor clara da peça
 *      (sujeira, sombras e objetos no fundo da foto).
 *   6. Mantém apenas os de tamanho parecido com o tamanho típico dos pips.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DominoDetector = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Pips escuros/coloridos em peça branca: menor canal de cor, assim um pip
  // amarelo (azul baixo) ou rosa (verde baixo) contrasta tanto quanto um preto.
  // Pips claros em peça escura: maior canal, invertido.
  function toGray(rgba, width, height, lightPips) {
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      gray[i] = lightPips ? 255 - Math.max(r, g, b) : Math.min(r, g, b);
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

  // Média local de cada pixel numa janela quadrada (via imagem integral).
  function localMean(gray, width, height, windowSize) {
    const integral = integralImage(gray, width, height);
    const w1 = width + 1;
    const half = Math.max(1, Math.floor(windowSize / 2));
    const mean = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - half);
      const y1 = Math.min(height, y + half + 1);
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - half);
        const x1 = Math.min(width, x + half + 1);
        const sum =
          integral[y1 * w1 + x1] - integral[y0 * w1 + x1] -
          integral[y1 * w1 + x0] + integral[y0 * w1 + x0];
        mean[y * width + x] = sum / ((x1 - x0) * (y1 - y0));
      }
    }
    return mean;
  }

  // Marca pixels que são `offset` mais escuros que a média ao redor, dentro do
  // retângulo [x0, x1) × [y0, y1). Devolve a máscara só desse retângulo.
  function threshold(gray, mean, width, offset, x0, y0, x1, y1) {
    const w = x1 - x0;
    const mask = new Uint8Array(w * (y1 - y0));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * width + x;
        if (gray[i] < mean[i] - offset) mask[(y - y0) * w + (x - x0)] = 1;
      }
    }
    return mask;
  }

  // Rotulagem de componentes conexos (8-vizinhança) com pilha explícita.
  // `area` é a área preenchida (soma da extensão horizontal de cada linha),
  // para que o reflexo de luz no meio de um pip brilhante não abra um buraco.
  function connectedComponents(mask, width, height) {
    const labels = new Int32Array(width * height);
    const components = [];
    const stack = new Int32Array(width * height);
    const rowMin = new Int32Array(height).fill(width);
    const rowMax = new Int32Array(height).fill(-1);
    let next = 0;
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start]) continue;
      next++;
      let top = 0;
      stack[top++] = start;
      labels[start] = next;
      let pixels = 0, sumX = 0, sumY = 0;
      let minX = width, minY = height, maxX = 0, maxY = 0;
      let touchesBorder = false;
      while (top > 0) {
        const idx = stack[--top];
        const x = idx % width;
        const y = (idx - x) / width;
        pixels++;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x < rowMin[y]) rowMin[y] = x;
        if (x > rowMax[y]) rowMax[y] = x;
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
      let area = 0;
      for (let y = minY; y <= maxY; y++) {
        area += rowMax[y] - rowMin[y] + 1;
        rowMin[y] = width;
        rowMax[y] = -1;
      }
      components.push({
        area,
        pixels,
        cx: sumX / pixels,
        cy: sumY / pixels,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
        touchesBorder,
      });
    }
    return components;
  }

  function percentile(values, q) {
    if (!values.length) return 0;
    const s = values.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  }

  // Mede o pip e o anel ao redor dele (elíptico, para fotos tiradas de lado).
  // Usa percentis altos no anel porque, num 6, os pips vizinhos e a linha
  // divisória cobrem boa parte dele.
  function contrastRatio(gray, width, height, c) {
    const rx = c.w / 2, ry = c.h / 2;
    const at = (x, y) => {
      x = Math.round(x); y = Math.round(y);
      return x < 0 || y < 0 || x >= width || y >= height ? null : gray[y * width + x];
    };
    const ring = [];
    for (const k of [1.6, 2.2]) {
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        const v = at(c.cx + Math.cos(a) * rx * k, c.cy + Math.sin(a) * ry * k);
        if (v !== null) ring.push(v);
      }
    }
    const inner = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const v = at(c.cx + Math.cos(a) * rx * 0.5, c.cy + Math.sin(a) * ry * 0.5);
      if (v !== null) inner.push(v);
    }
    // Razão pip/peça: 0 = pip preto em peça branca, 1 = sem contraste.
    return percentile(inner, 0.5) / Math.max(1, percentile(ring, 0.75));
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
    const window = logs.slice(bestStart, bestStart + best);
    return Math.exp(window[window.length >> 1]);
  }

  // Formato de pip: aproximadamente circular (ou elíptico, em foto de lado).
  function isRound(c) {
    const aspect = c.w / c.h;
    if (aspect < 0.45 || aspect > 2.2) return false;
    // Elipse ideal preenche π/4 ≈ 0.785 do retângulo envolvente.
    const fill = c.area / (c.w * c.h);
    return fill > 0.6 && fill < 0.95;
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
    const gray = toGray(rgba, width, height, opts.lightPips);

    const minSide = Math.min(width, height);
    const windowSize = Math.max(15, Math.round(minSide / 10)) | 1;
    const mean = localMean(gray, width, height, windowSize);
    // Sensibilidade 0 → offset 45 (rígido); 1 → offset 15 (permissivo).
    const offset = 45 - 30 * Math.min(1, Math.max(0, opts.sensitivity));
    const mask = threshold(gray, mean, width, offset, 0, 0, width, height);
    const components = connectedComponents(mask, width, height)
      .filter((c) => !c.touchesBorder);

    const minArea = Math.max(6, (minSide * minSide) * 0.00003);
    const maxArea = (minSide * minSide) * 0.02;
    const debug = [];
    const reject = (c, why) => { if (opts.debug) debug.push(Object.assign({ why }, c)); return false; };
    // O pip tem que ser bem mais escuro que a superfície logo ao redor dele.
    // Manchas do fundo (sombras, reflexos) costumam ter pouco contraste.
    const contrasted = (c) => {
      c.ratio = contrastRatio(gray, width, height, c);
      return c.ratio < 0.6;
    };

    const candidates = [];
    const blobs = []; // manchas grandes/alongadas: podem ser pips encostados
    for (const c of components) {
      if (c.area < minArea) continue;
      if (c.area <= maxArea && isRound(c)) {
        if (contrasted(c) || reject(c, 'contrast')) candidates.push(c);
      } else {
        blobs.push(c);
      }
    }

    let typical = dominantArea(candidates.map((c) => c.area));

    // Pips encostados (ou ligados pela sombra) viram uma mancha só. Reprocessa
    // a região dela com limiar cada vez mais rígido até ela se separar em
    // manchas redondas do tamanho de um pip.
    if (typical) {
      for (const b of blobs) {
        if (b.area < typical * 1.5 || b.area > typical * 15) { reject(b, 'shape'); continue; }
        const x0 = Math.max(0, Math.floor(b.cx - b.w / 2) - 2);
        const y0 = Math.max(0, Math.floor(b.cy - b.h / 2) - 2);
        const x1 = Math.min(width, Math.ceil(b.cx + b.w / 2) + 3);
        const y1 = Math.min(height, Math.ceil(b.cy + b.h / 2) + 3);
        let best = [];
        for (let off = offset + 6; off <= 120; off += 6) {
          const sub = threshold(gray, mean, width, off, x0, y0, x1, y1);
          const parts = connectedComponents(sub, x1 - x0, y1 - y0)
            .filter((c) => !c.touchesBorder && isRound(c) &&
              c.area > typical * 0.3 && c.area < typical * 2.5);
          if (parts.length > best.length) best = parts;
        }
        if (best.length < 2) { reject(b, 'shape'); continue; }
        for (const c of best) {
          c.cx += x0;
          c.cy += y0;
          c.split = true;
          if (contrasted(c) || reject(c, 'contrast')) candidates.push(c);
        }
      }
      typical = dominantArea(candidates.map((c) => c.area));
    }

    // Pips encolhem ao serem separados, por isso a tolerância maior.
    const sized = candidates.filter((c) =>
      (c.area > typical * (c.split ? 0.25 : 0.4) && c.area < typical * 2.5) || reject(c, 'size'));

    // Pips andam em grupo: cada um tem outro de tamanho parecido por perto.
    // Um pip sozinho (o "1") só é aceito se o contraste for bem forte.
    const near = 9 * Math.sqrt(typical / Math.PI);
    const pips = sized
      .filter((c) => c.ratio < 0.3 ||
        sized.some((o) => o !== c && Math.hypot(o.cx - c.cx, o.cy - c.cy) < near) ||
        reject(c, 'alone'))
      .map((c) => ({ x: c.cx, y: c.cy, r: Math.sqrt(c.area / Math.PI) }));

    const result = { pips, count: pips.length };
    if (opts.debug) Object.assign(result, { debug, typical });
    return result;
  }

  return { detectPips };
});
