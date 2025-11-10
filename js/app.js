// js/app.js

(function() {
  const imgLoader = document.getElementById('imgLoader');
  const imageListEl = document.getElementById('imageList');
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');

  const btnStart5 = document.getElementById('mode-start5');
  const btnPaint = document.getElementById('mode-paint');
  const paintTypeSelect = document.getElementById('paintType');
  const btnClearThis = document.getElementById('clearThis');
  const btnClearAll = document.getElementById('clearAll');

  const reqClearInput = document.getElementById('reqClear');
  const plumeDiaInput = document.getElementById('plumeDia');
  const terminalDiaInput = document.getElementById('terminalDia');

  const optACanvas = document.getElementById('optA');
  const optACTX = optACanvas.getContext('2d');
  const optBCanvas = document.getElementById('optB');
  const optBCTX = optBCanvas.getContext('2d');

  const ruleList = document.getElementById('ruleList');
  const output = document.getElementById('output');

  let currentMode = 'start5';
  let painting = false;

  const photos = [];
  let activePhotoId = null;

  // modes
  btnStart5.onclick = () => setMode('start5');
  btnPaint.onclick = () => setMode('paint');

  function setMode(m) {
    currentMode = m;
    btnStart5.classList.toggle('active', m === 'start5');
    btnPaint.classList.toggle('active', m === 'paint');
  }

  // load images
  imgLoader.addEventListener('change', e => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          const id = Date.now() + '-' + Math.random().toString(16).slice(2);
          photos.push({
            id,
            name: file.name || `Photo ${photos.length + 1}`,
            img,
            start5: [],
            startPt: null,
            endPt: null,
            pxPerMm: null,
            // obstacles: array of { kind: "...", stroke: [pts...] }
            obstacles: []
          });
          if (!activePhotoId) activePhotoId = id;
          renderImageList();
          redraw();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  });

  function renderImageList() {
    imageListEl.innerHTML = '';
    photos.forEach(p => {
      const div = document.createElement('div');
      div.className = 'img-thumb' + (p.id === activePhotoId ? ' active' : '');
      div.textContent = p.name;
      div.onclick = () => {
        activePhotoId = p.id;
        renderImageList();
        redraw();
      };
      imageListEl.appendChild(div);
    });
  }

  function getActivePhoto() {
    if (!activePhotoId) return null;
    return photos.find(p => p.id === activePhotoId) || null;
  }

  btnClearThis.onclick = () => {
    const p = getActivePhoto();
    if (!p) return;
    p.start5 = [];
    p.startPt = null;
    p.endPt = null;
    p.pxPerMm = null;
    p.obstacles = [];
    redraw();
    makeAllOutput();
  };

  btnClearAll.onclick = () => {
    photos.length = 0;
    activePhotoId = null;
    renderImageList();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    optACTX.clearRect(0,0,optACanvas.width,optACanvas.height);
    optBCTX.clearRect(0,0,optBCanvas.width,optBCanvas.height);
    output.textContent = '{"sections":[]}';
    ruleList.innerHTML = '';
  };

  // canvas interactions
  function canvasPos(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (canvas.width / rect.width),
      y: (evt.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  canvas.addEventListener('mousedown', evt => {
    const p = getActivePhoto();
    if (!p) return;
    const pos = canvasPos(evt);

    if (currentMode === 'paint') {
      painting = true;
      p.obstacles.push({
        kind: paintTypeSelect.value,
        stroke: [pos]
      });
      redraw();
    }
  });

  canvas.addEventListener('mousemove', evt => {
    const p = getActivePhoto();
    if (!p) return;
    if (currentMode === 'paint' && painting) {
      const pos = canvasPos(evt);
      const last = p.obstacles[p.obstacles.length - 1];
      last.stroke.push(pos);
      redraw();
    }
  });

  canvas.addEventListener('mouseup', evt => {
    const p = getActivePhoto();
    if (!p) return;
    const pos = canvasPos(evt);

    if (currentMode === 'start5') {
      p.start5.push(pos);
      redraw();

      if (p.start5.length === 5) {
        // 0=L 1=R 2=C 3=T 4=B
        const L = p.start5[0];
        const R = p.start5[1];
        const T = p.start5[3];
        const B = p.start5[4];

        const centreLR = { x:(L.x+R.x)/2, y:(L.y+R.y)/2 };
        const centreTB = { x:(T.x+B.x)/2, y:(T.y+B.y)/2 };
        const centre = { x:(centreLR.x+centreTB.x)/2, y:(centreLR.y+centreTB.y)/2 };

        const mmRef = 100;
        const distLR = Math.hypot(R.x - L.x, R.y - L.y);
        const distTB = Math.hypot(B.x - T.x, B.y - T.y);
        const pxPerMm = (distLR/mmRef + distTB/mmRef)/2;

        p.pxPerMm = pxPerMm;
        p.startPt = centre;

        const vx = R.x - centre.x;
        const vy = R.y - centre.y;
        const vlen = Math.hypot(vx, vy) || 1;
        const nx = vx / vlen;
        const ny = vy / vlen;
        const endX = centre.x + nx * (mmRef * pxPerMm);
        const endY = centre.y + ny * (mmRef * pxPerMm);
        p.endPt = { x:endX, y:endY };

        p.start5 = [];
        redraw();
        makeAllOutput();
      }
    }

    if (currentMode === 'paint' && painting) {
      painting = false;
      makeAllOutput();
    }
  });

  function redraw() {
    const p = getActivePhoto();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if (!p) return;
    canvas.width = p.img.width;
    canvas.height = p.img.height;
    ctx.drawImage(p.img, 0, 0, canvas.width, canvas.height);

    // partial 5 points
    if (p.start5.length) {
      ctx.fillStyle = 'magenta';
      p.start5.forEach((pt, idx) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI*2);
        ctx.fill();
        const label = ['L','R','C','T','B'][idx] || '';
        ctx.fillText(label, pt.x + 6, pt.y);
      });
    }

    // painted obstacles
    p.obstacles.forEach(ob => {
      if (ob.stroke.length < 2) return;
      const colour = colourForKind(ob.kind);
      ctx.strokeStyle = colour;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(ob.stroke[0].x, ob.stroke[0].y);
      for (let i = 1; i < ob.stroke.length; i++) {
        ctx.lineTo(ob.stroke[i].x, ob.stroke[i].y);
      }
      ctx.stroke();
      ctx.fillStyle = colour;
      const last = ob.stroke[ob.stroke.length - 1];
      ctx.fillText(ob.kind, last.x + 4, last.y + 4);
    });

    if (p.startPt) {
      ctx.fillStyle = 'lime';
      ctx.beginPath();
      ctx.arc(p.startPt.x, p.startPt.y, 6, 0, Math.PI*2);
      ctx.fill();
      ctx.fillText('FLUE', p.startPt.x + 8, p.startPt.y);
    }
    if (p.endPt) {
      ctx.fillStyle = 'aqua';
      ctx.beginPath();
      ctx.arc(p.endPt.x, p.endPt.y, 6, 0, Math.PI*2);
      ctx.fill();
      ctx.fillText('+100mm', p.endPt.x + 8, p.endPt.y);
    }

    // render previews
    renderPreviews(p);
    // sidebar rules
    renderRuleList(p);
  }

  function colourForKind(kind) {
    switch(kind) {
      case 'window': return '#ff4757';
      case 'eaves': return '#ffa502';
      case 'gutter': return '#3742fa';
      case 'downpipe': return '#1e90ff';
      case 'boundary': return '#2ed573';
      default: return '#ff6b81';
    }
  }

  // choose rule based on painted objects
  function detectRequiredClearance(p) {
    // user override wins
    const override = parseFloat(reqClearInput.value);
    if (!isNaN(override) && override > 0) {
      return { mm: override, source: 'User override' };
    }

    // look at kinds; pick most severe Worcester default
    let candidates = [];

    p.obstacles.forEach(ob => {
      if (ob.kind === 'window') {
        // use figure 34 opening 300mm, or plume 300->1500
        candidates.push({ mm: 300, reason: 'Window (fig 34: 300mm)' });
      }
      if (ob.kind === 'eaves') {
        candidates.push({ mm: 200, reason: 'Eaves (fig 34: 200mm below eaves)' });
      }
      if (ob.kind === 'gutter') {
        candidates.push({ mm: 75, reason: 'Gutter (fig 34: 75mm below gutters)' });
      }
      if (ob.kind === 'downpipe') {
        candidates.push({ mm: 75, reason: 'Downpipe (treated as gutter: 75mm)' });
      }
      if (ob.kind === 'boundary') {
        candidates.push({ mm: 300, reason: 'Boundary (fig 34: 300mm)' });
      }
    });

    if (!candidates.length) {
      return { mm: 300, source: 'Default 300mm (no painted objects)' };
    }

    // pick the largest
    let best = candidates[0];
    candidates.forEach(c => {
      if (c.mm > best.mm) best = c;
    });
    return { mm: best.mm, source: best.reason };
  }

  function minDistanceToPaint(p, point) {
    if (!p.obstacles.length) return Infinity;
    let min = Infinity;
    p.obstacles.forEach(ob => {
      const stroke = ob.stroke;
      for (let i = 0; i < stroke.length - 1; i++) {
        const a = stroke[i], b = stroke[i+1];
        const d = pointToSegmentDist(point.x, point.y, a.x, a.y, b.x, b.y);
        if (d < min) min = d;
      }
    });
    return min;
  }

  function pointToSegmentDist(px,py,x1,y1,x2,y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
    const t = ((px - x1)*dx + (py - y1)*dy) / (dx*dx + dy*dy);
    const tt = Math.max(0, Math.min(1, t));
    const cx = x1 + tt*dx;
    const cy = y1 + tt*dy;
    return Math.hypot(px - cx, py - cy);
  }

  function renderPreviews(p) {
    optACTX.clearRect(0,0,optACanvas.width,optACanvas.height);
    optBCTX.clearRect(0,0,optBCanvas.width,optBCanvas.height);
    if (!p) return;

    // draw background
    drawScaled(optACTX, p.img, optACanvas);
    drawScaled(optBCTX, p.img, optBCanvas);

    if (!p.startPt || !p.pxPerMm) return;

    const req = detectRequiredClearance(p);
    const reqMm = req.mm;
    const plumeDiaMm = parseFloat(plumeDiaInput.value) || 60;
    const terminalDiaMm = parseFloat(terminalDiaInput.value) || 100;

    const currentPx = minDistanceToPaint(p, p.startPt);
    const currentMm = currentPx / p.pxPerMm;
    const deficitMm = Math.max(0, reqMm - currentMm);

    // direction from start to 100mm point
    let dir = { x:1, y:0 };
    if (p.endPt) {
      const dx = p.endPt.x - p.startPt.x;
      const dy = p.endPt.y - p.startPt.y;
      const len = Math.hypot(dx,dy) || 1;
      dir = { x: dx/len, y: dy/len };
    }

    const moved = {
      x: p.startPt.x + dir.x * (deficitMm * p.pxPerMm),
      y: p.startPt.y + dir.y * (deficitMm * p.pxPerMm)
    };

    // draw option A
    drawCircleOnPreview(optACTX, optACanvas, p.img, moved, terminalDiaMm * p.pxPerMm, 'rgba(0,180,0,0.6)');

    // option B: plume
    drawCircleOnPreview(optBCTX, optBCanvas, p.img, p.startPt, terminalDiaMm * p.pxPerMm, 'rgba(0,120,255,0.6)');
    drawLineOnPreview(optBCTX, optBCanvas, p.img, p.startPt, moved, plumeDiaMm * p.pxPerMm, 'rgba(0,120,255,0.9)');
    drawCircleOnPreview(optBCTX, optBCanvas, p.img, moved, terminalDiaMm * p.pxPerMm, 'rgba(0,200,255,0.6)');
  }

  function drawScaled(ctx2d, img, canv) {
    const iw = img.width, ih = img.height;
    const cw = canv.width, ch = canv.height;
    const scale = Math.min(cw/iw, ch/ih);
    const w = iw * scale;
    const h = ih * scale;
    const ox = (cw - w)/2;
    const oy = (ch - h)/2;
    ctx2d.drawImage(img, ox, oy, w, h);
  }

  function mapToPreview(px, py, img, canv) {
    const iw = img.width, ih = img.height;
    const cw = canv.width, ch = canv.height;
    const scale = Math.min(cw/iw, ch/ih);
    const w = iw * scale, h = ih * scale;
    const ox = (cw - w)/2, oy = (ch - h)/2;
    return { x: ox + px*scale, y: oy + py*scale, scale };
  }

  function drawCircleOnPreview(ctx2d, canv, img, pt, diameterPxImg, color) {
    const mapped = mapToPreview(pt.x, pt.y, img, canv);
    const r = (diameterPxImg * mapped.scale) / 2;
    ctx2d.fillStyle = color;
    ctx2d.beginPath();
    ctx2d.arc(mapped.x, mapped.y, r, 0, Math.PI*2);
    ctx2d.fill();
  }

  function drawLineOnPreview(ctx2d, canv, img, p1, p2, widthPxImg, color) {
    const m1 = mapToPreview(p1.x, p1.y, img, canv);
    const m2 = mapToPreview(p2.x, p2.y, img, canv);
    ctx2d.strokeStyle = color;
    ctx2d.lineWidth = widthPxImg * m1.scale;
    ctx2d.lineCap = 'round';
    ctx2d.beginPath();
    ctx2d.moveTo(m1.x, m1.y);
    ctx2d.lineTo(m2.x, m2.y);
    ctx2d.stroke();
  }

  function renderRuleList(p) {
    ruleList.innerHTML = '';
    if (!p) return;
    const req = detectRequiredClearance(p);
    const div = document.createElement('div');
    div.textContent = `Required clearance picked: ${req.mm} mm (${req.source})`;
    ruleList.appendChild(div);

    if (p.obstacles.length) {
      p.obstacles.forEach((ob, i) => {
        const d = document.createElement('div');
        d.textContent = `Painted ${i+1}: ${ob.kind}`;
        ruleList.appendChild(d);
      });
    }
  }

  function makeAllOutput() {
    const sections = [];
    photos.forEach((p, idx) => {
      if (!p.startPt || !p.pxPerMm) return;
      const req = detectRequiredClearance(p);
      const currentPx = minDistanceToPaint(p, p.startPt);
      const currentMm = currentPx / p.pxPerMm;
      const deficitMm = Math.max(0, req.mm - currentMm);
      const plumeMm = parseFloat(plumeDiaInput.value) || 60;

      const textA = deficitMm > 0
        ? `Relocate flue terminal by approx. ${deficitMm.toFixed(0)} mm to maintain ${req.mm} mm clearance to painted objects.`
        : `Existing terminal position maintains ${req.mm} mm clearance.`;
      const textB = deficitMm > 0
        ? `Alternative: Retain current hole and fit plume management kit (Ø${plumeMm}mm) to offset terminal by ${deficitMm.toFixed(0)} mm and achieve clearance.`
        : `Plume kit optional – clearance already achieved.`;

      sections.push({
        section: `Flue / Pipework (photo ${idx+1})`,
        plainText: textA + ' ' + textB,
        naturalLanguage: textA + ' ' + textB
      });
    });
    output.textContent = JSON.stringify({
      exportedAt: new Date().toISOString(),
      manufacturer: "Worcester 8000",
      sections
    }, null, 2);
  }

})();
