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
      let pixels = 0, sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0;
      let minX = width, minY = height, maxX = 0, maxY = 0;
      let touchesBorder = false;
      while (top > 0) {
        const idx = stack[--top];
        const x = idx % width;
        const y = (idx - x) / width;
        pixels++;
        sumX += x;
        sumY += y;
        sumXX += x * x;
        sumYY += y * y;
        sumXY += x * y;
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
      const cx = sumX / pixels, cy = sumY / pixels;
      components.push({
        area,
        pixels,
        cx,
        cy,
        // Covariância dos pixels: dá orientação e comprimento de linhas.
        vxx: sumXX / pixels - cx * cx,
        vyy: sumYY / pixels - cy * cy,
        vxy: sumXY / pixels - cx * cy,
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

  // Eixos principais de uma mancha: comprimento, espessura e direção.
  // Para uma linha uniforme, variância ao longo dela = comprimento² / 12.
  function lineShape(c) {
    const tr = c.vxx + c.vyy;
    const det = c.vxx * c.vyy - c.vxy * c.vxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const angle = 0.5 * Math.atan2(2 * c.vxy, c.vxx - c.vyy);
    return {
      length: Math.sqrt(12 * (tr / 2 + disc)),
      thickness: Math.sqrt(12 * Math.max(0, tr / 2 - disc)),
      ux: Math.cos(angle),
      uy: Math.sin(angle),
    };
  }

  // A linha divisória da peça: reta, fina, escura, com comprimento de
  // algumas vezes o raio de um pip.
  function asDivider(c, pipR, gray, width, height) {
    const l = lineShape(c);
    if (l.length < pipR * 4 || l.length > pipR * 22) return null;
    if (l.thickness > pipR * 1.4 || l.length < l.thickness * 4) return null;
    // Reta e sólida: os pixels preenchem o retângulo comprimento × espessura.
    if (c.pixels < 0.6 * l.length * Math.max(1, l.thickness)) return null;
    // Escura contra a superfície clara da peça dos dois lados (reflexos e
    // bordas no fundo têm pouco contraste).
    const at = (x, y) => {
      x = Math.round(x); y = Math.round(y);
      return x < 0 || y < 0 || x >= width || y >= height ? null : gray[y * width + x];
    };
    const line = [], left = [], right = [];
    const off = l.thickness / 2 + pipR * 0.5;
    for (let i = -4; i <= 4; i++) {
      const px = c.cx + l.ux * l.length * i / 10, py = c.cy + l.uy * l.length * i / 10;
      const v = at(px, py);
      if (v !== null) line.push(v);
      const lv = at(px + l.uy * off, py - l.ux * off);
      const rv = at(px - l.uy * off, py + l.ux * off);
      if (lv !== null) left.push(lv);
      if (rv !== null) right.push(rv);
    }
    // Percentil alto nos lados: pips colados na linha não atrapalham.
    const lv = percentile(left, 0.75), rv = percentile(right, 0.75);
    if (percentile(line, 0.5) > 0.5 * Math.min(lv, rv)) return null;
    // Os dois lados são a mesma superfície (a peça). Uma borda de objeto no
    // fundo costuma ter cores diferentes de cada lado.
    if (Math.min(lv, rv) < 0.75 * Math.max(lv, rv)) return null;
    return { x: c.cx, y: c.cy, ux: l.ux, uy: l.uy, length: l.length, slim: l.length / Math.max(1, l.thickness) };
  }

  // Posição de um ponto relativa a uma peça: `a` ao longo da linha divisória,
  // `b` perpendicular a ela (o sinal diz de que metade é), em unidades do
  // comprimento da linha. A linha ocupa ~70–80% da largura da peça e cada
  // metade é mais ou menos quadrada, então os pips ficam em |a| < 0.75 e
  // |b| < 1.5.
  function tileCoords(t, x, y) {
    const dx = x - t.x, dy = y - t.y;
    return {
      a: (dx * t.ux + dy * t.uy) / t.length,
      b: (-dx * t.uy + dy * t.ux) / t.length,
    };
  }

  /**
   * Detecta pips.
   * @param {Uint8ClampedArray|Uint8Array} rgba  pixels RGBA
   * @param {number} width
   * @param {number} height
   * @param {object} [options]
   * @param {boolean} [options.lightPips=false]  pips claros em peça escura
   * @param {number}  [options.sensitivity=0.5]  0..1, maior = detecta mais
   * @param {number}  [options.maxPerHalf=12]  máximo de pips numa metade
   *                                           (6 no duplo-6, 9 no duplo-9…)
   * @returns {{pips: Array<{x:number,y:number,r:number}>, count: number,
   *            tiles: Array<{x:number,y:number,ux:number,uy:number,length:number,
   *                          values:[number,number]}>}}
   *   Cada pip que pertence a uma peça tem `tile` (índice em `tiles`) e
   *   `half` (0 = metade da esquerda/de cima). `tiles[i]` é a linha divisória:
   *   centro, direção e comprimento.
   */
  function detectPips(rgba, width, height, options) {
    const opts = Object.assign({ lightPips: false, sensitivity: 0.5, maxPerHalf: 12 }, options);
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

    const dividers = [];
    const pipR = Math.sqrt(typical / Math.PI);
    if (typical) {
      for (let i = blobs.length - 1; i >= 0; i--) {
        const d = asDivider(blobs[i], pipR, gray, width, height);
        if (d) {
          dividers.push(d);
          blobs.splice(i, 1);
        }
      }
    }

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
        let divider = null; // a linha divisória também pode estar grudada
        for (let off = offset + 6; off <= 120; off += 6) {
          const sub = threshold(gray, mean, width, off, x0, y0, x1, y1);
          const comps = connectedComponents(sub, x1 - x0, y1 - y0);
          for (const c of comps) c.cx += x0, c.cy += y0;
          const parts = comps.filter((c) => !c.touchesBorder && isRound(c) &&
            c.area > typical * 0.3 && c.area < typical * 2.5);
          if (parts.length > best.length) best = parts;
          // Fica com a versão mais limpa (mais fina) da linha.
          for (const c of comps) {
            const d = isRound(c) ? null : asDivider(c, pipR, gray, width, height);
            if (d && (!divider || d.slim > divider.slim)) divider = d;
          }
        }
        if (divider) dividers.push(divider);
        if (best.length < 2) { reject(b, 'shape'); continue; }
        for (const c of best) {
          c.split = true;
          if (contrasted(c) || reject(c, 'contrast')) candidates.push(c);
        }
      }
      typical = dominantArea(candidates.map((c) => c.area));
    }

    // Pips encolhem ao serem separados, por isso a tolerância maior.
    const sized = candidates.filter((c) =>
      (c.area > typical * (c.split ? 0.25 : 0.4) && c.area < typical * 2.5) || reject(c, 'size'));

    // Peças a partir das linhas divisórias. Só valem as que têm algum pip
    // (uma linha qualquer no fundo não é peça).
    const tiles = dividers.map((d) => Object.assign({ halves: [[], []] }, d));
    const assign = () => {
      const loose = [];
      for (const t of tiles) t.halves = [[], []];
      for (const c of sized) {
        let best = null, bestScore = 1;
        for (const t of tiles) {
          const { a, b } = tileCoords(t, c.cx, c.cy);
          const score = Math.max(Math.abs(a) / 0.75, Math.abs(b) / 1.5);
          if (score < bestScore) { bestScore = score; best = { t, b }; }
        }
        if (best) best.t.halves[best.b < 0 ? 0 : 1].push(c);
        else loose.push(c);
      }
      return loose;
    };
    assign();
    // Em perspectiva, a linha detectada pode sair torta em relação à peça.
    // O eixo mais comprido da nuvem de pips (com as duas metades ocupadas)
    // é o eixo da peça: corrige a orientação e reatribui.
    let refined = false;
    for (const t of tiles) {
      const all = t.halves[0].concat(t.halves[1]);
      if (t.halves[0].length < 2 || t.halves[1].length < 2) continue;
      const mx = all.reduce((acc, c) => acc + c.cx, 0) / all.length;
      const my = all.reduce((acc, c) => acc + c.cy, 0) / all.length;
      let sxx = 0, syy = 0, sxy = 0;
      for (const c of all) {
        sxx += (c.cx - mx) ** 2;
        syy += (c.cy - my) ** 2;
        sxy += (c.cx - mx) * (c.cy - my);
      }
      const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const vx = Math.cos(angle), vy = Math.sin(angle); // eixo comprido
      const nx = -t.uy, ny = t.ux;
      const dot = vx * nx + vy * ny;
      if (Math.abs(dot) < Math.cos(Math.PI / 5)) continue;
      const sgn = dot < 0 ? -1 : 1;
      // Nova direção da linha: perpendicular ao eixo comprido.
      t.ux = vy * sgn;
      t.uy = -vx * sgn;
      refined = true;
    }
    const orphans = refined ? assign() : sized.filter((c) => !tiles.some((t) => t.halves[0].includes(c) || t.halves[1].includes(c)));
    // Em foto inclinada a peça não fica perpendicular à linha na imagem, e
    // pips da ponta caem fora da região. Pip solto colado a um pip de uma
    // metade (distância típica entre pips vizinhos) entra nela.
    const step = 4.5 * pipR;
    for (let grew = true; grew;) {
      grew = false;
      for (let i = orphans.length - 1; i >= 0; i--) {
        const c = orphans[i];
        let target = null, bestDist = step;
        for (const t of tiles) {
          for (const half of t.halves) {
            for (const o of half) {
              const dist = Math.hypot(o.cx - c.cx, o.cy - c.cy);
              const tc = tileCoords(t, c.cx, c.cy);
              if (dist < bestDist && Math.abs(tc.a) < 0.9 && Math.abs(tc.b) < 1.7) {
                bestDist = dist;
                target = half;
              }
            }
          }
        }
        if (target) {
          target.push(c);
          orphans.splice(i, 1);
          grew = true;
        }
      }
    }
    const found = tiles.filter((t) => t.halves[0].length + t.halves[1].length > 0);

    let kept;
    if (found.length) {
      // Com peças identificadas, pip fora de peça só conta se for nítido
      // (a linha divisória daquela peça pode não ter sido achada).
      kept = orphans.filter((c) => c.ratio < 0.3 || reject(c, 'orphan'));
      for (const t of found) {
        t.halves = t.halves.map((half) => {
          // Uma metade não passa do máximo do jogo: fica com os mais nítidos.
          half.sort((p, q) => p.ratio - q.ratio);
          half.slice(opts.maxPerHalf).forEach((c) => reject(c, 'max'));
          return half.slice(0, opts.maxPerHalf);
        });
        kept.push(...t.halves[0], ...t.halves[1]);
      }
    } else {
      // Sem peças identificadas: pips andam em grupo, então cada um precisa
      // de outro parecido por perto. Um pip sozinho (o "1") só conta se nítido.
      const near = 9 * Math.sqrt(typical / Math.PI);
      kept = sized.filter((c) => c.ratio < 0.3 ||
        sized.some((o) => o !== c && Math.hypot(o.cx - c.cx, o.cy - c.cy) < near) ||
        reject(c, 'alone'));
    }

    const toPip = (c) => ({ x: c.cx, y: c.cy, r: Math.sqrt(c.area / Math.PI) });
    const pips = [];
    const outTiles = found.map((t, index) => {
      // Ordena as metades da esquerda para a direita (ou de cima para baixo).
      let { ux, uy } = t;
      let [h0, h1] = t.halves;
      const nx = -uy, ny = ux; // aponta para a metade 1
      if (nx < -0.1 || (Math.abs(nx) <= 0.1 && ny < 0)) {
        [h0, h1] = [h1, h0];
        ux = -ux; uy = -uy;
      }
      h0.forEach((c) => pips.push(Object.assign(toPip(c), { tile: index, half: 0 })));
      h1.forEach((c) => pips.push(Object.assign(toPip(c), { tile: index, half: 1 })));
      return { x: t.x, y: t.y, ux, uy, length: t.length, values: [h0.length, h1.length] };
    });
    const inTiles = new Set(found.flatMap((t) => t.halves.flat()));
    kept.filter((c) => !inTiles.has(c)).forEach((c) => pips.push(toPip(c)));

    const result = { pips, count: pips.length, tiles: outTiles };
    if (opts.debug) Object.assign(result, { debug, typical, dividers });
    return result;
  }

  return { detectPips, tileCoords };
});
