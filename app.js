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
const resultsBody = document.querySelector("#resultsTable tbody");
const bgUpload = document.getElementById("bgUpload");
const undoBtn = document.getElementById("undoBtn");
const optACanvas = document.getElementById("optA");
const optACTX = optACanvas.getContext("2d");
const optBCanvas = document.getElementById("optB");
const optBCTX = optBCanvas.getContext("2d");
const boilerTypeSelect = document.getElementById("boilerType");
const aiPass1Btn = document.getElementById("aiPass1Btn");
const aiPass2Btn = document.getElementById("aiPass2Btn");
const aiStatusEl = document.getElementById("aiStatus");
const aiList = document.getElementById("aiList");
const legendEl = document.getElementById("legend");

const AI_WORKER_ENDPOINT =
  (typeof window !== "undefined" && window.AI_WORKER_URL) ||
  "https://survey-brain-api.martinbibb.workers.dev/analyse-flue-image";

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
let measurementResults = [];

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
  renderLegend();
  resetAIStatus();
}

// flue is ELLIPSE
// { x, y, rx, ry }
let flue = null;
let draggingFlue = false;
let draggingFlueW = false;
let draggingFlueH = false;
const FLUE_MM = 100; // assume 100mm terminals
const DEFAULT_PLUME_MM = 60;
const KIND_LABELS = {
  "window-opening": "Window opening",
  "window-fabric": "Window fabric",
  gutter: "Gutter / pipe",
  eaves: "Eaves / soffit",
  boundary: "Facing surface",
  flue: "Flue ellipse"
};

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

if (aiPass1Btn) {
  aiPass1Btn.addEventListener("click", () => {
    runAI({ includeMarks: false, button: aiPass1Btn });
  });
}

if (aiPass2Btn) {
  aiPass2Btn.addEventListener("click", () => {
    runAI({ includeMarks: true, button: aiPass2Btn });
  });
}

// manufacturer change
manufacturerSelect.addEventListener("change", () => {
  currentManufacturerKey = manufacturerSelect.value;
  currentClearances = { ...MANUFACTURER_RULES[currentManufacturerKey].clearances };
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
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.setTransform(viewScale, 0, 0, viewScale, viewOffsetX, viewOffsetY);

  if (bgImage) {
    ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
  }

  paintedObjects.forEach(shape => {
    const pts = shape.points;
    if (!pts || pts.length === 0) return;
    const evaluation = shape._evaluation;
    const colour = evaluation
      ? evaluation.pass
        ? "rgba(34,197,94,0.85)"
        : "rgba(239,68,68,0.9)"
      : colourForKind(shape.kind);
    const strokeWidth = evaluation ? 5 : 3;

    if (pts.length > 1) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      if (pts.length > 2) {
        ctx.closePath();
        ctx.fillStyle = evaluation
          ? evaluation.pass
            ? "rgba(34,197,94,0.15)"
            : "rgba(239,68,68,0.2)"
          : "rgba(15,23,42,0.05)";
        ctx.fill();
      }
      ctx.stroke();
    }

    pts.forEach(pt => {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(pt.x - CORNER_SIZE / 2, pt.y - CORNER_SIZE / 2, CORNER_SIZE, CORNER_SIZE);
      ctx.fill();
      ctx.stroke();
    });
  });

  if (flue && measurementResults.length > 0) {
    measurementResults.forEach(result => {
      if (!result.closestPoint) return;
      ctx.strokeStyle = result.pass ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.75)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(flue.x, flue.y);
      ctx.lineTo(result.closestPoint.x, result.closestPoint.y);
      ctx.stroke();
    });
  }

  if (flue) {
    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(flue.x, flue.y, flue.rx, flue.ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "white";
    ctx.strokeStyle = "red";
    ctx.beginPath();
    ctx.rect(flue.x + flue.rx - HANDLE_SIZE / 2, flue.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.rect(flue.x - HANDLE_SIZE / 2, flue.y + flue.ry - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fill();
    ctx.stroke();
  }

  drawAIOverlays();

  distanceAnnotations.forEach(a => {
    ctx.font = "12px sans-serif";
    const textWidth = ctx.measureText ? ctx.measureText(a.text).width : 60;

    ctx.fillStyle = a.color || "rgba(15,23,42,0.85)";
    ctx.beginPath();
    ctx.arc(a.x, a.y, 6, 0, Math.PI * 2);
    ctx.fill();

    const boxX = a.x + 10;
    const boxY = a.y - 16;
    ctx.fillStyle = "rgba(15,23,42,0.88)";
    ctx.fillRect(boxX, boxY, textWidth + 12, 18);
    ctx.strokeStyle = a.color || "rgba(148,163,184,0.6)";
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, textWidth + 12, 18);
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(a.text, boxX + 6, boxY + 13);
  });

  ctx.setTransform(1, 0, 0, 1, 0, 0);
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

function formatAiAreaLabel(area, { fallback = "AI area" } = {}) {
  const baseLabel =
    area && typeof area.label === "string" && area.label.trim().length > 0
      ? area.label
      : fallback;
  const conf =
    area && typeof area.confidence === "number"
      ? ` (${Math.round(area.confidence * 100)}%)`
      : "";
  return `${baseLabel}${conf}`;
}

function renderLegend() {
  if (!legendEl) return;
  legendEl.innerHTML = "";
  if (!aiOverlays || aiOverlays.length === 0) {
    return;
  }

  const heading = document.createElement("h3");
  heading.textContent = "AI highlights";
  legendEl.appendChild(heading);

  const list = document.createElement("ol");
  aiOverlays.forEach((area, index) => {
    const item = document.createElement("li");
    const label = formatAiAreaLabel(area, { fallback: "Area" });
    const details = area.rule ? `${label} – ${area.rule}` : label;
    item.textContent = `${index + 1}. ${details}`;
    list.appendChild(item);
  });
  legendEl.appendChild(list);
}

function renderSuggestions() {
  if (!aiList) return;
  aiList.innerHTML = "";

  if (!flue) {
    const li = document.createElement("li");
    li.textContent = "Add the flue ellipse to unlock suggestions.";
    aiList.appendChild(li);
    return;
  }

  if (!measurementResults || measurementResults.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Mark nearby features to calculate clearances.";
    aiList.appendChild(li);
    return;
  }

  const sorted = [...measurementResults].sort((a, b) => Number(a.pass) - Number(b.pass));
  sorted.forEach(result => {
    const li = document.createElement("li");
    if (result.pass) {
      li.textContent = `${formatObjectLabel(result.kind)} clear (${result.actual}mm ≥ ${result.required}mm).`;
    } else {
      li.textContent = `${formatObjectLabel(result.kind)}: move ≥${result.required}mm away (currently ${result.actual}mm).`;
    }
    aiList.appendChild(li);
  });
}

function drawAIOverlays() {
  if (!aiOverlays || aiOverlays.length === 0) return;

  aiOverlays.forEach((area, index) => {
    if (!area) return;

    const points = Array.isArray(area.points)
      ? area.points
          .map(pt => ({
            x: typeof pt.x === "number" ? pt.x : Number(pt.x) || 0,
            y: typeof pt.y === "number" ? pt.y : Number(pt.y) || 0
          }))
          .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y))
      : [];

    const areaWithPoints = { ...area, points };

    ctx.save();
    ctx.strokeStyle = "rgba(255,0,0,0.8)";
    ctx.lineWidth = 3;

    let labelPoint = null;

    if (
      areaWithPoints.type === "polygon" &&
      Array.isArray(areaWithPoints.points) &&
      areaWithPoints.points.length
    ) {
      ctx.beginPath();
      ctx.moveTo(areaWithPoints.points[0].x, areaWithPoints.points[0].y);
      for (let i = 1; i < areaWithPoints.points.length; i++) {
        ctx.lineTo(areaWithPoints.points[i].x, areaWithPoints.points[i].y);
      }
      ctx.closePath();
      ctx.stroke();
      labelPoint = areaWithPoints.points[0];
    } else if (
      areaWithPoints.type === "line" &&
      Array.isArray(areaWithPoints.points) &&
      areaWithPoints.points.length >= 2
    ) {
      ctx.beginPath();
      ctx.moveTo(areaWithPoints.points[0].x, areaWithPoints.points[0].y);
      ctx.lineTo(areaWithPoints.points[1].x, areaWithPoints.points[1].y);
      ctx.stroke();
      labelPoint = {
        x: (areaWithPoints.points[0].x + areaWithPoints.points[1].x) / 2,
        y: (areaWithPoints.points[0].y + areaWithPoints.points[1].y) / 2
      };
    }

    if (labelPoint) {
      const txt = `${index + 1}. ${formatAiAreaLabel(areaWithPoints)}`;

      ctx.font = "12px sans-serif";
      const textWidth = ctx.measureText(txt).width;
      const pad = 4;
      const x = labelPoint.x + 6;
      const y = labelPoint.y - 20;

      ctx.fillStyle = "rgba(15,23,42,0.85)";
      ctx.fillRect(x, y, textWidth + pad * 2, 18);
      ctx.strokeStyle = "rgba(248,250,252,0.9)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, textWidth + pad * 2, 18);
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(txt, x + pad, y + 13);

      ctx.beginPath();
      ctx.fillStyle = "rgba(15,23,42,0.9)";
      ctx.arc(labelPoint.x, labelPoint.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${index + 1}`, labelPoint.x, labelPoint.y + 4);
      ctx.textAlign = "start";
    }

    ctx.restore();
  });
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
    case "eaves":
      return { label: "eaves / soffit", mm: currentClearances.belowEaves };
    case "gutter":
      return { label: "gutter / pipe", mm: currentClearances.belowGutter };
    case "boundary":
      return { label: "facing surface", mm: currentClearances.toFacingSurface };
    default:
      return { label: "opening", mm: currentClearances.toOpening };
  }
}

function formatObjectLabel(kind) {
  if (!kind) return "";
  if (KIND_LABELS[kind]) return KIND_LABELS[kind];
  return kind
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, chr => chr.toUpperCase());
}

function evaluateAndRender() {
  if (!resultsBody) return;
  resultsBody.innerHTML = "";
  invalidateAIOverlays();
  measurementResults = [];
  distanceAnnotations = [];

  if (!flue) {
    lastPxPerMm = null;
    const emptyRow = document.createElement("tr");
    emptyRow.className = "empty";
    emptyRow.innerHTML = '<td colspan="6">Add a flue and marks to see clearances.</td>';
    resultsBody.appendChild(emptyRow);
    draw();
    renderSuggestions();
    return;
  }

  const fluePxDiameter = flue.rx * 2;
  const pxPerMm = fluePxDiameter / FLUE_MM;
  lastPxPerMm = pxPerMm;

  paintedObjects.forEach(shape => {
    const pts = shape.points;
    if (!pts || pts.length < 2) {
      shape._evaluation = null;
      return;
    }

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

    if (!isFinite(minPx)) {
      shape._evaluation = null;
      return;
    }

    const distMm = minPx / pxPerMm;
    const actualRounded = Math.round(distMm);
    const evaluation = {
      shape,
      kind: shape.kind,
      label: rule.label,
      required: rule.mm,
      actual: actualRounded,
      pass: distMm >= rule.mm,
      closestPoint
    };

    measurementResults.push(evaluation);
    shape._evaluation = evaluation;
  });

  if (measurementResults.length === 0) {
    const emptyRow = document.createElement("tr");
    emptyRow.className = "empty";
    emptyRow.innerHTML = '<td colspan="6">Mark nearby objects to measure clearances.</td>';
    resultsBody.appendChild(emptyRow);
  } else {
    measurementResults.forEach((result, index) => {
      if (result.closestPoint) {
        distanceAnnotations.push({
          x: result.closestPoint.x,
          y: result.closestPoint.y,
          text: `#${index + 1}: ${result.actual}mm / ${result.required}mm`,
          color: result.pass ? "rgba(34,197,94,0.9)" : "rgba(239,68,68,0.95)"
        });
      }

      const tr = document.createElement("tr");
      tr.className = result.pass ? "pass-row" : "fail-row";
      tr.innerHTML = `
        <td>${index + 1}</td>
        <td>${formatObjectLabel(result.kind)}</td>
        <td>${result.label}</td>
        <td>${result.required}</td>
        <td>${result.actual}</td>
        <td class="status">${result.pass ? "✔" : "✖"}</td>
      `;
      resultsBody.appendChild(tr);
    });
  }

  draw();
  renderPreviews(pxPerMm);
  renderSuggestions();
}

function hasLocalFailures() {
  if (!flue) return false;
  const fluePxDiameter = flue.rx * 2;
  const pxPerMm = fluePxDiameter / FLUE_MM;
  for (const shape of paintedObjects) {
    if (!shape.points || shape.points.length < 2) continue;
    let minPx = Infinity;
    for (let i = 0; i < shape.points.length; i++) {
      const a = shape.points[i];
      const b = shape.points[(i + 1) % shape.points.length];
      const d = pointToSegmentDist(flue.x, flue.y, a.x, a.y, b.x, b.y);
      if (d < minPx) minPx = d;
    }
    const rule = ruleForKind(shape.kind);
    const mm = minPx / pxPerMm;
    if (mm < rule.mm) return true;
  }
  return false;
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
function isPositionClear(x, y, pxPerMm) {
  for (const shape of paintedObjects) {
    if (!shape.points || shape.points.length < 2) continue;
    let minPx = Infinity;
    for (let i = 0; i < shape.points.length; i++) {
      const a = shape.points[i];
      const b = shape.points[(i + 1) % shape.points.length];
      const d = pointToSegmentDist(x, y, a.x, a.y, b.x, b.y);
      if (d < minPx) minPx = d;
    }
    const rule = ruleForKind(shape.kind);
    const mm = minPx / pxPerMm;
    if (mm < rule.mm) {
      return false;
    }
  }
  return true;
}
function findFirstClearX(startX, y, pxPerMm) {
  const maxSearchPx = canvas.width;
  const stepPx = 5;

  for (let offset = stepPx; offset < maxSearchPx; offset += stepPx) {
    const candidateX = startX + offset;
    if (isPositionClear(candidateX, y, pxPerMm)) {
      return candidateX;
    }
  }
  return null;
}

function renderPreviews(pxPerMm) {
  optACTX.clearRect(0,0,optACanvas.width,optACanvas.height);
  optBCTX.clearRect(0,0,optBCanvas.width,optBCanvas.height);
  if (!bgImage || !flue) return;

  const targetX = findFirstClearX(flue.x, flue.y, pxPerMm);

  const metaA = drawScaled(optACTX, bgImage, optACanvas);
  const metaB = drawScaled(optBCTX, bgImage, optBCanvas);

  if (targetX !== null) {
    const movedPrev = mapToPreview({ x: targetX, y: flue.y }, metaA);
    optACTX.strokeStyle = "red";
    optACTX.lineWidth = 2;
    optACTX.beginPath();
    optACTX.ellipse(movedPrev.x, movedPrev.y, flue.rx*metaA.s, flue.ry*metaA.s, 0, 0, Math.PI*2);
    optACTX.stroke();
  } else {
    optACTX.fillStyle = "#c00";
    optACTX.font = "14px sans-serif";
    optACTX.fillText("No clear position found on this line.", 10, 20);
  }

  if (targetX !== null) {
    const fluePrevB = mapToPreview({ x: flue.x, y: flue.y }, metaB);
    const movedPrevB = mapToPreview({ x: targetX, y: flue.y }, metaB);

    const plumeMm = DEFAULT_PLUME_MM;
    const plumePx = plumeMm * pxPerMm * metaB.s;

    optBCTX.strokeStyle = "blue";
    optBCTX.lineWidth = 2;
    optBCTX.beginPath();
    optBCTX.ellipse(fluePrevB.x, fluePrevB.y, flue.rx*metaB.s, flue.ry*metaB.s, 0, 0, Math.PI*2);
    optBCTX.stroke();

    optBCTX.strokeStyle = "blue";
    optBCTX.lineWidth = plumePx;
    optBCTX.lineCap = "round";
    optBCTX.beginPath();
    optBCTX.moveTo(fluePrevB.x, fluePrevB.y);
    optBCTX.lineTo(movedPrevB.x, movedPrevB.y);
    optBCTX.stroke();

    optBCTX.lineWidth = 2;
    optBCTX.beginPath();
    optBCTX.ellipse(movedPrevB.x, movedPrevB.y, flue.rx*metaB.s, flue.ry*metaB.s, 0, 0, Math.PI*2);
    optBCTX.stroke();
  } else {
    optBCTX.fillStyle = "#c00";
    optBCTX.font = "14px sans-serif";
    optBCTX.fillText("No safe horizontal plume route.", 10, 20);
  }
}

function buildAIPayload({ includeMarks = true } = {}) {
  const payload = {
    image: canvas.toDataURL("image/png"),
    manufacturer: currentManufacturerKey,
    boilerType: boilerTypeSelect ? boilerTypeSelect.value : "fan",
    clearances: { ...currentClearances },
    rules: { ...currentClearances }
  };

  if (flue) {
    payload.flue = { x: flue.x, y: flue.y, rx: flue.rx, ry: flue.ry };
  }

  if (includeMarks) {
    payload.shapes = paintedObjects.map(shape => ({
      kind: shape.kind,
      points: (shape.points || []).map(pt => ({ x: pt.x, y: pt.y }))
    }));
    payload.measurements = (measurementResults || []).map(res => ({
      kind: res.kind,
      requiredMm: res.required,
      actualMm: res.actual
    }));
  } else {
    payload.shapes = [];
    payload.measurements = [];
  }

  if (lastPxPerMm && isFinite(lastPxPerMm)) {
    payload.scale = lastPxPerMm * 100; // px per 100mm
  }
  if (!payload.flue) {
    delete payload.flue;
  }
  return payload;
}

async function runAI({ includeMarks = true, button } = {}) {
  if (!bgImage) {
    setAIStatus("Upload a wall photo before running the AI.", { isError: true });
    return;
  }
  if (!flue) {
    setAIStatus("Place the flue ellipse before running the AI.", { isError: true });
    return;
  }

  const payload = buildAIPayload({ includeMarks });
  const analysingText = includeMarks
    ? "Analysing with your marks..."
    : "Analysing the photo...";
  setAIStatus(analysingText);

  let defaultText = "";
  if (button) {
    defaultText = button.textContent;
    button.disabled = true;
    button.textContent = "Analysing...";
  }

  aiOverlays = [];
  renderLegend();
  draw();

  try {
    const result = await analyseImageWithAI(payload);
    aiOverlays = normaliseAIResult(result);
    renderLegend();
    draw();

    if (aiOverlays.length === 0) {
      if (includeMarks && hasLocalFailures()) {
        setAIStatus("AI found no extra zones, but local check FAILED.", { isError: true });
      } else {
        const msg = includeMarks
          ? "AI didn't find additional risks with your marks."
          : "AI auto zones found no concerns.";
        setAIStatus(msg);
      }
    } else {
      const plural = aiOverlays.length === 1 ? "area" : "areas";
      const suffix = includeMarks ? " using your marks" : " automatically";
      setAIStatus(`AI highlighted ${aiOverlays.length} ${plural}${suffix}.`);
    }
  } catch (err) {
    console.error("AI analysis failed", err);
    const message = err && err.message ? err.message : "AI analysis failed.";
    setAIStatus(message, { isError: true });
    aiOverlays = [];
    renderLegend();
    draw();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = defaultText || "Run again";
    }
  }
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
renderSuggestions();
renderLegend();
draw();

