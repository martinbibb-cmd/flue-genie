/* Flue-Genie: tap-based geometry, deterministic overlays */

/* Clearances in mm, edge-to-edge from obstruction to flue edge */
const CLEARANCES_MM = {
  opening: 300,
  reveal: 150,
  downpipe: 75,
  soffit: 75,
  boundary: 600,
  lintel: 0 // handled specially
};

/* DOM elements */
const fileInput = document.getElementById("file");
const scene = document.getElementById("scene");
const ctx = scene.getContext("2d");

const togglePanBtn = document.getElementById("togglePan");
const resetViewBtn = document.getElementById("resetView");
const clearShapesBtn = document.getElementById("clearShapes");
const generateBtn = document.getElementById("generate");
const statusEl = document.getElementById("status");
const debugEl = document.getElementById("debug");

const arrows = document.getElementById("arrows");
const zoomBtns = document.querySelectorAll("[data-zoom]");

const stdCanvas = document.getElementById("standardMap");
const plumeCanvas = document.getElementById("plumeMap");
const dlStdBtn = document.getElementById("downloadStandard");
const dlPlumeBtn = document.getElementById("downloadPlume");

/* Scene image & view state */
let img = new Image();
let imgW = 0;
let imgH = 0;
let imgLoaded = false;
let scale = 1;
let ox = 0;
let oy = 0;

const ZOOM_STEP = 1.12;

/* Geometry model */
let flueCircle = null; // { cx, cy, r }
let openings = [];     // [{ x1,y1,x2,y2 }]
let lines = [];        // [{ x1,y1,x2,y2, kind }]

/* Interaction state */
let panMode = false;
let currentTool = "flue"; // "flue"|"opening"|"downpipe"|"soffit"|"boundary"|"reveal"
let activeStep = null;    // for 2-click shapes
let activePreview = null; // for previews
let activePointerId = null;
let lastPanPt = null;

/* Helpers to convert between screen and image coords */
function scenePointFromEvent(e) {
  const r = scene.getBoundingClientRect();
  const canvasX = (e.clientX - r.left) * (scene.width / r.width);
  const canvasY = (e.clientY - r.top) * (scene.height / r.height);
  const x = (canvasX / scale) - ox;
  const y = (canvasY / scale) - oy;
  return { x, y };
}

/* View transforms */
function resetView() {
  scale = 1;
  ox = 0;
  oy = 0;
  draw();
}

function pan(dx, dy) {
  ox += dx;
  oy += dy;
  draw();
}

function zoomAt(cx, cy, factor) {
  if (!imgLoaded) return;
  const rect = scene.getBoundingClientRect();
  const canvasX = (cx / rect.width) * scene.width;
  const canvasY = (cy / rect.height) * scene.height;
  const preX = canvasX / scale - ox;
  const preY = canvasY / scale - oy;
  scale *= factor;
  const postX = canvasX / scale - ox;
  const postY = canvasY / scale - oy;
  ox += postX - preX;
  oy += postY - preY;
  draw();
}

/* Drawing */
function clearScene() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, scene.width, scene.height);
}

function draw() {
  clearScene();
  if (!imgLoaded) return;

  ctx.setTransform(scale, 0, 0, scale, ox, oy);
  ctx.drawImage(img, 0, 0);

  // Draw existing shapes
  ctx.lineWidth = 2 / scale;

  if (flueCircle) {
    ctx.strokeStyle = "rgba(255,0,0,0.9)";
    ctx.beginPath();
    ctx.arc(flueCircle.cx, flueCircle.cy, flueCircle.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,0,0.9)";
  openings.forEach((o) => {
    const x = Math.min(o.x1, o.x2);
    const y = Math.min(o.y1, o.y2);
    const w = Math.abs(o.x2 - o.x1);
    const h = Math.abs(o.y2 - o.y1);
    ctx.strokeRect(x, y, w, h);
  });

  lines.forEach((ln) => {
    let color = "rgba(0,255,0,0.9)";
    if (ln.kind === "soffit") color = "rgba(0,200,255,0.9)";
    if (ln.kind === "boundary") color = "rgba(255,0,255,0.9)";
    if (ln.kind === "reveal") color = "rgba(255,136,0,0.9)";
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(ln.x1, ln.y1);
    ctx.lineTo(ln.x2, ln.y2);
    ctx.stroke();
  });

  // Draw preview shape if any
  if (activePreview) {
    ctx.setLineDash([6 / scale, 4 / scale]);
    const p = activePreview;
    if (p.type === "circle") {
      ctx.strokeStyle = "rgba(255,0,0,0.5)";
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.type === "rect") {
      ctx.strokeStyle = "rgba(255,255,0,0.5)";
      const x = Math.min(p.x1, p.x2);
      const y = Math.min(p.y1, p.y2);
      const w = Math.abs(p.x2 - p.x1);
      const h = Math.abs(p.y2 - p.y1);
      ctx.strokeRect(x, y, w, h);
    } else if (p.type === "line") {
      let color = "rgba(0,255,0,0.5)";
      if (p.kind === "soffit") color = "rgba(0,200,255,0.5)";
      if (p.kind === "boundary") color = "rgba(255,0,255,0.5)";
      if (p.kind === "reveal") color = "rgba(255,136,0,0.5)";
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(p.x1, p.y1);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* Tool handling */
function setTool(tool) {
  currentTool = tool;
  activeStep = null;
  activePreview = null;
  statusEl.textContent =
    `Tool: ${tool}. ${tool === "flue"
      ? "Tap centre, then tap edge of flue."
      : tool === "opening"
        ? "Tap two opposite corners of the opening."
        : "Tap two points along the feature line."
    }`;
  draw();
}

document.querySelectorAll("[data-tool]").forEach((btn) => {
  btn.onclick = () => setTool(btn.getAttribute("data-tool"));
});

togglePanBtn.onclick = () => {
  panMode = !panMode;
  togglePanBtn.textContent = `Pan: ${panMode ? "ON" : "OFF"}`;
  activeStep = null;
  activePreview = null;
  draw();
};

resetViewBtn.onclick = resetView;

clearShapesBtn.onclick = () => {
  flueCircle = null;
  openings = [];
  lines = [];
  activeStep = null;
  activePreview = null;
  draw();
};

/* Undo last */
document.getElementById("undo").onclick = () => {
  if (lines.length) {
    lines.pop();
  } else if (openings.length) {
    openings.pop();
  } else if (flueCircle) {
    flueCircle = null;
  }
  activeStep = null;
  activePreview = null;
  draw();
};

/* Pointer interactions */
scene.addEventListener("pointerdown", (e) => {
  if (!imgLoaded) return;
  scene.setPointerCapture(e.pointerId);
  activePointerId = e.pointerId;

  if (panMode) {
    const r = scene.getBoundingClientRect();
    lastPanPt = { x: e.clientX, y: e.clientY, cw: r.width, ch: r.height };
    return;
  }

  const pt = scenePointFromEvent(e);

  if (currentTool === "flue") {
    if (!activeStep) {
      activeStep = { type: "circle", cx: pt.x, cy: pt.y };
      activePreview = { type: "circle", cx: pt.x, cy: pt.y, r: 10 };
    } else {
      const dx = pt.x - activeStep.cx;
      const dy = pt.y - activeStep.cy;
      const r = Math.max(5, Math.hypot(dx, dy));
      flueCircle = { cx: activeStep.cx, cy: activeStep.cy, r };
      activeStep = null;
      activePreview = null;
    }
  } else if (currentTool === "opening") {
    if (!activeStep) {
      activeStep = { type: "rect", x1: pt.x, y1: pt.y };
      activePreview = { type: "rect", x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
    } else {
      openings.push({ x1: activeStep.x1, y1: activeStep.y1, x2: pt.x, y2: pt.y });
      activeStep = null;
      activePreview = null;
    }
  } else {
    // line-type tools: downpipe / soffit / boundary / reveal
    if (!activeStep) {
      activeStep = { type: "line", x1: pt.x, y1: pt.y, kind: currentTool };
      activePreview = { type: "line", x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, kind: currentTool };
    } else {
      lines.push({ x1: activeStep.x1, y1: activeStep.y1, x2: pt.x, y2: pt.y, kind: currentTool });
      activeStep = null;
      activePreview = null;
    }
  }

  draw();
});

scene.addEventListener("pointermove", (e) => {
  if (!imgLoaded || activePointerId !== e.pointerId) return;

  if (panMode && lastPanPt) {
    const r = scene.getBoundingClientRect();
    const dxPx = e.clientX - lastPanPt.x;
    const dyPx = e.clientY - lastPanPt.y;
    const sx = scene.width / lastPanPt.cw;
    const sy = scene.height / lastPanPt.ch;
    pan(dxPx * sx, dyPx * sy);
    lastPanPt = { x: e.clientX, y: e.clientY, cw: r.width, ch: r.height };
    return;
  }

  if (!activeStep) return;

  const pt = scenePointFromEvent(e);

  if (activeStep.type === "circle" && activePreview) {
    const dx = pt.x - activeStep.cx;
    const dy = pt.y - activeStep.cy;
    activePreview.r = Math.max(5, Math.hypot(dx, dy));
  } else if (activeStep.type === "rect" && activePreview) {
    activePreview.x2 = pt.x;
    activePreview.y2 = pt.y;
  } else if (activeStep.type === "line" && activePreview) {
    activePreview.x2 = pt.x;
    activePreview.y2 = pt.y;
  }

  draw();
});

scene.addEventListener("pointerup", (e) => {
  if (activePointerId === e.pointerId) {
    activePointerId = null;
    lastPanPt = null;
    try { scene.releasePointerCapture(e.pointerId); } catch {}
  }
});

scene.addEventListener("pointercancel", (e) => {
  if (activePointerId === e.pointerId) {
    activePointerId = null;
    lastPanPt = null;
    activeStep = null;
    activePreview = null;
    try { scene.releasePointerCapture(e.pointerId); } catch {}
    draw();
  }
});

/* Arrow + zoom buttons */
arrows.querySelectorAll("[data-pan]").forEach((btn) => {
  btn.onclick = () => {
    if (!imgLoaded) return;
    const dir = btn.getAttribute("data-pan");
    const step = 40;
    if (dir === "left") pan(-step, 0);
    else if (dir === "right") pan(step, 0);
    else if (dir === "up") pan(0, -step);
    else if (dir === "down") pan(0, step);
  };
});

zoomBtns.forEach((btn) => {
  btn.onclick = () => {
    if (!imgLoaded) return;
    const mode = btn.getAttribute("data-zoom");
    const rect = scene.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    zoomAt(cx, cy, mode === "in" ? ZOOM_STEP : 1 / ZOOM_STEP);
  };
});

/* Image load */
fileInput.onchange = (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  img.onload = () => {
    imgW = img.naturalWidth;
    imgH = img.naturalHeight;
    scene.width = imgW;
    scene.height = imgH;
    imgLoaded = true;
    resetView();
    flueCircle = null;
    openings = [];
    lines = [];
    activeStep = null;
    activePreview = null;
    statusEl.textContent =
      "Image loaded. Choose a tool (Flue circle first), tap to mark, then Generate overlays.";
    draw();
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    statusEl.textContent = "Failed to load image.";
    URL.revokeObjectURL(url);
  };
  img.src = url;
};

/* Geometry helpers */
function boundingRectFromPoints(x1, y1, x2, y2) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/* Overlay generation */
generateBtn.onclick = () => {
  if (!imgLoaded) {
    statusEl.textContent = "Load an image first.";
    return;
  }
  if (!flueCircle) {
    statusEl.textContent = "Mark the flue circle first (centre then edge).";
    return;
  }

  // Calibrate pxPerMm from flue radius (100 mm dia => 50 mm radius)
  let pxPerMm = flueCircle.r / 50;
  if (!Number.isFinite(pxPerMm) || pxPerMm <= 0) pxPerMm = 1;
  if (pxPerMm > 5) pxPerMm = 5;

  const rects = [];

  function addInflatedRect(rect, clearanceMm, kind) {
    const totalMm = clearanceMm + 50; // clearance edge-edge + flue radius
    let bufferPx = totalMm * pxPerMm;
    const maxBuffer = Math.min(imgW, imgH) * 0.45;
    if (bufferPx > maxBuffer) bufferPx = maxBuffer;

    let x = rect.x - bufferPx;
    let y = rect.y - bufferPx;
    let w = rect.w + 2 * bufferPx;
    let h = rect.h + 2 * bufferPx;

    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > imgW) w = imgW - x;
    if (y + h > imgH) h = imgH - y;

    rects.push({ x, y, w, h, kind });
  }

  openings.forEach((o) => {
    const r = boundingRectFromPoints(o.x1, o.y1, o.x2, o.y2);
    addInflatedRect(r, CLEARANCES_MM.opening, "opening");
  });

  lines.forEach((ln) => {
    const box = boundingRectFromPoints(ln.x1, ln.y1, ln.x2, ln.y2);
    const base =
      ln.kind === "downpipe" ? CLEARANCES_MM.downpipe
      : ln.kind === "soffit" ? CLEARANCES_MM.soffit
      : ln.kind === "boundary" ? CLEARANCES_MM.boundary
      : ln.kind === "reveal" ? CLEARANCES_MM.reveal
      : 0;

    if (ln.kind === "lintel") {
      addInflatedRect(box, CLEARANCES_MM.lintel, "lintel");
    } else {
      addInflatedRect(box, base, ln.kind);
    }
  });

  drawOverlays(rects, pxPerMm);
};

/* Draw overlays on export canvases */
function drawOverlays(rects, pxPerMm) {
  stdCanvas.width = imgW;
  stdCanvas.height = imgH;
  plumeCanvas.width = imgW;
  plumeCanvas.height = imgH;

  const sCtx = stdCanvas.getContext("2d");
  const pCtx = plumeCanvas.getContext("2d");

  // Base images
  sCtx.clearRect(0, 0, imgW, imgH);
  pCtx.clearRect(0, 0, imgW, imgH);

  sCtx.drawImage(img, 0, 0, imgW, imgH);
  pCtx.drawImage(img, 0, 0, imgW, imgH);

  // Dim + green wash
  sCtx.fillStyle = "rgba(0,0,0,0.25)";
  sCtx.fillRect(0, 0, imgW, imgH);

  pCtx.fillStyle = "rgba(0,255,0,0.15)";
  pCtx.fillRect(0, 0, imgW, imgH);

  // Red forbidden zones
  sCtx.fillStyle = "rgba(255,0,0,0.4)";
  pCtx.fillStyle = "rgba(255,0,0,0.4)";
  rects.forEach((r) => {
    sCtx.fillRect(r.x, r.y, r.w, r.h);
    pCtx.fillRect(r.x, r.y, r.w, r.h);
  });

  statusEl.textContent =
    `Generated ${rects.length} clearance zone(s). Scale ≈ ${pxPerMm.toFixed(
      3
    )} px/mm from flue circle.`;

  debugEl.textContent = JSON.stringify({ pxPerMm, rects, flueCircle, openings, lines }, null, 2);

  dlStdBtn.disabled = false;
  dlPlumeBtn.disabled = false;
}

/* Download helpers */
function downloadCanvasAsPng(canvas, filename) {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

dlStdBtn.onclick = () => {
  if (!stdCanvas.width) return;
  downloadCanvasAsPng(stdCanvas, "flue-standard.png");
};

dlPlumeBtn.onclick = () => {
  if (!plumeCanvas.width) return;
  downloadCanvasAsPng(plumeCanvas, "flue-plume.png");
};

/* Default tool */
setTool("flue");
