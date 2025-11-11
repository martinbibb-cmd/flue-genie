// ==== BASIC DATA (all the usual suspects) ====
const MANUFACTURERS = [
  { value: "worcester", label: "Worcester" },
  { value: "vaillant", label: "Vaillant / ecoTEC" },
  { value: "ideal", label: "Ideal Logic+" },
  { value: "viessmann", label: "Viessmann (BS 5440 set)" }
];

const RULE_SETS = {
  fan: {
    windowOpening: 300,
    windowFabric: 150,
    eaves: 200,
    gutter: 75,
    boundary: 600
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
const optCCanvas = document.getElementById("optC");
const optCCTX = optCCanvas.getContext("2d");
const optDCanvas = document.getElementById("optD");
const optDCTX = optDCanvas.getContext("2d");
const boilerTypeSelect = document.getElementById("boilerType");
const aiPass1Btn = document.getElementById("aiPass1Btn");
const aiPass2Btn = document.getElementById("aiPass2Btn");
const aiStatusEl = document.getElementById("aiStatus");
const aiList = document.getElementById("aiList");
const legendEl = document.getElementById("legend");
const autoDetectBtn = document.getElementById("autoDetectBtn");
const roughBrushBtn = document.getElementById("roughBrushBtn");

const ROUGH_BRUSH_IDLE_LABEL = roughBrushBtn
  ? roughBrushBtn.textContent
  : "Rough paint → AI clean";

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
let currentManufacturerKey = MANUFACTURERS[0]?.value || "worcester";
let currentRules = { ...RULE_SETS.fan };
let currentTool = "window-fabric";
let bgImage = null;

const HANDLE_SIZE = 16;
const CORNER_SIZE = 18;
// painted objects are shapes: {kind, points:[{x,y}, ...]}
let paintedObjects = [];
let activeShape = null;
let draggingCorner = null;
let distanceAnnotations = [];
let aiOverlays = [];
let safetyZones = [];
let lastPxPerMm = null;
let measurementResults = [];
let roughBrushMode = false;
let roughStrokes = [];
let roughActivePointerId = null;

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

function setRoughBrushMode(enabled) {
  roughBrushMode = enabled;
  if (!roughBrushBtn) return;
  roughBrushBtn.classList.toggle("active", enabled);
  roughBrushBtn.textContent = enabled ? "Finish rough brush" : ROUGH_BRUSH_IDLE_LABEL;
  if (!enabled) {
    roughActivePointerId = null;
  }
}

function normaliseAiPoints(points = []) {
  if (!Array.isArray(points)) return [];
  return points
    .map(pt => ({
      x: typeof pt.x === "number" ? pt.x : Number(pt.x),
      y: typeof pt.y === "number" ? pt.y : Number(pt.y)
    }))
    .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y));
}

function mapAiLabelToKind(label = "") {
  const l = String(label || "").toLowerCase();
  if (l.includes("fabric")) return "window-fabric";
  if (l.includes("window")) return "window-opening";
  if (l.includes("soffit") || l.includes("eaves")) return "eaves";
  if (l.includes("gutter") || l.includes("pipe") || l.includes("downpipe")) return "gutter";
  if (l.includes("boundary") || l.includes("facing")) return "boundary";
  return null;
}

function applyAiAreasToPaintedObjects(areas, { replaceExisting = true, source = "ai" } = {}) {
  if (!Array.isArray(areas) || areas.length === 0) {
    return 0;
  }

  if (replaceExisting) {
    for (let i = paintedObjects.length - 1; i >= 0; i--) {
      if (paintedObjects[i] && paintedObjects[i]._source === source) {
        paintedObjects.splice(i, 1);
      }
    }
  }

  if (replaceExisting) {
    if (activeShape && activeShape._source === source) {
      activeShape = null;
    }
    draggingCorner = null;
  }

  let added = 0;
  areas.forEach(area => {
    const kind = mapAiLabelToKind(area?.label || area?.zone);
    if (!kind) return;
    const points = normaliseAiPoints(area?.points);
    if (!points || points.length === 0) return;
    paintedObjects.push({
      kind,
      points,
      _source: source
    });
    added += 1;
  });

  return added;
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
  MANUFACTURERS.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
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
  if (roughStrokes.length > 0) {
    roughStrokes.pop();
    draw();
    return;
  }
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

if (autoDetectBtn) {
  autoDetectBtn.addEventListener("click", () => {
    runAutoDetect();
  });
}

if (roughBrushBtn) {
  roughBrushBtn.addEventListener("click", async () => {
    if (!roughBrushMode) {
      roughStrokes = [];
      setRoughBrushMode(true);
      setAIStatus("Rough brush mode enabled – scribble over the objects, then tap again to clean.");
      draw();
      return;
    }
    await runRoughBrushCleanup();
  });
}

// manufacturer change
manufacturerSelect.addEventListener("change", () => {
  currentManufacturerKey = manufacturerSelect.value;
  currentRules = { ...RULE_SETS.fan };
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

  safetyZones.forEach(zone => {
    if (zone.type !== "circle") return;
    ctx.fillStyle = zone.color;
    ctx.beginPath();
    ctx.arc(zone.cx, zone.cy, zone.r, 0, Math.PI * 2);
    ctx.fill();
  });

  if (roughStrokes.length > 0) {
    ctx.strokeStyle = "rgba(37,99,235,0.7)";
    ctx.lineWidth = 24;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(roughStrokes[0].x, roughStrokes[0].y);
    for (let i = 1; i < roughStrokes.length; i++) {
      ctx.lineTo(roughStrokes[i].x, roughStrokes[i].y);
    }
    if (roughStrokes.length === 1) {
      ctx.lineTo(roughStrokes[0].x + 0.01, roughStrokes[0].y + 0.01);
    }
    ctx.stroke();
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

  if (flue) {
    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(flue.x, flue.y, flue.rx, flue.ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (measurementResults.length > 0) {
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

    ctx.fillStyle = "white";
    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(flue.x + flue.rx - HANDLE_SIZE / 2, flue.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.rect(flue.x - HANDLE_SIZE / 2, flue.y + flue.ry - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fill();
    ctx.stroke();
  }

  aiOverlays.forEach((area, idx) => {
    if (!area) return;

    const points = Array.isArray(area.points)
      ? area.points
          .map(pt => ({
            x: typeof pt.x === "number" ? pt.x : Number(pt.x) || 0,
            y: typeof pt.y === "number" ? pt.y : Number(pt.y) || 0
          }))
          .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y))
      : [];

    const stroke = area.zone === "safe"
      ? "rgba(0,180,0,0.8)"
      : area.zone === "plume"
        ? "rgba(0,120,255,0.8)"
        : "rgba(255,0,0,0.8)";

    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;

    let anchor = null;

    if (area.type === "polygon" && points.length) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
      ctx.stroke();
      anchor = points[0];
    } else if (area.type === "line" && points.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.stroke();
      anchor = {
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2
      };
    }

    if (anchor) {
      const labelText = `${idx + 1}. ${area.label || area.zone || "AI area"}`;
      ctx.font = "12px sans-serif";
      const textWidth = ctx.measureText(labelText).width + 8;
      const x = anchor.x + 6;
      const y = anchor.y - 16;
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(x, y, textWidth, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(labelText, x + 4, y + 12);
    }

    ctx.restore();
  });

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

function colourForZone(zone) {
  switch (zone) {
    case "safe":
      return {
        stroke: "rgba(34,197,94,0.9)",
        fill: "rgba(134,239,172,0.25)",
        text: "#16a34a"
      };
    case "plume":
      return {
        stroke: "rgba(59,130,246,0.9)",
        fill: "rgba(147,197,253,0.25)",
        text: "#2563eb"
      };
    default:
      return {
        stroke: "rgba(239,68,68,0.9)",
        fill: "rgba(248,113,113,0.25)",
        text: "#dc2626"
      };
  }
}

function formatAiAreaLabel(area, { fallback = "AI area" } = {}) {
  let baseLabel = fallback;
  if (area && typeof area.label === "string" && area.label.trim().length > 0) {
    baseLabel = area.label;
  } else if (area && typeof area.zone === "string" && area.zone.trim()) {
    baseLabel = area.zone;
  }
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

  aiOverlays.forEach((area, index) => {
    const palette = colourForZone(area.zone);
    const wrapper = document.createElement("div");
    const label = formatAiAreaLabel(area, { fallback: "AI area" });
    const info = area.rule ? `${label} – ${area.rule}` : label;
    wrapper.innerHTML = `<strong style="color:${palette.text}">#${index + 1}</strong> ${info}`;
    legendEl.appendChild(wrapper);
  });
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
      li.textContent = `${formatObjectLabel(result.kind)} OK – ${result.actual}mm ≥ ${result.required}mm required.`;
    } else {
      li.textContent = `${formatObjectLabel(result.kind)}: move to ≥${result.required}mm (currently ${result.actual}mm).`;
    }
    aiList.appendChild(li);
  });
}

function getRemedyMessage() {
  if (!flue) {
    return "";
  }

  if (!measurementResults || measurementResults.length === 0) {
    return "Mark nearby features to calculate clearances.";
  }

  let worst = null;
  measurementResults.forEach(result => {
    if (result.pass) return;
    const deficit = result.required - result.actualMm;
    if (!worst || deficit > worst.deficit) {
      worst = { result, deficit };
    }
  });

  if (worst) {
    const shortfall = Math.max(0, Math.ceil(worst.deficit));
    const label = worst.result.label || formatObjectLabel(worst.result.kind);
    return `Move flue at least ${shortfall}mm away from ${label} or fit plume kit.`;
  }

  return "All clearances satisfied for fan-assisted flue.";
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

  if (roughBrushMode) {
    evt.preventDefault();
    roughActivePointerId = evt.pointerId;
    roughStrokes.push(pos);
    draw();
    return;
  }

  if (flue) {
    const halfHandle = HANDLE_SIZE / 2;
    if (
      pos.x >= flue.x + flue.rx - halfHandle &&
      pos.x <= flue.x + flue.rx + halfHandle &&
      pos.y >= flue.y - halfHandle &&
      pos.y <= flue.y + halfHandle
    ) {
      evt.preventDefault();
      draggingFlueW = true;
      return;
    }

    if (
      pos.x >= flue.x - halfHandle &&
      pos.x <= flue.x + halfHandle &&
      pos.y >= flue.y + flue.ry - halfHandle &&
      pos.y <= flue.y + flue.ry + halfHandle
    ) {
      evt.preventDefault();
      draggingFlueH = true;
      return;
    }

    const dx = pos.x - flue.x;
    const dy = pos.y - flue.y;
    const norm = (dx * dx) / (flue.rx * flue.rx) + (dy * dy) / (flue.ry * flue.ry);
    if (norm <= 1) {
      evt.preventDefault();
      draggingFlue = true;
      return;
    }
  }

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
  if (roughBrushMode && roughActivePointerId === evt.pointerId) {
    evt.preventDefault();
    roughStrokes.push(pos);
    draw();
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
    flue.rx = Math.max(20, Math.abs(pos.x - flue.x));
    evaluateAndRender();
    return;
  }
  if (draggingFlueH && flue) {
    evt.preventDefault();
    flue.ry = Math.max(20, Math.abs(pos.y - flue.y));
    evaluateAndRender();
    return;
  }
  if (draggingCorner) {
    evt.preventDefault();
    const shape = paintedObjects[draggingCorner.shapeIndex];
    if (shape && shape.points && shape.points[draggingCorner.pointIndex]) {
      shape.points[draggingCorner.pointIndex] = pos;
      evaluateAndRender();
    }
    return;
  }
});

canvas.addEventListener("pointerup", evt => {
  activePointers.delete(evt.pointerId);
  if (activePointers.size < 2) {
    lastPinchDist = null;
    lastPinchMid = null;
  }
  if (roughActivePointerId === evt.pointerId) {
    roughActivePointerId = null;
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
  if (roughActivePointerId === evt.pointerId) {
    roughActivePointerId = null;
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
    case "window-opening":
      return { label: "window opening", mm: currentRules.windowOpening };
    case "window-fabric":
      return { label: "window fabric", mm: currentRules.windowFabric };
    case "gutter":
      return { label: "gutter/pipe", mm: currentRules.gutter };
    case "eaves":
      return { label: "eaves / soffit", mm: currentRules.eaves };
    case "boundary":
      return { label: "facing surface/boundary", mm: currentRules.boundary };
    default:
      return { label: "opening", mm: currentRules.windowOpening };
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
  measurementResults = [];
  distanceAnnotations = [];
  safetyZones = [];

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
      actualMm: distMm,
      pass: distMm >= rule.mm,
      closestPoint
    };

    measurementResults.push(evaluation);
    shape._evaluation = evaluation;

    safetyZones.push({
      type: "circle",
      cx: flue.x,
      cy: flue.y,
      r: rule.mm * pxPerMm,
      color: evaluation.pass ? "rgba(0,200,0,0.06)" : "rgba(255,0,0,0.13)",
      label: `${rule.label} ${evaluation.pass ? "PASS" : "FAIL"}`
    });
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
        <td class="status ${result.pass ? "pass" : "fail"}">${result.pass ? "✔" : "✖"}</td>
      `;
      resultsBody.appendChild(tr);
    });
  }

  draw();
  renderPreviews(pxPerMm);
  renderSuggestions();
  setAIStatus(getRemedyMessage());
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

function findVerticalObstructionBetween(x0, y0) {
  for (const shape of paintedObjects) {
    if (shape.kind !== "gutter") continue;
    if (!shape.points || shape.points.length < 2) continue;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    shape.points.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    const w = maxX - minX;
    const h = maxY - minY;
    if (h > w * 2 && minX > x0 && y0 >= minY && y0 <= maxY) {
      return { minX, maxX, minY, maxY };
    }
  }
  return null;
}
function renderPreviews(pxPerMm) {
  optACTX.clearRect(0,0,optACanvas.width,optACanvas.height);
  optBCTX.clearRect(0,0,optBCanvas.width,optBCanvas.height);
  optCCTX.clearRect(0,0,optCCanvas.width,optCCanvas.height);
  optDCTX.clearRect(0,0,optDCanvas.width,optDCanvas.height);
  if (!bgImage || !flue) return;

  let currentMinMm = getGlobalMinMm(flue.x, flue.y, pxPerMm);
  if (!Number.isFinite(currentMinMm)) {
    currentMinMm = 0;
  }
  const candidate = findBetterX(flue.x, flue.y, pxPerMm, currentMinMm);
  const obstruction = findVerticalObstructionBetween(flue.x, flue.y);
  const hasScale = Number.isFinite(pxPerMm) && pxPerMm > 0;

  const metaA = drawScaled(optACTX, bgImage, optACanvas);
  const metaB = drawScaled(optBCTX, bgImage, optBCanvas);

  if (candidate) {
    const movedPrev = mapToPreview({ x: candidate.x, y: candidate.y }, metaA);
    optACTX.strokeStyle = "red";
    optACTX.lineWidth = 2;
    optACTX.beginPath();
    optACTX.ellipse(movedPrev.x, movedPrev.y, flue.rx*metaA.s, flue.ry*metaA.s, 0, 0, Math.PI*2);
    optACTX.stroke();
  } else {
    optACTX.fillStyle = "#c00";
    optACTX.font = "14px sans-serif";
    optACTX.fillText("No safe move found.", 10, 20);
  }

  if (candidate) {
    const fluePrevB = mapToPreview({ x: flue.x, y: flue.y }, metaB);
    const movedPrevB = mapToPreview({ x: candidate.x, y: candidate.y }, metaB);

    const plumePx = DEFAULT_PLUME_MM * pxPerMm * metaB.s;

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
    optBCTX.fillText("No safe plume route.", 10, 20);
  }

  if (obstruction) {
    if (hasScale) {
      const metaC = drawScaled(optCCTX, bgImage, optCCanvas);
      const fluePrevC = mapToPreview({ x: flue.x, y: flue.y }, metaC);

      optCCTX.strokeStyle = "black";
      optCCTX.lineWidth = 2;
      optCCTX.beginPath();
      optCCTX.ellipse(fluePrevC.x, fluePrevC.y, flue.rx*metaC.s, flue.ry*metaC.s, 0, 0, Math.PI*2);
      optCCTX.stroke();

      const horizontalClearMm = 150;
      const extensionTargetX = obstruction.maxX + horizontalClearMm * pxPerMm;
      const extensionEndPrev = mapToPreview({ x: extensionTargetX, y: flue.y }, metaC);

      optCCTX.strokeStyle = "orange";
      optCCTX.lineWidth = 10;
      optCCTX.lineCap = "round";
      optCCTX.beginPath();
      optCCTX.moveTo(fluePrevC.x, fluePrevC.y);
      optCCTX.lineTo(extensionEndPrev.x, extensionEndPrev.y);
      optCCTX.stroke();

      const plumeLenPx = 80;
      const plumeEndC = { x: extensionEndPrev.x + plumeLenPx, y: extensionEndPrev.y };

      optCCTX.strokeStyle = "blue";
      optCCTX.lineWidth = 12;
      optCCTX.lineCap = "round";
      optCCTX.beginPath();
      optCCTX.moveTo(extensionEndPrev.x, extensionEndPrev.y);
      optCCTX.lineTo(plumeEndC.x, plumeEndC.y);
      optCCTX.stroke();

      optCCTX.lineWidth = 2;
      optCCTX.strokeStyle = "black";
      optCCTX.beginPath();
      optCCTX.ellipse(plumeEndC.x, plumeEndC.y, flue.rx*metaC.s, flue.ry*metaC.s, 0, 0, Math.PI*2);
      optCCTX.stroke();

      optCCTX.fillStyle = "#000";
      optCCTX.font = "12px sans-serif";
      optCCTX.fillText("Extend past pipe, then plume", 10, 20);
    } else {
      optCCTX.fillStyle = "#999";
      optCCTX.font = "12px sans-serif";
      optCCTX.fillText("Size the flue to preview extensions.", 10, 20);
    }
  } else {
    optCCTX.fillStyle = "#999";
    optCCTX.font = "12px sans-serif";
    optCCTX.fillText("No obstruction → extension not needed.", 10, 20);
  }

  if (obstruction) {
    if (hasScale) {
      const riseMm = 300;
      const risePxWorld = riseMm * pxPerMm;
      const neckTopWorldY = flue.y - risePxWorld;
      const clearanceMarginPx = 10;
      const hasVerticalClearance = neckTopWorldY < obstruction.minY - clearanceMarginPx;

      if (hasVerticalClearance) {
        const metaD = drawScaled(optDCTX, bgImage, optDCanvas);
        const fluePrevD = mapToPreview({ x: flue.x, y: flue.y }, metaD);

        optDCTX.strokeStyle = "black";
        optDCTX.lineWidth = 2;
        optDCTX.beginPath();
        optDCTX.ellipse(fluePrevD.x, fluePrevD.y, flue.rx*metaD.s, flue.ry*metaD.s, 0, 0, Math.PI*2);
        optDCTX.stroke();

        const risePx = riseMm * pxPerMm * metaD.s;
        const neckTop = { x: fluePrevD.x, y: fluePrevD.y - risePx };

        optDCTX.strokeStyle = "orange";
        optDCTX.lineWidth = 10;
        optDCTX.lineCap = "round";
        optDCTX.beginPath();
        optDCTX.moveTo(fluePrevD.x, fluePrevD.y);
        optDCTX.lineTo(neckTop.x, neckTop.y);
        optDCTX.stroke();

        const horizontalClearMm = 150;
        const horizPx = horizontalClearMm * pxPerMm * metaD.s;
        const neckEnd = { x: neckTop.x + horizPx, y: neckTop.y };

        optDCTX.strokeStyle = "orange";
        optDCTX.lineWidth = 10;
        optDCTX.lineCap = "round";
        optDCTX.beginPath();
        optDCTX.moveTo(neckTop.x, neckTop.y);
        optDCTX.lineTo(neckEnd.x, neckEnd.y);
        optDCTX.stroke();

        const plumeLenPx = 80;
        const plumeEnd = { x: neckEnd.x + plumeLenPx, y: neckEnd.y };

        optDCTX.strokeStyle = "blue";
        optDCTX.lineWidth = 12;
        optDCTX.lineCap = "round";
        optDCTX.beginPath();
        optDCTX.moveTo(neckEnd.x, neckEnd.y);
        optDCTX.lineTo(plumeEnd.x, plumeEnd.y);
        optDCTX.stroke();

        optDCTX.lineWidth = 2;
        optDCTX.beginPath();
        optDCTX.ellipse(plumeEnd.x, plumeEnd.y, flue.rx*metaD.s, flue.ry*metaD.s, 0, 0, Math.PI*2);
        optDCTX.stroke();

        optDCTX.fillStyle = "#000";
        optDCTX.font = "12px sans-serif";
        optDCTX.fillText("Swan neck above pipe, then plume", 10, 20);
      } else {
        optDCTX.fillStyle = "#999";
        optDCTX.font = "12px sans-serif";
        optDCTX.fillText("Obstruction too tall for swan neck.", 10, 20);
      }
    } else {
      optDCTX.fillStyle = "#999";
      optDCTX.font = "12px sans-serif";
      optDCTX.fillText("Size the flue to preview swan neck.", 10, 20);
    }
  } else {
    optDCTX.fillStyle = "#999";
    optDCTX.font = "12px sans-serif";
    optDCTX.fillText("No vertical obstruction → swan neck not needed.", 10, 20);
  }
}
function getGlobalMinMm(x, y, pxPerMm) {
  let minMm = Infinity;
  paintedObjects.forEach(shape => {
    if (!shape.points || shape.points.length < 2) return;
    let minPx = Infinity;
    for (let i = 0; i < shape.points.length; i++) {
      const a = shape.points[i];
      const b = shape.points[(i + 1) % shape.points.length];
      const d = pointToSegmentDist(x, y, a.x, a.y, b.x, b.y);
      if (d < minPx) minPx = d;
    }
    const mm = minPx / pxPerMm;
    if (mm < minMm) minMm = mm;
  });
  return minMm;
}

function findBetterX(startX, y, pxPerMm, currentMinMm) {
  const maxSearchPx = canvas.width;
  const stepPx = 5;
  for (let offset = stepPx; offset < maxSearchPx; offset += stepPx) {
    const candX = startX + offset;
    const candMinMm = getGlobalMinMm(candX, y, pxPerMm);
    if (candMinMm > currentMinMm && positionSatisfiesAll(candX, y, pxPerMm)) {
      return { x: candX, y };
    }
  }
  return null;
}

function positionSatisfiesAll(x, y, pxPerMm) {
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

async function runAutoDetect() {
  if (!bgImage) {
    setAIStatus("Upload a wall photo before auto-detecting objects.", { isError: true });
    return;
  }

  roughStrokes = [];
  setRoughBrushMode(false);
  draw();

  const payload = buildAIPayload({ includeMarks: false });
  payload.mode = "detect-only";

  if (autoDetectBtn) {
    autoDetectBtn.disabled = true;
  }
  setAIStatus("Auto-detecting objects…");

  try {
    const result = await analyseImageWithAI(payload);
    const added = applyAiAreasToPaintedObjects(result?.areas, {
      replaceExisting: true,
      source: "ai-detect"
    });
    invalidateAIOverlays();
    evaluateAndRender();
    if (added > 0) {
      setAIStatus(`AI detected ${added} object${added === 1 ? "" : "s"}.`);
    } else {
      setAIStatus("AI didn't detect any objects automatically.");
    }
  } catch (err) {
    console.error("Auto-detect failed", err);
    const message = err && err.message ? err.message : "Auto-detect failed.";
    setAIStatus(message, { isError: true });
  } finally {
    if (autoDetectBtn) {
      autoDetectBtn.disabled = false;
    }
  }
}

async function runRoughBrushCleanup() {
  if (!bgImage) {
    setRoughBrushMode(false);
    roughStrokes = [];
    draw();
    setAIStatus("Upload a wall photo before cleaning rough brush marks.", { isError: true });
    return;
  }

  if (roughStrokes.length < 2) {
    setRoughBrushMode(false);
    roughStrokes = [];
    draw();
    setAIStatus("Draw over the objects before asking AI to clean the rough brush.", { isError: true });
    return;
  }

  if (roughBrushBtn) {
    roughBrushBtn.disabled = true;
  }

  setAIStatus("Cleaning rough brush with AI…");

  try {
    const payload = buildAIPayload({ includeMarks: false });
    payload.mode = "rough-clean";
    payload.rough = roughStrokes.map(pt => ({ x: pt.x, y: pt.y }));

    const result = await analyseImageWithAI(payload);
    const added = applyAiAreasToPaintedObjects(result?.areas, {
      replaceExisting: true,
      source: "ai-rough"
    });

    roughStrokes = [];
    setRoughBrushMode(false);
    invalidateAIOverlays();
    evaluateAndRender();

    if (added > 0) {
      setAIStatus(`AI cleaned ${added} object${added === 1 ? "" : "s"} from your brush strokes.`);
    } else {
      setAIStatus("AI couldn't interpret those brush strokes.", { isError: true });
    }
  } catch (err) {
    console.error("Rough brush cleanup failed", err);
    setRoughBrushMode(false);
    roughStrokes = [];
    const message = err && err.message ? err.message : "Rough brush clean failed.";
    setAIStatus(message, { isError: true });
  } finally {
    if (roughBrushBtn) {
      roughBrushBtn.disabled = false;
    }
    draw();
  }
}

function buildAIPayload({ includeMarks = true } = {}) {
  const payload = {
    image: canvas.toDataURL("image/png"),
    manufacturer: currentManufacturerKey,
    boilerType: boilerTypeSelect ? boilerTypeSelect.value : "fan",
    clearances: { ...currentRules },
    rules: { ...currentRules }
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

  if (roughStrokes.length > 0) {
    payload.rough = roughStrokes.map(pt => ({ x: pt.x, y: pt.y }));
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
        const remedy = getRemedyMessage();
        const base = "AI found no extra zones, but local check FAILED.";
        setAIStatus(remedy ? `${base} ${remedy}` : base, { isError: true });
      } else {
        const msg = includeMarks
          ? "AI didn't find additional risks with your marks."
          : "AI auto zones found no concerns.";
        const remedy = getRemedyMessage();
        const combined = remedy ? `${msg} ${remedy}` : msg;
        setAIStatus(combined.trim());
      }
    } else {
      const plural = aiOverlays.length === 1 ? "area" : "areas";
      const suffix = includeMarks ? " using your marks" : " automatically";
      const msg = `AI highlighted ${aiOverlays.length} ${plural}${suffix}.`;
      const remedy = getRemedyMessage();
      const combined = remedy ? `${msg} ${remedy}` : msg;
      setAIStatus(combined.trim());
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
        zone: area.zone || "alert",
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

