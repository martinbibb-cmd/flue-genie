/* CONFIG */
const AI_ENDPOINT = "https://flue-genie-ai.martinbibb.workers.dev";

/* DOM */
const brandSel = document.getElementById("brand");
const fileInput = document.getElementById("file");
const scene = document.getElementById("scene");
const ctx = scene.getContext("2d", { willReadFrequently: true });
const autoBtn = document.getElementById("autoBtn");
const refineBtn = document.getElementById("refineBtn");
const aiStatus = document.getElementById("aiStatus");
const togglePanBtn = document.getElementById("togglePan");
const exportsCard = document.getElementById("exports");
const exportStd = document.getElementById("exportStd");
const exportPlume = document.getElementById("exportPlume");
const dlStd = document.getElementById("downloadStd");
const dlPlume = document.getElementById("downloadPlume");

const ZOOM_STEP = 1.12;

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

/* Brush buttons */
document.getElementById("brushFlue").onclick = () => setBrush("flue");
document.getElementById("brushOpen").onclick = () => setBrush("opening");
document.getElementById("brushBound").onclick = () => setBrush("boundary");
document.getElementById("brushOther").onclick = () => setBrush("other");
document.getElementById("clearMask").onclick = () => {
  maskCtx.clearRect(0, 0, mask.width, mask.height);
  draw();
};

document.addEventListener("keydown", e => {
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

let brush = "flue";
function setBrush(b) {
  brush = b;
}

function rgbaFor(b) {
  return b === "flue"
    ? "rgba(255, 77, 77, .95)"
    : b === "opening"
      ? "rgba(255,216, 77, .95)"
      : b === "boundary"
        ? "rgba( 77,163,255, .95)"
        : "rgba( 56,210,107, .95)";
}

/* Scene + pan */
let img = new Image();
let imgW = 0;
let imgH = 0;
let imgLoaded = false;
let scale = 1;
let ox = 0;
let oy = 0;

// separate mask canvas (same pixel size as scene)
const mask = document.createElement("canvas");
const maskCtx = mask.getContext("2d", { willReadFrequently: true });

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
  if (flue) drawFlueEllipse();
  drawAiOverlays();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function pan(dx, dy) {
  ox += dx;
  oy += dy;
  draw();
}

/* Arrow buttons */
document.querySelectorAll("#arrows [data-pan]").forEach(btn => {
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

document.querySelectorAll("#arrows [data-zoom]").forEach(btn => {
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

/* Painting (always on unless Pan mode) */
let panMode = false;
let painting = false;
let paintPointerId = null;
let panPointerId = null;
let lastPaintPt = null;
let lastPanPt = null;

function releaseCapture(id) {
  if (id == null) return;
  try {
    scene.releasePointerCapture(id);
  } catch (err) {
    /* ignore */
  }
}

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
  maskCtx.strokeStyle = rgbaFor(brush);
  maskCtx.lineWidth = 24;
  maskCtx.lineCap = "round";
  maskCtx.beginPath();
  maskCtx.moveTo(a.x, a.y);
  maskCtx.lineTo(b.x, b.y);
  maskCtx.stroke();
}

scene.addEventListener("pointerdown", e => {
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
}, { passive: false });

scene.addEventListener("pointermove", e => {
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
}, { passive: false });

function endPaint(e) {
  if (!imgLoaded) return;
  if (panMode && panPointerId === e.pointerId) {
    panPointerId = null;
    lastPanPt = null;
    releaseCapture(e.pointerId);
    return;
  }
  if (paintPointerId !== e.pointerId) return;
  painting = false;
  paintPointerId = null;
  lastPaintPt = null;
  releaseCapture(e.pointerId);
}

scene.addEventListener("pointerup", e => {
  if (!imgLoaded) return;
  e.preventDefault();
  endPaint(e);
}, { passive: false });
scene.addEventListener("pointercancel", endPaint);
scene.addEventListener("pointerleave", e => {
  if (panMode) return;
  if (painting && paintPointerId === e.pointerId) {
    painting = false;
    paintPointerId = null;
    lastPaintPt = null;
    releaseCapture(e.pointerId);
  }
});

/* Flue ellipse (draggable), used for mm calibration via 100 mm */
let flue = null; // {x,y,rx,ry}
function drawFlueEllipse() {
  const g = ctx;
  g.save();
  g.lineWidth = 2 / scale;
  g.strokeStyle = "#ff3333";
  g.beginPath();
  g.ellipse(flue.x, flue.y, flue.rx, flue.ry, 0, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

/* Brand rules (fan-assisted) */
const RULES = {
  worcester: { opening: 300, fabric: 150, gutter: 75, eaves: 200, boundary: 600 },
  vaillant: { opening: 300, fabric: 150, gutter: 75, eaves: 200, boundary: 600 },
  viessmann: { opening: 300, fabric: 150, gutter: 75, eaves: 200, boundary: 600 },
  ideal: { opening: 300, fabric: 150, gutter: 75, eaves: 200, boundary: 600 }
};
function pxPerMm() {
  if (!flue) return null;
  return (Math.min(flue.rx, flue.ry) * 2) / 100;
}

/* File load */
fileInput.onchange = e => {
  const f = e.target.files?.[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  img.onload = () => {
    imgW = img.naturalWidth;
    imgH = img.naturalHeight;
    fitToCanvas();
    maskCtx.clearRect(0, 0, mask.width, mask.height);
    flue = null;
    aiAreas = [];
    exportsCard.classList.add("hidden");
    aiStatus.textContent = "";
    panMode = false;
    togglePanBtn.textContent = "Pan: OFF";
    draw();
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    aiStatus.textContent = "Failed to load image.";
    URL.revokeObjectURL(url);
  };
  img.src = url;
};

/* AI calls */
async function callAI(mode) {
  if (!imgLoaded) return { error: { message: "Load an image first" } };
  draw();
  const maskData = mask.width && mask.height ? mask.toDataURL("image/png") : null;
  const payload = {
    mode,
    brand: brandSel.value,
    image: scene.toDataURL("image/jpeg", 0.6),
    mask: maskData,
    marks: flue ? [{ kind: "flue", type: "ellipse", x: flue.x, y: flue.y, rx: flue.rx, ry: flue.ry }] : []
  };
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    let j;
    try {
      j = await res.json();
    } catch (err) {
      j = { error: { message: "non-json" } };
    }
    if (!res.ok) {
      return { error: j?.error || { message: `HTTP ${res.status}` }, areas: [] };
    }
    return j;
  } catch (err) {
    return { error: { message: "network error" }, areas: [] };
  }
}

let aiAreas = [];
function drawAiOverlays() {
  if (!aiAreas.length) return;
  const g = ctx;
  g.save();
  g.lineWidth = 2 / scale;
  g.strokeStyle = "#ff4d4d";
  aiAreas.forEach(a => {
    if (a.type === "rect" && Array.isArray(a.points) && a.points.length >= 2) {
      const xs = a.points.map(p => p.x);
      const ys = a.points.map(p => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      g.strokeRect(minX, minY, maxX - minX, maxY - minY);
    } else if (Array.isArray(a.points) && a.points.length) {
      g.beginPath();
      g.moveTo(a.points[0].x, a.points[0].y);
      for (let i = 1; i < a.points.length; i++) {
        g.lineTo(a.points[i].x, a.points[i].y);
      }
      g.closePath();
      g.stroke();
    }
  });
  g.restore();
}

autoBtn.onclick = async () => {
  aiStatus.textContent = "Running auto AI…";
  const r = await callAI("detect-only");
  if (r.error) {
    aiStatus.textContent = "AI error: " + (r.error.message || JSON.stringify(r.error));
    return;
  }
  aiAreas = Array.isArray(r.areas) ? r.areas : [];
  const fl = aiAreas.find(a => a.kind === "flue" && Array.isArray(a.points) && a.points.length >= 2);
  if (fl) {
    const xs = fl.points.map(p => p.x);
    const ys = fl.points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    flue = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      rx: Math.max((maxX - minX) / 2, 20),
      ry: Math.max((maxY - minY) / 2, 20)
    };
  }
  aiStatus.textContent = `Detected ${aiAreas.length} object(s). You can now paint to correct and run refine.`;
  draw();
};

refineBtn.onclick = async () => {
  aiStatus.textContent = "Refining with your marks…";
  const r = await callAI("refine");
  if (r.error) {
    aiStatus.textContent = "AI error: " + (r.error.message || JSON.stringify(r.error));
    return;
  }
  aiAreas = Array.isArray(r.areas) ? r.areas : [];
  buildExports();
  exportsCard.classList.remove("hidden");
  aiStatus.textContent = `Refined ${aiAreas.length} area(s). Exports below.`;
  draw();
};

/* Export generation */
function buildExports() {
  if (!imgLoaded || !flue) return;
  const brand = brandSel.value;
  const rules = RULES[brand];
  const ppm = pxPerMm();
  if (!ppm || !rules) return;

  function drawPhoto(dst, overlayFn) {
    const g = dst.getContext("2d");
    g.clearRect(0, 0, dst.width, dst.height);
    if (!imgW || !imgH) return;
    g.drawImage(img, 0, 0, dst.width, dst.height);
    const scaleX = dst.width / imgW;
    const scaleY = dst.height / imgH;
    g.save();
    g.scale(scaleX, scaleY);
    overlayFn(g);
    g.restore();
  }

  function nearestByKind(kind) {
    const list = aiAreas.filter(a => a.kind === kind && Array.isArray(a.points) && a.points.length);
    if (!list.length) return { dist: Infinity, dir: { x: 1, y: 0 } };
    function centroid(a) {
      const xs = a.points.map(p => p.x);
      const ys = a.points.map(p => p.y);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    }
    let best = { dist: Infinity, dir: { x: 1, y: 0 } };
    list.forEach(a => {
      const c = centroid(a);
      const dx = c.x - flue.x;
      const dy = c.y - flue.y;
      const d = Math.hypot(dx, dy);
      if (d < best.dist) {
        best = { dist: d, dir: { x: Math.sign(dx) || 1, y: Math.sign(dy) || 0 } };
      }
    });
    return best;
  }

  drawPhoto(exportStd, g => {
    const Rstd = Math.max(rules.opening, rules.fabric, rules.gutter, rules.eaves) * ppm;
    g.fillStyle = "rgba(255,0,0,.18)";
    g.beginPath();
    g.arc(flue.x, flue.y, Rstd, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = "rgba(0,180,0,.08)";
    g.fillRect(0, 0, imgW, imgH);
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.arc(flue.x, flue.y, Rstd, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = "source-over";

    const n = nearestByKind("window-opening");
    const shift = (rules.opening + 120) * ppm;
    const sug = { x: flue.x - n.dir.x * shift, y: flue.y - n.dir.y * 40 };
    g.fillStyle = "#d00";
    g.beginPath();
    g.arc(sug.x, sug.y, 6, 0, Math.PI * 2);
    g.fill();
  });

  drawPhoto(exportPlume, g => {
    const Rterm = Math.max(rules.fabric, rules.gutter) * ppm;
    g.fillStyle = "rgba(255,0,0,.18)";
    g.beginPath();
    g.arc(flue.x, flue.y, Rterm, 0, Math.PI * 2);
    g.fill();

    const Rplume = 150 * ppm;
    g.strokeStyle = "rgba(0,120,255,.9)";
    g.lineWidth = 10;
    g.beginPath();
    g.arc(flue.x, flue.y, Rplume, 0, Math.PI * 2);
    g.stroke();

    g.fillStyle = "rgba(0,180,0,.09)";
    g.beginPath();
    g.arc(flue.x, flue.y, Rplume + 40 * ppm, 0, Math.PI * 2);
    g.fill();

    const n = nearestByKind("window-opening");
    const sug = { x: flue.x + (n.dir.x ? -n.dir.x : 1) * (Rplume + 30 * ppm), y: flue.y };
    g.fillStyle = "#0a7";
    g.beginPath();
    g.arc(sug.x, sug.y, 6, 0, Math.PI * 2);
    g.fill();
  });

  dlStd.onclick = () => downloadCanvas(exportStd, "flue-standard.png");
  dlPlume.onclick = () => downloadCanvas(exportPlume, "flue-plume.png");
}

function downloadCanvas(cvs, name) {
  const a = document.createElement("a");
  a.href = cvs.toDataURL("image/png");
  a.download = name;
  a.click();
}

scene.addEventListener("dblclick", e => {
  if (!imgLoaded) return;
  const p = evtPoint(e);
  flue = { x: p.x, y: p.y, rx: 28, ry: 28 };
  draw();
});
