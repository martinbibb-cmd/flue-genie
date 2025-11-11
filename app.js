// ==== BASIC DATA (all the usual suspects) ====
const MANUFACTURER_RULES = {
  worcester: {
    label: "Worcester",
    clearances: {
      toOpening: 300,
      belowEaves: 200,
      belowGutter: 75,
      reducedWithExtension: 25,
      toFacingSurface: 600,
      toBoundary: 300,
      terminalFacingTerminal: 1200,
      verticalOnSameWall: 1500,
      toOppositeOpening: 2000
    }
  },
  vaillant: {
    label: "Vaillant / ecoTEC",
    clearances: {
      toOpening: 300,
      belowEaves: 200,
      belowGutter: 75,
      reducedWithExtension: 25,
      toFacingSurface: 600,
      toBoundary: 300,
      terminalFacingTerminal: 1200,
      verticalOnSameWall: 1500,
      toOppositeOpening: 2000
    }
  },
  ideal: {
    label: "Ideal Logic+",
    clearances: {
      toOpening: 300,
      belowEaves: 200,
      belowGutter: 75,
      reducedWithExtension: 25,
      toFacingSurface: 600,
      toBoundary: 300,
      terminalFacingTerminal: 1200,
      verticalOnSameWall: 1500,
      toOppositeOpening: 2000
    }
  },
  viessmann: {
    label: "Viessmann (BS 5440 set)",
    clearances: {
      toOpening: 300,
      belowEaves: 200,
      belowGutter: 75,
      reducedWithExtension: 25,
      toFacingSurface: 600,
      toBoundary: 300,
      terminalFacingTerminal: 1200,
      verticalOnSameWall: 1500,
      toOppositeOpening: 2000
    }
  }
};

// ==== DOM ====
const canvas = document.getElementById("sceneCanvas");
const ctx = canvas.getContext("2d");
const manufacturerSelect = document.getElementById("manufacturerSelect");
const clearanceFields = document.getElementById("clearanceFields");
const resultsBody = document.querySelector("#resultsTable tbody");
const bgUpload = document.getElementById("bgUpload");
const plumeMmInput = document.getElementById("plumeMm");
const undoBtn = document.getElementById("undoBtn");
const optACanvas = document.getElementById("optA");
const optACTX = optACanvas.getContext("2d");
const optBCanvas = document.getElementById("optB");
const optBCTX = optBCanvas.getContext("2d");
const downloadMarkedBtn = document.getElementById("downloadMarkedBtn");
const downloadOptABtn = document.getElementById("downloadOptABtn");
const downloadOptBBtn = document.getElementById("downloadOptBBtn");
const aiHighlightBtn = document.getElementById("aiHighlightBtn");
const aiStatusEl = document.getElementById("aiStatus");

const AI_WORKER_ENDPOINT =
  (typeof window !== "undefined" && window.AI_WORKER_URL) ||
  "https://your-worker.yourname.workers.dev/analyse-flue-image";

// view / camera
let viewScale = 1;
let viewOffsetX = 0;
let viewOffsetY = 0;

const activePointers = new Map(); // id -> {xScreen, yScreen}
let lastPinchDist = null;
let lastPinchMid = null;

// ==== STATE ====
let currentManufacturerKey = "worcester";
let currentClearances = { ...MANUFACTURER_RULES[currentManufacturerKey].clearances };
let currentTool = "window-fabric";
let bgImage = null;

const HANDLE_SIZE = 14;
const CORNER_SIZE = 18;
// painted objects are shapes: {kind, points:[{x,y}, ...]}
let paintedObjects = [];
let activeShape = null;
let draggingCorner = null;
let distanceAnnotations = [];
let aiOverlays = [];
let lastPxPerMm = null;

function resetAIStatus() {
  if (!aiStatusEl) return;
  aiStatusEl.textContent = "";
  aiStatusEl.classList.remove("error");
}

function setAIStatus(message, { isError = false } = {}) {
  if (!aiStatusEl) return;
  aiStatusEl.textContent = message || "";
  aiStatusEl.classList.toggle("error", !!message && isError);
}

function invalidateAIOverlays() {
  if (aiOverlays.length > 0) {
    aiOverlays = [];
  }
  resetAIStatus();
}

// flue is ELLIPSE
// { x, y, rx, ry }
let flue = null;
let draggingFlue = false;
let draggingFlueW = false;
let draggingFlueH = false;
const FLUE_MM = 100; // assume 100mm terminals

// ==== INIT UI ====
function populateManufacturers() {
  Object.entries(MANUFACTURER_RULES).forEach(([key, val]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = val.label;
    manufacturerSelect.appendChild(opt);
  });
  manufacturerSelect.value = currentManufacturerKey;
}
populateManufacturers();

function renderClearances() {
  clearanceFields.innerHTML = "";
  Object.entries(currentClearances).forEach(([name, value]) => {
    const lab = document.createElement("label");
    lab.textContent = name;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.value = value;
    inp.style.width = "80px";
    inp.addEventListener("input", () => {
      currentClearances[name] = Number(inp.value);
      evaluateAndRender();
    });
    lab.appendChild(inp);
    clearanceFields.appendChild(lab);
  });
}
renderClearances();

// paint tool buttons
document.querySelectorAll("#tools button[data-tool]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (activeShape) {
      const idx = paintedObjects.indexOf(activeShape);
      if (idx !== -1) {
        paintedObjects.splice(idx, 1);
      }
      activeShape = null;
    }
    currentTool = btn.dataset.tool;
    document.querySelectorAll("#tools button[data-tool]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    draw();
  });
});

const initialToolBtn = document.querySelector(`#tools button[data-tool="${currentTool}"]`);
if (initialToolBtn) {
  initialToolBtn.classList.add("active");
}

// undo
undoBtn.addEventListener("click", () => {
  if (activeShape) {
    const idx = paintedObjects.indexOf(activeShape);
    if (idx !== -1) {
      paintedObjects.splice(idx, 1);
    }
    activeShape = null;
    invalidateAIOverlays();
    draw();
    return;
  }
  if (paintedObjects.length > 0) {
    paintedObjects.pop();
    evaluateAndRender();
    return;
  }
  if (flue) {
    flue = null;
    resultsBody.innerHTML = "";
    invalidateAIOverlays();
    draw();
  }
});

// downloads
function downloadCanvas(canv, filename) {
  if (!canv) return;
  if (canv.toBlob) {
    canv.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  } else {
    const url = canv.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

downloadMarkedBtn.addEventListener("click", () => downloadCanvas(canvas, "flue-marked.png"));
downloadOptABtn.addEventListener("click", () => downloadCanvas(optACanvas, "flue-option-a.png"));
downloadOptBBtn.addEventListener("click", () => downloadCanvas(optBCanvas, "flue-option-b.png"));

if (aiHighlightBtn) {
  const defaultText = aiHighlightBtn.textContent;
  aiHighlightBtn.addEventListener("click", async () => {
    if (!bgImage) {
      setAIStatus("Upload a background photo before running the AI.", { isError: true });
      return;
    }
    if (!flue) {
      setAIStatus("Place the flue ellipse before running the AI.", { isError: true });
      return;
    }

    const payload = buildAIPayload();
    setAIStatus("Analysing image with AI...");
    aiHighlightBtn.disabled = true;
    aiHighlightBtn.textContent = "Analysing...";

    try {
      const result = await analyseImageWithAI(payload);
      aiOverlays = normaliseAIResult(result);
      draw();
      if (aiOverlays.length === 0) {
        setAIStatus("AI didn't find any concerns.");
      } else {
        const plural = aiOverlays.length === 1 ? "area" : "areas";
        setAIStatus(`AI highlighted ${aiOverlays.length} ${plural}.`);
      }
    } catch (err) {
      console.error("AI analysis failed", err);
      const message = err && err.message ? err.message : "AI analysis failed.";
      setAIStatus(message, { isError: true });
    } finally {
      aiHighlightBtn.disabled = false;
      aiHighlightBtn.textContent = defaultText;
    }
  });
}

// manufacturer change
manufacturerSelect.addEventListener("change", () => {
  currentManufacturerKey = manufacturerSelect.value;
  currentClearances = { ...MANUFACTURER_RULES[currentManufacturerKey].clearances };
  renderClearances();
  evaluateAndRender();
});

// image upload
bgUpload.addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    bgImage = img;
    invalidateAIOverlays();
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.style.width = img.width + "px";
    canvas.style.height = img.height + "px";
    canvas.style.maxWidth = "100%";
    viewScale = 1;
    viewOffsetX = 0;
    viewOffsetY = 0;
    draw();
  };
  img.src = URL.createObjectURL(file);
});

// ==== POINTER HELPERS ====
function getCanvasPos(evt) {
  const rect = canvas.getBoundingClientRect();
  const xScreen = evt.clientX - rect.left;
  const yScreen = evt.clientY - rect.top;
  const x = (xScreen - viewOffsetX) / viewScale;
  const y = (yScreen - viewOffsetY) / viewScale;
  return { x, y };
}

// ==== HITS FOR ELLIPSE ====
function hitFlueBody(pos) {
  if (!flue) return false;
  const dx = pos.x - flue.x;
  const dy = pos.y - flue.y;
  const v = (dx*dx) / (flue.rx*flue.rx) + (dy*dy) / (flue.ry*flue.ry);
  return v <= 1;
}
function hitFlueWidthHandle(pos) {
  if (!flue) return false;
  const hx = flue.x + flue.rx;
  const hy = flue.y;
  return Math.abs(pos.x - hx) <= HANDLE_SIZE && Math.abs(pos.y - hy) <= HANDLE_SIZE;
}
function hitFlueHeightHandle(pos) {
  if (!flue) return false;
  const hx = flue.x;
  const hy = flue.y + flue.ry;
  return Math.abs(pos.x - hx) <= HANDLE_SIZE && Math.abs(pos.y - hy) <= HANDLE_SIZE;
}

function hitCorner(pos, points) {
  if (!points) return -1;
  const half = CORNER_SIZE / 2;
  for (let i = points.length - 1; i >= 0; i--) {
    const pt = points[i];
    if (Math.abs(pos.x - pt.x) <= half && Math.abs(pos.y - pt.y) <= half) {
      return i;
    }
  }
  return -1;
}

// ==== DRAW ====
function draw() {
  ctx.save();
  ctx.setTransform(viewScale, 0, 0, viewScale, viewOffsetX, viewOffsetY);
  ctx.clearRect(-viewOffsetX / viewScale, -viewOffsetY / viewScale,
                canvas.width / viewScale, canvas.height / viewScale);
  if (bgImage) ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);

  // painted shapes and their corners
  paintedObjects.forEach(shape => {
    const pts = shape.points;
    if (!pts || pts.length === 0) return;
    const colour = colourForKind(shape.kind);

    if (pts.length > 1) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      if (pts.length > 2) {
        ctx.closePath();
      }
      ctx.stroke();
    }

    pts.forEach(pt => {
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(pt.x - CORNER_SIZE/2, pt.y - CORNER_SIZE/2, CORNER_SIZE, CORNER_SIZE);
      ctx.fill();
      ctx.stroke();
    });
  });

  drawAIOverlays();

  // flue ellipse
  if (flue) {
    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(flue.x, flue.y, flue.rx, flue.ry, 0, 0, Math.PI*2);
    ctx.stroke();

    // width handle
    ctx.fillStyle = "white";
    ctx.strokeStyle = "red";
    ctx.beginPath();
    ctx.rect(flue.x + flue.rx - HANDLE_SIZE/2, flue.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fill(); ctx.stroke();
    // height handle
    ctx.beginPath();
    ctx.rect(flue.x - HANDLE_SIZE/2, flue.y + flue.ry - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fill(); ctx.stroke();
  }

  distanceAnnotations.forEach(a => {
    ctx.font = "12px sans-serif";
    const textWidth = ctx.measureText ? ctx.measureText(a.text).width : 60;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(a.x + 4, a.y - 16, textWidth + 8, 16);
    ctx.fillStyle = "#fff";
    ctx.fillText(a.text, a.x + 8, a.y - 4);
  });

  ctx.restore();

  updateDownloadButtons();
}

function colourForKind(kind) {
  switch (kind) {
    case "window-fabric": return "#0088ff";
    case "window-opening": return "#3366ff";
    case "door": return "#0055aa";
    case "eaves": return "#ff9900";
    case "gutter": return "#00aa44";
    case "downpipe": return "#aa33aa";
    case "boundary": return "#2d3436";
    default: return "#ff6b81";
  }
}

function drawAIOverlays() {
  if (!aiOverlays || aiOverlays.length === 0) return;

  ctx.save();
  aiOverlays.forEach(area => {
    if (!area) return;
    const basePoints = Array.isArray(area.points) ? area.points : [];
    if (basePoints.length === 0) return;

    const points = basePoints.map(pt => ({
      x: typeof pt.x === "number" ? pt.x : Number(pt.x) || 0,
      y: typeof pt.y === "number" ? pt.y : Number(pt.y) || 0
    }));

    let labelPoint = null;
    const strokeColour = "rgba(255, 99, 71, 0.9)";
    const fillColour = "rgba(255, 99, 71, 0.15)";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = strokeColour;
    ctx.setLineDash([8, 6]);

    if (area.type === "line" || (points.length === 2 && area.type !== "polygon")) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
      const last = points[points.length - 1];
      labelPoint = {
        x: (points[0].x + last.x) / 2,
        y: (points[0].y + last.y) / 2
      };
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      if (points.length > 2) {
        ctx.closePath();
      }
      if (points.length >= 3) {
        ctx.fillStyle = fillColour;
        ctx.fill();
      }
      ctx.stroke();
      labelPoint = getPolygonCentroid(points);
    }

    ctx.setLineDash([]);
    const labelText = formatOverlayLabel(area);
    if (labelText) {
      drawOverlayLabel(labelPoint, labelText);
    }
  });
  ctx.restore();
}

function getPolygonCentroid(points) {
  if (!points || points.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  points.forEach(pt => {
    sumX += pt.x;
    sumY += pt.y;
  });
  return {
    x: sumX / points.length,
    y: sumY / points.length
  };
}

function formatOverlayLabel(area) {
  const base = area.label || area.rule || area.type;
  if (!base) return "";
  if (typeof area.confidence === "number" && isFinite(area.confidence)) {
    const pct = Math.round(area.confidence * 100);
    return `${base} (${pct}%)`;
  }
  return base;
}

function drawOverlayLabel(point, text) {
  if (!point || !isFinite(point.x) || !isFinite(point.y) || !text) return;
  ctx.save();
  ctx.font = "12px sans-serif";
  const width = ctx.measureText ? ctx.measureText(text).width : text.length * 6;
  const boxX = point.x + 4;
  const boxY = point.y - 16;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(boxX, boxY, width + 10, 18);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, boxX + 5, boxY + 13);
  ctx.restore();
}

// ==== POINTER EVENTS ====
canvas.addEventListener("pointerdown", evt => {
  const rect = canvas.getBoundingClientRect();
  activePointers.set(evt.pointerId, {
    x: evt.clientX - rect.left,
    y: evt.clientY - rect.top
  });

  if (activePointers.size === 2) {
    draggingCorner = null;
    draggingFlue = false;
    draggingFlueW = false;
    draggingFlueH = false;
    lastPinchDist = getPinchDistance();
    lastPinchMid = getPinchMidpoint();
    evt.preventDefault();
    return;
  }

  const pos = getCanvasPos(evt);

  // try to grab an existing corner first
  for (let i = paintedObjects.length - 1; i >= 0; i--) {
    const shape = paintedObjects[i];
    const cornerIndex = hitCorner(pos, shape.points);
    if (cornerIndex !== -1) {
      evt.preventDefault();
      draggingCorner = { shapeIndex: i, pointIndex: cornerIndex };
      return;
    }
  }

  // try flue first
  if (flue && hitFlueWidthHandle(pos)) {
    evt.preventDefault();
    draggingFlueW = true;
    return;
  }
  if (flue && hitFlueHeightHandle(pos)) {
    evt.preventDefault();
    draggingFlueH = true;
    return;
  }
  if (flue && hitFlueBody(pos)) {
    evt.preventDefault();
    draggingFlue = true;
    return;
  }

  // placing new flue
  if (currentTool === "flue") {
    if (!flue) {
      evt.preventDefault();
      flue = { x: pos.x, y: pos.y, rx: 60, ry: 60 };
      evaluateAndRender();
    }
    return;
  }

  if (!activeShape && !currentTool) {
    return;
  }

  if (!activeShape) {
    evt.preventDefault();
    activeShape = { kind: currentTool, points: [pos] };
    paintedObjects.push(activeShape);
    invalidateAIOverlays();
    draw();
    return;
  }

  evt.preventDefault();
  activeShape.points.push(pos);
  if (activeShape.points.length === 3) {
    const p1 = activeShape.points[0];
    const p2 = activeShape.points[1];
    const p3 = activeShape.points[2];
    const p4 = { x: p1.x + (p3.x - p2.x), y: p1.y + (p3.y - p2.y) };
    activeShape.points.push(p4);
    activeShape = null;
    currentTool = null;
    document.querySelectorAll("#tools button[data-tool]").forEach(b => b.classList.remove("active"));
    evaluateAndRender();
  } else {
    draw();
  }
});

canvas.addEventListener("pointermove", evt => {
  const rect = canvas.getBoundingClientRect();
  if (activePointers.has(evt.pointerId)) {
    activePointers.set(evt.pointerId, {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top
    });
  }

  if (activePointers.size === 2) {
    evt.preventDefault();
    const newDist = getPinchDistance();
    const newMid = getPinchMidpoint();

    if (lastPinchDist && newDist) {
      const scaleChange = newDist / lastPinchDist;
      zoomAt(newMid.x, newMid.y, scaleChange);
    }
    if (lastPinchMid) {
      const dx = newMid.x - lastPinchMid.x;
      const dy = newMid.y - lastPinchMid.y;
      viewOffsetX += dx;
      viewOffsetY += dy;
    }

    lastPinchDist = newDist;
    lastPinchMid = newMid;
    draw();
    return;
  }

  const pos = getCanvasPos(evt);
  if (draggingCorner) {
    evt.preventDefault();
    const shape = paintedObjects[draggingCorner.shapeIndex];
    if (shape && shape.points && shape.points[draggingCorner.pointIndex]) {
      shape.points[draggingCorner.pointIndex] = pos;
      evaluateAndRender();
    }
    return;
  }
  if (draggingFlue && flue) {
    evt.preventDefault();
    flue.x = pos.x;
    flue.y = pos.y;
    evaluateAndRender();
    return;
  }
  if (draggingFlueW && flue) {
    evt.preventDefault();
    flue.rx = Math.max(10, Math.abs(pos.x - flue.x));
    evaluateAndRender();
    return;
  }
  if (draggingFlueH && flue) {
    evt.preventDefault();
    flue.ry = Math.max(10, Math.abs(pos.y - flue.y));
    evaluateAndRender();
    return;
  }
});

canvas.addEventListener("pointerup", evt => {
  activePointers.delete(evt.pointerId);
  if (activePointers.size < 2) {
    lastPinchDist = null;
    lastPinchMid = null;
  }
  draggingFlue = false;
  draggingFlueW = false;
  draggingFlueH = false;
  draggingCorner = null;
});

canvas.addEventListener("pointercancel", evt => {
  activePointers.delete(evt.pointerId);
  if (activePointers.size < 2) {
    lastPinchDist = null;
    lastPinchMid = null;
  }
  draggingFlue = false;
  draggingFlueW = false;
  draggingFlueH = false;
  draggingCorner = null;
});

function getPinchDistance() {
  const pts = Array.from(activePointers.values());
  if (pts.length < 2) return null;
  const a = pts[0], b = pts[1];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function getPinchMidpoint() {
  const pts = Array.from(activePointers.values());
  if (pts.length < 2) return null;
  const a = pts[0], b = pts[1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function zoomAt(screenX, screenY, scaleChange) {
  const worldXBefore = (screenX - viewOffsetX) / viewScale;
  const worldYBefore = (screenY - viewOffsetY) / viewScale;

  viewScale *= scaleChange;
  viewScale = Math.max(0.3, Math.min(viewScale, 5));

  viewOffsetX = screenX - worldXBefore * viewScale;
  viewOffsetY = screenY - worldYBefore * viewScale;
}

// ==== DISTANCE / RULES ====
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

function closestPointOnSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return { x: x1, y: y1 };
  }
  const t = ((px - x1)*dx + (py - y1)*dy) / (dx*dx + dy*dy);
  const tt = Math.max(0, Math.min(1, t));
  return {
    x: x1 + tt*dx,
    y: y1 + tt*dy
  };
}

function forEachShapeSegment(points, callback) {
  if (!points || points.length < 2) return;
  for (let i = 0; i < points.length - 1; i++) {
    callback(points[i], points[i + 1], i, i + 1);
  }
  if (points.length > 2) {
    callback(points[points.length - 1], points[0], points.length - 1, 0);
  }
}

function ruleForKind(kind) {
  switch (kind) {
    case "window-fabric":
      // to the fabric / fixed / non-opening part
      return { label: "window fabric", mm: 150 };
    case "window-opening":
      // to opening / vent / opening sash
      return { label: "window opening", mm: 300 };
    case "door":
      return { label: "door opening", mm: 300 };
    case "eaves":
      return { label: "below eaves", mm: currentClearances.belowEaves };
    case "gutter":
    case "downpipe":
      return { label: "below gutter/pipe", mm: currentClearances.belowGutter };
    case "boundary":
      return { label: "boundary/surface", mm: currentClearances.toFacingSurface };
    default:
      return { label: "opening", mm: currentClearances.toOpening };
  }
}

function evaluateAndRender() {
  resultsBody.innerHTML = "";
  invalidateAIOverlays();
  if (!flue) {
    distanceAnnotations = [];
    lastPxPerMm = null;
    draw();
    return;
  }

  // scale: use horizontal diameter = 100mm
  const fluePxDiameter = flue.rx * 2;
  const pxPerMm = fluePxDiameter / FLUE_MM;
  lastPxPerMm = pxPerMm;

  const rows = [];
  distanceAnnotations = [];
  paintedObjects.forEach(shape => {
    const pts = shape.points;
    if (!pts || pts.length < 2) return;

    const rule = ruleForKind(shape.kind);
    let minPx = Infinity;
    let closestPoint = null;

    forEachShapeSegment(pts, (a, b) => {
      const distPx = pointToSegmentDist(flue.x, flue.y, a.x, a.y, b.x, b.y);
      if (distPx < minPx) {
        minPx = distPx;
        closestPoint = closestPointOnSegment(flue.x, flue.y, a.x, a.y, b.x, b.y);
      }
    });

    if (!isFinite(minPx)) return;

    const distMm = minPx / pxPerMm;
    if (closestPoint) {
      distanceAnnotations.push({
        x: closestPoint.x,
        y: closestPoint.y,
        text: `${Math.round(distMm)}mm / ${rule.mm}mm`
      });
    }

    rows.push({
      object: shape.kind,
      rule: rule.label,
      required: rule.mm,
      actual: Math.round(distMm),
      pass: distMm >= rule.mm
    });
  });

  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.object}</td>
      <td>${r.rule}</td>
      <td>${r.required} mm</td>
      <td>${r.actual} mm</td>
      <td class="${r.pass ? "pass" : "fail"}">${r.pass ? "✔" : "✖"}</td>
    `;
    resultsBody.appendChild(tr);
  });

  draw();
  renderPreviews(pxPerMm);
}

function updateDownloadButtons() {
  const hasBackground = !!bgImage;
  downloadMarkedBtn.disabled = !hasBackground;
  const hasPreviews = hasBackground && !!flue;
  downloadOptABtn.disabled = !hasPreviews;
  downloadOptBBtn.disabled = !hasPreviews;
}

// ==== PREVIEWS (same idea as before) ====
function drawScaled(ctx2d, img, canv) {
  const iw = img.width, ih = img.height;
  const cw = canv.width, ch = canv.height;
  const s = Math.min(cw/iw, ch/ih);
  const w = iw*s, h = ih*s;
  const ox = (cw - w)/2, oy = (ch - h)/2;
  ctx2d.drawImage(img, ox, oy, w, h);
  return { s, ox, oy };
}
function mapToPreview(pt, meta) {
  return {
    x: meta.ox + pt.x * meta.s,
    y: meta.oy + pt.y * meta.s
  };
}
function renderPreviews(pxPerMm) {
  optACTX.clearRect(0,0,optACanvas.width,optACanvas.height);
  optBCTX.clearRect(0,0,optBCanvas.width,optBCanvas.height);
  if (!bgImage || !flue) return;

  const metaA = drawScaled(optACTX, bgImage, optACanvas);
  const metaB = drawScaled(optBCTX, bgImage, optBCanvas);

  // find closest mm
  let closestMm = Infinity;
  paintedObjects.forEach(shape => {
    const pts = shape.points;
    if (!pts || pts.length < 2) return;
    forEachShapeSegment(pts, (a, b) => {
      const dPx = pointToSegmentDist(flue.x, flue.y, a.x, a.y, b.x, b.y);
      const dMm = dPx / pxPerMm;
      if (dMm < closestMm) closestMm = dMm;
    });
  });
  const target = 300;
  if (closestMm === Infinity) closestMm = target;
  const deficitMm = Math.max(0, target - closestMm);
  const movePx = deficitMm * pxPerMm;

  const moved = { x: flue.x + movePx, y: flue.y };

  // OPTION A
  const movedPrev = mapToPreview(moved, metaA);
  const rxPrev = flue.rx * metaA.s;
  const ryPrev = flue.ry * metaA.s;
  optACTX.strokeStyle = "red";
  optACTX.lineWidth = 2;
  optACTX.beginPath();
  optACTX.ellipse(movedPrev.x, movedPrev.y, rxPrev, ryPrev, 0, 0, Math.PI*2);
  optACTX.stroke();

  // OPTION B
  const fluePrevB = mapToPreview({x: flue.x, y: flue.y}, metaB);
  const movedPrevB = mapToPreview(moved, metaB);
  const plumeMm = parseFloat(plumeMmInput.value) || 60;
  const plumePx = plumeMm * pxPerMm * metaB.s;

  // original
  optBCTX.strokeStyle = "blue";
  optBCTX.lineWidth = 2;
  optBCTX.beginPath();
  optBCTX.ellipse(fluePrevB.x, fluePrevB.y, flue.rx*metaB.s, flue.ry*metaB.s, 0, 0, Math.PI*2);
  optBCTX.stroke();

  // tube
  optBCTX.strokeStyle = "blue";
  optBCTX.lineWidth = plumePx;
  optBCTX.lineCap = "round";
  optBCTX.beginPath();
  optBCTX.moveTo(fluePrevB.x, fluePrevB.y);
  optBCTX.lineTo(movedPrevB.x, movedPrevB.y);
  optBCTX.stroke();

  // new terminal
  optBCTX.lineWidth = 2;
  optBCTX.beginPath();
  optBCTX.ellipse(movedPrevB.x, movedPrevB.y, flue.rx*metaB.s, flue.ry*metaB.s, 0, 0, Math.PI*2);
  optBCTX.stroke();
}

function buildAIPayload() {
  const shapes = paintedObjects.map(shape => ({
    kind: shape.kind,
    points: (shape.points || []).map(pt => ({ x: pt.x, y: pt.y }))
  }));

  const payload = {
    image: canvas.toDataURL("image/png"),
    flue: flue ? { x: flue.x, y: flue.y, rx: flue.rx, ry: flue.ry } : null,
    shapes,
    manufacturer: currentManufacturerKey,
    clearances: { ...currentClearances },
    plumeMm: parseFloat(plumeMmInput.value) || undefined
  };

  if (lastPxPerMm && isFinite(lastPxPerMm)) {
    payload.scale = lastPxPerMm * 100; // px per 100mm
  }
  if (!payload.flue) {
    delete payload.flue;
  }
  if (payload.plumeMm === undefined) {
    delete payload.plumeMm;
  }

  return payload;
}

function normaliseAIResult(result) {
  if (!result || typeof result !== "object") return [];
  const areas = Array.isArray(result.areas) ? result.areas : [];
  return areas
    .map(area => {
      const points = Array.isArray(area.points)
        ? area.points
            .map(pt => ({
              x: typeof pt.x === "number" ? pt.x : Number(pt.x),
              y: typeof pt.y === "number" ? pt.y : Number(pt.y)
            }))
            .filter(pt => isFinite(pt.x) && isFinite(pt.y))
        : [];

      return {
        type: area.type || (points.length <= 2 ? "line" : "polygon"),
        label: area.label,
        rule: area.rule,
        confidence: typeof area.confidence === "number" ? area.confidence : undefined,
        points
      };
    })
    .filter(area => area.points.length > 0);
}

async function analyseImageWithAI(payload) {
  const res = await fetch(AI_WORKER_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    let errorText = "";
    try {
      errorText = await res.text();
    } catch (_) {
      // ignore
    }
    const statusText = errorText ? `${res.status}: ${errorText}` : `${res.status}`;
    throw new Error(`AI analysis failed: ${statusText}`);
  }

  return res.json();
}

// initial draw
draw();

