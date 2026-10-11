(function () {
  'use strict';

  const MAX_SIDE = 1200; // reduz fotos grandes para a detecção ficar rápida
  const LIVE_MAX_SIDE = 720; // menor no ao vivo, para vários quadros por segundo
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

  function drawPips(context, list) {
    const lw = Math.max(2, context.canvas.width / 300);
    context.lineWidth = lw;
    list.forEach((p) => {
      context.beginPath();
      context.arc(p.x, p.y, p.r + lw * 1.5, 0, Math.PI * 2);
      context.strokeStyle = p.manual ? '#ffb300' : '#ff2d55';
      context.stroke();
    });
  }

  function draw() {
    if (!image) return;
    ctx.putImageData(image, 0, 0);
    drawPips(ctx, pips);
    $('total').textContent = pips.length;
  }

  function detectorOptions() {
    return {
      sensitivity: parseFloat($('sensitivity').value),
      lightPips: $('lightPips').checked,
    };
  }

  // Mostra a seção da foto (resultado editável) a partir do canvas principal.
  function showResult() {
    image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    $('result').hidden = false;
    $('settings').hidden = false;
    $('empty').hidden = true;
    detect();
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function detect() {
    if (!image) return;
    const result = DominoDetector.detectPips(image.data, image.width, image.height, detectorOptions());
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
    stopLive();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      showResult();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      alert('Não foi possível abrir essa imagem.');
    };
    img.src = url;
  }

  // --- Câmera ao vivo ---------------------------------------------------
  //
  // O <video> fica visível na página (o Safari do iPhone não atualiza quadros
  // de um vídeo fora da página) e os círculos são desenhados num canvas
  // transparente por cima dele. A detecção roda num canvas à parte, em
  // resolução menor, sem travar a imagem da câmera.

  const video = $('liveVideo');
  const overlay = $('liveOverlay');
  const overlayCtx = overlay.getContext('2d');
  const work = document.createElement('canvas');
  const workCtx = work.getContext('2d', { willReadFrequently: true });
  let stream = null;
  let recentCounts = [];

  function liveStatus(text) {
    $('liveStatus').textContent = text || '';
    $('liveStatus').hidden = !text;
  }

  function cameraErrorMessage(e) {
    const name = e && e.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Sem permissão para usar a câmera. No iPhone: Ajustes → Safari → Câmera → Permitir. ' +
        'Se abriu o link dentro de outro app, abra no Safari.';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return 'Nenhuma câmera encontrada neste aparelho.';
    }
    if (name === 'NotReadableError') {
      return 'A câmera está em uso por outro app. Feche-o e tente de novo.';
    }
    return 'Não foi possível abrir a câmera (' + (name || e) + '). Use o botão "Foto".';
  }

  async function startLive() {
    $('live').hidden = false;
    $('settings').hidden = false;
    $('result').hidden = true;
    $('empty').hidden = true;
    $('liveTotal').textContent = '–';
    liveStatus('Abrindo a câmera…');
    $('live').scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      liveStatus('Este navegador não permite câmera ao vivo. Abra o link no Safari ou Chrome, ou use o botão "Foto".');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      stopStream();
      liveStatus(cameraErrorMessage(e));
      return;
    }
    liveStatus('');
    recentCounts = [];
    liveLoop();
  }

  function stopStream() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  }

  function stopLive() {
    stopStream();
    $('live').hidden = true;
    if ($('result').hidden) {
      $('settings').hidden = true;
      $('empty').hidden = false;
    }
  }

  function liveLoop() {
    if (!stream) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (vw && vh) {
      const scale = Math.min(1, LIVE_MAX_SIDE / Math.max(vw, vh));
      const w = Math.round(vw * scale), h = Math.round(vh * scale);
      if (work.width !== w || work.height !== h) {
        work.width = overlay.width = w;
        work.height = overlay.height = h;
      }
      workCtx.drawImage(video, 0, 0, w, h);
      const frame = workCtx.getImageData(0, 0, w, h);
      const result = DominoDetector.detectPips(frame.data, w, h, detectorOptions());
      overlayCtx.clearRect(0, 0, w, h);
      drawPips(overlayCtx, result.pips);
      // Mediana dos últimos quadros, para o número não ficar piscando.
      recentCounts.push(result.count);
      if (recentCounts.length > 5) recentCounts.shift();
      const sorted = recentCounts.slice().sort((a, b) => a - b);
      $('liveTotal').textContent = sorted[sorted.length >> 1];
    }
    // Pausa curta entre análises para o celular não esquentar nem travar.
    setTimeout(() => requestAnimationFrame(liveLoop), 120);
  }

  // Congela o quadro atual em resolução maior e abre para conferência.
  function freezeLive() {
    if (!stream || !video.videoWidth) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.min(1, MAX_SIDE / Math.max(vw, vh));
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    stopLive();
    showResult();
  }

  $('liveStart').addEventListener('click', startLive);
  $('liveStop').addEventListener('click', stopLive);
  $('liveFreeze').addEventListener('click', freezeLive);
  // Libera a câmera quando o app vai para segundo plano.
  document.addEventListener('visibilitychange', () => { if (document.hidden && stream) stopLive(); });

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
