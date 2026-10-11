(function () {
  'use strict';

  const MAX_SIDE = 1200; // reduz fotos grandes para a detecção ficar rápida
  const STORAGE_KEY = 'domino-counter-history';

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');

  let image = null;     // ImageData da foto (já reduzida)
  let pips = [];        // [{x, y, r}]
  let typicalR = 8;     // raio usado ao adicionar pips manualmente

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      // armazenamento indisponível (modo privado): placar só nesta sessão
    }
  }

  let history = loadHistory();

  function renderHistory() {
    const list = $('history');
    list.innerHTML = '';
    history.forEach((entry) => {
      const li = document.createElement('li');
      const time = new Date(entry.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      li.innerHTML = '<b>' + entry.points + '</b> pontos · ' + time;
      list.appendChild(li);
    });
    $('scoreTotal').textContent = history.reduce((s, e) => s + e.points, 0);
    $('clear').hidden = history.length === 0;
  }

  function draw() {
    if (!image) return;
    ctx.putImageData(image, 0, 0);
    const lw = Math.max(2, canvas.width / 300);
    ctx.lineWidth = lw;
    pips.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + lw * 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = p.manual ? '#ffb300' : '#ff2d55';
      ctx.stroke();
    });
    $('total').textContent = pips.length;
  }

  function detect() {
    if (!image) return;
    const result = DominoDetector.detectPips(image.data, image.width, image.height, {
      sensitivity: parseFloat($('sensitivity').value),
      lightPips: $('lightPips').checked,
    });
    pips = result.pips;
    if (pips.length) {
      const radii = pips.map((p) => p.r).sort((a, b) => a - b);
      typicalR = radii[radii.length >> 1];
    } else {
      typicalR = Math.max(4, Math.min(image.width, image.height) / 80);
    }
    draw();
  }

  function loadFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      $('result').hidden = false;
      $('empty').hidden = true;
      detect();
      $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      alert('Não foi possível abrir essa imagem.');
    };
    img.src = url;
  }

  // Toque na foto: remove o pip mais próximo, ou adiciona um novo.
  canvas.addEventListener('click', (ev) => {
    if (!image) return;
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const y = (ev.clientY - rect.top) * (canvas.height / rect.height);
    // Tolerância generosa para dedos: pelo menos ~12px na tela.
    const tolerance = Math.max(typicalR * 1.6, 12 * (canvas.width / rect.width));
    let nearest = -1;
    let nearestDist = Infinity;
    pips.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    });
    if (nearest >= 0 && nearestDist <= tolerance) {
      pips.splice(nearest, 1);
    } else {
      pips.push({ x, y, r: typicalR, manual: true });
    }
    draw();
  });

  $('camera').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
  $('gallery').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
  $('sensitivity').addEventListener('change', detect);
  $('lightPips').addEventListener('change', detect);

  $('save').addEventListener('click', () => {
    history.push({ points: pips.length, at: Date.now() });
    saveHistory(history);
    renderHistory();
  });

  $('clear').addEventListener('click', () => {
    if (!confirm('Zerar o placar?')) return;
    history = [];
    saveHistory(history);
    renderHistory();
  });

  renderHistory();
})();
