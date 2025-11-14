/* Deterministic overlay builder – no AI calls */

/* Clearances in mm (edge to edge, obstruction to flue edge) */
const CLEARANCES_MM = {
  opening: 300,   // from window opening
  reveal: 150,    // from reveal
  downpipe: 75,   // from downpipe / soil pipe
  lintel: 0       // special: lintel is treated as "no penetration"
};

/* DOM refs */
const fileInput = document.getElementById("file");
const scene = document.getElementById("scene");
const ctx = scene.getContext("2d", { willReadFrequently: true });

const togglePanBtn = document.getElementById("togglePan");
const clearMaskBtn = document.getElementById("clearMask");
const arrowsContainer = document.getElementById("arrows");
const generateBtn = document.getElementById("generate");
const statusEl = document.getElementById("status");
const debugEl = document.getElementById("debug");

const standardCanvas = document.getElementById("standardMap");
const plumeCanvas = document.getElementById("plumeMap");
const dlStdBtn = document.getElementById("downloadStandard");
const dlPlumeBtn = document.getElementById("downloadPlume");

/* Brush buttons */
document.getElementById("brushFlue").onclick = () => setBrush("flue");
document.getElementById("brushOpen").onclick = () => setBrush("opening");
document.getElementById("brushReveal").onclick = () => setBrush("reveal");
document.getElementById("brushDownpipe").onclick = () => setBrush("downpipe");
document.getElementById("brushLintel").onclick = () => setBrush("lintel");
document.getElementById("brushOther").onclick = () => setBrush("other");

/* Pan/zoom constants */
const ZOOM_STEP = 1.12;

/* Scene state */
let img = new Image();
let imgW = 0;
let imgH = 0;
let imgLoaded = false;
let scale = 1;
let ox = 0;
let oy = 0;

/* Separate mask canvas to store painted hints */
const mask = document.createElement("canvas");
const maskCtx = mask.getContext("2d", { willReadFrequently: true });

/* Painting + pan state */
let brush = "flue";
let panMode = false;
let painting = false;
let paintPointerId = null;
let panPointerId = null;
let lastPaintPt = null;
let lastPanPt = null;

/* Brush colours – use solid RGB so we can classify pixels exactly */
function colorFor(b) {
  switch (b) {
    case "flue":     return "#ff0000"; // red
    case "opening":  return "#ffff00"; // yellow
    case "reveal":   return "#ff8800"; // orange
    case "downpipe": return "#00ff00"; // green
    case "lintel":   return "#0000ff"; // blue
    case "other":    return "#999999"; // grey
    default:          return "#ffffff";
  }
}

function setBrush(b) {
  brush = b;
}

/* Pan helpers */
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

function pan(dx, dy) {
  ox += dx;
  oy += dy;
  draw();
}

/* Draw scene + mask */
function clearScene() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, scene.width, scene.height);
}

function draw() {
  clearScene();
  if (!imgLoaded) return;

  ctx.setTransform(scale, 0, 0, scale, ox, oy);
  ctx.drawImage(img, 0, 0);
  ctx.globalAlpha = 0.22;
  ctx.drawImage(mask, 0, 0);
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* Fit image into canvas pixel space */
function fitToCanvas() {
  scene.width = imgW;
  scene.height = imgH;
  mask.width = imgW;
  mask.height = imgH;
  scale = 1;
  ox = 0;
  oy = 0;
  imgLoaded = true;
}

/* Painting + pan events */
togglePanBtn.onclick = () => {
  panMode = !panMode;
  togglePanBtn.textContent = `Pan: ${panMode ? "ON" : "OFF"}`;
};

function evtPoint(e) {
  const r = scene.getBoundingClientRect();
  const x = ((e.clientX - r.left) * (scene.width / r.width) - ox) / scale;
  const y = ((e.clientY - r.top) * (scene.height / r.height) - oy) / scale;
  return { x, y };
}

function strokeMask(a, b) {
  maskCtx.strokeStyle = colorFor(brush);
  maskCtx.lineWidth = 24;
  maskCtx.lineCap = "round";
  maskCtx.beginPath();
  maskCtx.moveTo(a.x, a.y);
  maskCtx.lineTo(b.x, b.y);
  maskCtx.stroke();
}

scene.addEventListener(
  "pointerdown",
  (e) => {
    if (!imgLoaded) return;
    scene.setPointerCapture(e.pointerId);
    if (panMode) {
      panPointerId = e.pointerId;
      lastPanPt = { x: e.clientX, y: e.clientY };
      return;
    }
    e.preventDefault();
    painting = true;
    paintPointerId = e.pointerId;
    lastPaintPt = evtPoint(e);
  },
  { passive: false }
);

scene.addEventListener(
  "pointermove",
  (e) => {
    if (!imgLoaded) return;
    if (panMode && panPointerId === e.pointerId && lastPanPt) {
      const dx = e.clientX - lastPanPt.x;
      const dy = e.clientY - lastPanPt.y;
      const rect = scene.getBoundingClientRect();
      pan(dx * (scene.width / rect.width), dy * (scene.height / rect.height));
      lastPanPt = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!painting || paintPointerId !== e.pointerId) return;
    e.preventDefault();
    const p = evtPoint(e);
    strokeMask(lastPaintPt, p);
    lastPaintPt = p;
    draw();
  },
  { passive: false }
);

function endPaint(e) {
  if (!imgLoaded) return;
  if (panMode && panPointerId === e.pointerId) {
    panPointerId = null;
    lastPanPt = null;
    try { scene.releasePointerCapture(e.pointerId); } catch {}
    return;
  }
  if (paintPointerId !== e.pointerId) return;
  painting = false;
  paintPointerId = null;
  lastPaintPt = null;
  try { scene.releasePointerCapture(e.pointerId); } catch {}
}

scene.addEventListener(
  "pointerup",
  (e) => {
    if (!imgLoaded) return;
    e.preventDefault();
    endPaint(e);
  },
  { passive: false }
);
scene.addEventListener("pointercancel", endPaint);
scene.addEventListener("pointerleave", (e) => {
  if (panMode) return;
  if (painting && paintPointerId === e.pointerId) {
    painting = false;
    paintPointerId = null;
    lastPaintPt = null;
  }
});

/* Keyboard arrows */
document.addEventListener("keydown", (e) => {
  if (!imgLoaded) return;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
    e.preventDefault();
    const step = 40;
    if (e.key === "ArrowLeft") pan(-step, 0);
    if (e.key === "ArrowRight") pan(step, 0);
    if (e.key === "ArrowUp") pan(0, -step);
    if (e.key === "ArrowDown") pan(0, step);
  }
});

/* Arrow + zoom buttons (same behaviour as old app) */
arrowsContainer.querySelectorAll("[data-pan]").forEach((btn) => {
  btn.onclick = () => {
    if (!imgLoaded) return;
    const dir = btn.getAttribute("data-pan");
    if (dir === "left") pan(-40, 0);
    else if (dir === "right") pan(40, 0);
    else if (dir === "up") pan(0, -40);
    else if (dir === "down") pan(0, 40);
    else if (dir === "reset") {
      ox = 0;
      oy = 0;
      scale = 1;
      draw();
    }
  };
});

document.querySelectorAll("[data-zoom]").forEach((btn) => {
  btn.onclick = () => {
    if (!imgLoaded) return;
    const mode = btn.getAttribute("data-zoom");
    const rect = scene.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    if (mode === "in") zoomAt(cx, cy, ZOOM_STEP);
    if (mode === "out") zoomAt(cx, cy, 1 / ZOOM_STEP);
  };
});

/* File load */
fileInput.onchange = (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  img.onload = () => {
    imgW = img.naturalWidth;
    imgH = img.naturalHeight;
    fitToCanvas();
    maskCtx.clearRect(0, 0, mask.width, mask.height);
    statusEl.textContent =
      "Image loaded. Paint flue, opening, reveal, downpipe and lintel, then click Generate overlays.";
    draw();
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    statusEl.textContent = "Failed to load image.";
    URL.revokeObjectURL(url);
  };
  img.src = url;
};

/* Clear paint */
clearMaskBtn.onclick = () => {
  if (!imgLoaded) return;
  maskCtx.clearRect(0, 0, mask.width, mask.height);
  draw();
};

/* Pixel classification from mask colours */
function classifyPixel(r, g, b) {
  if (r === 255 && g === 0 && b === 0) return "flue";
  if (r === 255 && g === 255 && b === 0) return "opening";
  if (r === 255 && g === 136 && b === 0) return "reveal";
  if (r === 0 && g === 255 && b === 0) return "downpipe";
  if (r === 0 && g === 0 && b === 255) return "lintel";
  if (r === 153 && g === 153 && b === 153) return "other";
  return null;
}

/* Bounding box helper */
function makeBox() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, found: false };
}

function touchBox(box, x, y) {
  if (!box.found) {
    box.minX = box.maxX = x;
    box.minY = box.maxY = y;
    box.found = true;
  } else {
    if (x < box.minX) box.minX = x;
    if (x > box.maxX) box.maxX = x;
    if (y < box.minY) box.minY = y;
    if (y > box.maxY) box.maxY = y;
  }
}

/* Generate overlays */
generateBtn.onclick = () => {
  if (!imgLoaded) {
    statusEl.textContent = "Load an image first.";
    return;
  }

  const w = mask.width;
  const h = mask.height;
  if (!w || !h) {
    statusEl.textContent = "No image size?";
    return;
  }

  const imgData = maskCtx.getImageData(0, 0, w, h).data;

  const boxes = {
    flue: makeBox(),
    opening: makeBox(),
    reveal: makeBox(),
    downpipe: makeBox(),
    lintel: makeBox()
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];
      const type = classifyPixel(r, g, b);
      if (!type || !boxes[type]) continue;
      touchBox(boxes[type], x, y);
    }
  }

  if (!boxes.flue.found) {
    statusEl.textContent = "Please paint the flue (in red) so we can calibrate 100 mm.";
    return;
  }

  const flueBox = boxes.flue;
  const flueW = flueBox.maxX - flueBox.minX;
  const flueH = flueBox.maxY - flueBox.minY;
  const flueRadiusPx = Math.max(flueW, flueH) / 2;
  const pxPerMm = flueRadiusPx / 50; // 100 mm dia => 50 mm radius

  const rects = [];

  function pushRectFromBox(box, clearanceMmExtra, kind) {
    if (!box || !box.found) return;
    const totalMm = clearanceMmExtra + 50; // add flue radius
    const bufferPx = totalMm * pxPerMm;
    let x = box.minX - bufferPx;
    let y = box.minY - bufferPx;
    let rw = (box.maxX - box.minX) + 2 * bufferPx;
    let rh = (box.maxY - box.minY) + 2 * bufferPx;

    if (x < 0) { rw += x; x = 0; }
    if (y < 0) { rh += y; y = 0; }
    if (x + rw > w) rw = w - x;
    if (y + rh > h) rh = h - y;

    rects.push({ x, y, width: rw, height: rh, kind });
  }

  // openings, reveals, downpipes use their respective clearances
  pushRectFromBox(boxes.opening, CLEARANCES_MM.opening, "opening");
  pushRectFromBox(boxes.reveal, CLEARANCES_MM.reveal, "reveal");
  pushRectFromBox(boxes.downpipe, CLEARANCES_MM.downpipe, "downpipe");

  // lintel – treat as fully blocked: just block its thickness + flue radius
  if (boxes.lintel.found) {
    pushRectFromBox(boxes.lintel, CLEARANCES_MM.lintel, "lintel");
  }

  drawOverlays(rects, pxPerMm);
};

/* Draw overlays onto the export canvases and enable downloads */
function drawOverlays(rects, pxPerMm) {
  const w = imgW;
  const h = imgH;
  if (!w || !h) return;

  standardCanvas.width = w;
  standardCanvas.height = h;
  plumeCanvas.width = w;
  plumeCanvas.height = h;

  const sCtx = standardCanvas.getContext("2d");
  const pCtx = plumeCanvas.getContext("2d");

  // Base image
  sCtx.clearRect(0, 0, w, h);
  pCtx.clearRect(0, 0, w, h);

  sCtx.drawImage(img, 0, 0, w, h);
  pCtx.drawImage(img, 0, 0, w, h);

  // Dim standard, green wash for plume
  sCtx.fillStyle = "rgba(0,0,0,0.25)";
  sCtx.fillRect(0, 0, w, h);

  pCtx.fillStyle = "rgba(0,255,0,0.15)";
  pCtx.fillRect(0, 0, w, h);

  // Red forbidden zones
  sCtx.fillStyle = "rgba(255,0,0,0.4)";
  pCtx.fillStyle = "rgba(255,0,0,0.4)";

  rects.forEach((r) => {
    sCtx.fillRect(r.x, r.y, r.width, r.height);
    pCtx.fillRect(r.x, r.y, r.width, r.height);
  });

  statusEl.textContent =
    `Generated ${rects.length} clearance zone(s). ` +
    `Scale ≈ ${pxPerMm.toFixed(3)} px/mm from 100 mm flue.`;

  debugEl.textContent = JSON.stringify(
    { pxPerMm, rects },
    null,
    2
  );

  // Enable download buttons
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
  if (!standardCanvas.width) return;
  downloadCanvasAsPng(standardCanvas, "flue-standard.png");
};

dlPlumeBtn.onclick = () => {
  if (!plumeCanvas.width) return;
  downloadCanvasAsPng(plumeCanvas, "flue-plume.png");
};

