// ==== BASIC DATA (all the usual suspects) ====
const MANUFACTURERS = [
  { value: "worcester", label: "Worcester" },
  { value: "vaillant", label: "Vaillant / ecoTEC" },
  { value: "ideal", label: "Ideal Logic+" },
  { value: "viessmann", label: "Viessmann (BS 5440 set)" }
];

const FAN_RULES = {
  "window-opening": { label: "Window opening", mm: 300, zone: "red" },
  "window-fabric": { label: "Window fabric", mm: 150, zone: "red" },
  gutter: { label: "Gutter / pipe", mm: 75, zone: "red" },
  eaves: { label: "Eaves / soffit", mm: 200, zone: "red" },
  boundary: { label: "Facing surface", mm: 600, zone: "red" }
};

const RULE_SETS = {
  fan: {
    windowOpening: FAN_RULES["window-opening"].mm,
    windowFabric: FAN_RULES["window-fabric"].mm,
    eaves: FAN_RULES.eaves.mm,
    gutter: FAN_RULES.gutter.mm,
    boundary: FAN_RULES.boundary.mm
  }
};

let pxPerMm = 1; // default, will be recalculated

function updateScaleFromFlue(flueShape) {
  const calibInput = document.getElementById("calibValue");
  const knownMM = calibInput ? Number(calibInput.value) || 100 : 100;

  if (!flueShape) return;

  let widthPx = null;
  if (typeof flueShape.width === "number") {
    widthPx = flueShape.width;
  } else if (typeof flueShape.rx === "number") {
    widthPx = flueShape.rx * 2;
  } else if (typeof flueShape.ry === "number") {
    widthPx = flueShape.ry * 2;
  }

  if (
    Number.isFinite(widthPx) &&
    widthPx > 0 &&
    Number.isFinite(knownMM) &&
    knownMM > 0
  ) {
    pxPerMm = widthPx / knownMM;
  }
}

// ==== DOM ====
const canvas = document.getElementById("sceneCanvas");
const ctx = canvas.getContext("2d");
const manufacturerSelect = document.getElementById("manufacturerSelect");
const resultsBody = document.querySelector("#resultsTable tbody");
const bgUpload = document.getElementById("bgUpload");
const undoBtn = document.getElementById("undoBtn");
const calibInput = document.getElementById("calibValue");
const optACanvas = document.getElementById("optA");
const optACTX = optACanvas.getContext("2d");
const optBCanvas = document.getElementById("optB");
const optBCTX = optBCanvas.getContext("2d");
const optCCanvas = document.getElementById("optC");
const optCCTX = optCCanvas.getContext("2d");
const optDCanvas = document.getElementById("optD");
const optDCTX = optDCanvas.getContext("2d");
const boilerTypeSelect = document.getElementById("boilerType");
const aiAutoBtn = document.getElementById("aiAutoBtn");
const aiRefineBtn = document.getElementById("aiRefineBtn");
const aiStatus = document.getElementById("aiStatus");
const aiList = document.getElementById("aiList");
const legendEl = document.getElementById("legend");
const maskFlueBtn = document.getElementById("maskFlue");
const maskOpenBtn = document.getElementById("maskOpen");
const maskBoundBtn = document.getElementById("maskBound");
const maskOtherBtn = document.getElementById("maskOther");
const maskClearBtn = document.getElementById("maskClear");
const autoDetectBtn = document.getElementById("autoDetectBtn");
const roughBrushBtn = document.getElementById("roughBrushBtn");

const sceneCanvas = canvas;
const sceneCtx = ctx;

const maskCanvas = document.createElement("canvas");
const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });

const MASK_BRUSH_COLORS = {
  flue: "rgba(255, 77, 77, 0.95)",
  opening: "rgba(255, 216, 77, 0.95)",
  boundary: "rgba(77, 163, 255, 0.95)",
  other: "rgba(56, 210, 107, 0.95)"
};

const AI_KIND_COLORS = {
  flue: { stroke: "rgba(255, 77, 77, 0.9)", fill: "rgba(255, 77, 77, 0.18)" },
  "window-opening": { stroke: "rgba(255, 216, 77, 0.9)", fill: "rgba(255, 216, 77, 0.2)" },
  opening: { stroke: "rgba(255, 216, 77, 0.9)", fill: "rgba(255, 216, 77, 0.2)" },
  boundary: { stroke: "rgba(77, 163, 255, 0.9)", fill: "rgba(77, 163, 255, 0.2)" },
  other: { stroke: "rgba(56, 210, 107, 0.9)", fill: "rgba(56, 210, 107, 0.2)" }
};

const AI_KIND_TEXT_COLOURS = {
  flue: "#ff4d4d",
  "window-opening": "#ffd84d",
  opening: "#ffd84d",
  boundary: "#4da3ff",
  other: "#38d26b"
};

const MASK_BRUSH_BUTTONS = [
  { key: "flue", element: maskFlueBtn },
  { key: "opening", element: maskOpenBtn },
  { key: "boundary", element: maskBoundBtn },
  { key: "other", element: maskOtherBtn }
];

function deactivateMaskButtons() {
  MASK_BRUSH_BUTTONS.forEach(({ element }) => {
    if (element) {
      element.classList.remove("active");
    }
  });
}

function sizeMaskToScene() {
  maskCanvas.width = sceneCanvas.width;
  maskCanvas.height = sceneCanvas.height;
  maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
}

sizeMaskToScene();

const ROUGH_BRUSH_IDLE_LABEL = roughBrushBtn
  ? roughBrushBtn.textContent
  : "Rough paint → AI clean";

const AI_ENDPOINT = "https://flue-genie-ai.martinbibb.workers.dev";

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
let maskMode = "flue";
let maskPaintingEnabled = false;
let isPaintingMask = false;
let maskPointerId = null;
let lastMaskPt = null;

function resetAIStatus() {
  if (!aiStatus) return;
  aiStatus.textContent = "";
  aiStatus.classList.remove("error");
}

function setAIStatus(message, { isError = false } = {}) {
  if (!aiStatus) return;
  aiStatus.textContent = message || "";
  aiStatus.classList.toggle("error", !!message && isError);
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

function setMaskBrush(mode, button) {
  const togglingOff =
    maskPaintingEnabled && maskMode === mode && button && button.classList.contains("active");

  if (togglingOff) {
    maskPaintingEnabled = false;
    maskPointerId = null;
    lastMaskPt = null;
    deactivateMaskButtons();
    return;
  }

  maskMode = mode;
  maskPaintingEnabled = true;
  deactivateMaskButtons();
  MASK_BRUSH_BUTTONS.forEach(({ element, key }) => {
    if (element) {
      element.classList.toggle("active", maskPaintingEnabled && key === maskMode);
    }
  });
}

function rgbaForMask(mode) {
  return MASK_BRUSH_COLORS[mode] || "rgba(255,255,255,0.85)";
}

function drawMaskStroke(from, to) {
  if (!from || !to) return;
  maskCtx.strokeStyle = rgbaForMask(maskMode);
  maskCtx.lineWidth = 22;
  maskCtx.lineCap = "round";
  maskCtx.beginPath();
  maskCtx.moveTo(from.x, from.y);
  maskCtx.lineTo(to.x, to.y);
  maskCtx.stroke();
}

function currentToolIsMask() {
  return maskPaintingEnabled;
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

function filterAiAreas(areas, canvas, ctx) {
  if (!areas || !areas.length) return [];
  const MIN_SIZE = 20;
  const MERGE_DIST = 28;

  function box(area) {
    const pts = Array.isArray(area.points) ? area.points : [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    pts.forEach(p => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    return {
      minX,
      minY,
      maxX,
      maxY,
      w: maxX - minX,
      h: maxY - minY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2
    };
  }

  const filtered = areas
    .filter(area => {
      const b = box(area);
      return isFinite(b.w) && b.w >= MIN_SIZE && b.h >= MIN_SIZE;
    })
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  const final = [];
  filtered.forEach(area => {
    const ba = box(area);
    const ok = !final.some(existing => {
      const bf = box(existing);
      const dx = ba.cx - bf.cx;
      const dy = ba.cy - bf.cy;
      return Math.sqrt(dx * dx + dy * dy) < MERGE_DIST;
    });
    if (ok) {
      final.push(area);
    }
  });

  return final;
}

function mapAiLabelToKind(label = "") {
  const l = String(label || "").toLowerCase();
  if (l.includes("flue")) return "flue";
  if (l.includes("fabric")) return "window-fabric";
  if (l.includes("window")) return "window-opening";
  if (l.includes("soffit") || l.includes("eaves")) return "eaves";
  if (l.includes("gutter") || l.includes("pipe") || l.includes("downpipe")) return "gutter";
  if (l.includes("boundary") || l.includes("facing")) return "boundary";
  if (l.includes("other")) return "other";
  return null;
}

function buildOverlaysFromUserMarks() {
  return paintedObjects
    .map(shape => {
      if (!shape || !Array.isArray(shape.points) || shape.points.length === 0) {
        return null;
      }
      const rule = ruleForKind(shape.kind);
      return {
        type: "polygon",
        label: `From user: ${rule.label}`,
        zone: "no-go",
        points: shape.points.map(pt => ({ x: pt.x, y: pt.y })),
        confidence: 0
      };
    })
    .filter(Boolean);
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
    const kind = mapAiLabelToKind(area?.kind || area?.label || area?.zone);
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

function getSelectedFlueSizeMm() {
  const calibInput = document.getElementById("calibValue");
  if (calibInput) {
    const manual = Number(calibInput.value);
    if (Number.isFinite(manual) && manual > 0) {
      return manual;
    }
  }

  const explicit125 = document.getElementById("flueSize125");
  const explicit100 = document.getElementById("flueSize100");

  if (explicit125 && explicit125.classList.contains("active")) {
    return 125;
  }
  if (explicit100 && explicit100.classList.contains("active")) {
    return 100;
  }

  const activeToggle = document.querySelector("[data-flue-size].active");
  if (activeToggle) {
    const parsed = Number(activeToggle.getAttribute("data-flue-size"));
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return FLUE_MM;
}

function getPxPerMm() {
  if (!flue) return null;
  updateScaleFromFlue(flue);
  return Number.isFinite(pxPerMm) && pxPerMm > 0 ? pxPerMm : null;
}

function getFlueRadiusPx() {
  if (!flue) return 0;
  // radius in px = half of drawn diameter
  return Math.min(flue.rx, flue.ry);
}

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
    maskPaintingEnabled = false;
    maskPointerId = null;
    deactivateMaskButtons();
    document.querySelectorAll("#tools button[data-tool]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    draw();
  });
});

const initialToolBtn = document.querySelector(`#tools button[data-tool="${currentTool}"]`);
if (initialToolBtn) {
  initialToolBtn.classList.add("active");
}

MASK_BRUSH_BUTTONS.forEach(({ key, element }) => {
  if (element) {
    element.addEventListener("click", () => setMaskBrush(key, element));
  }
});
if (maskClearBtn) {
  maskClearBtn.addEventListener("click", () => {
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    deactivateMaskButtons();
    maskPaintingEnabled = false;
    maskPointerId = null;
    lastMaskPt = null;
    draw();
  });
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
    invalidateAIOverlays();
    evaluateAndRender();
  }
});

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

if (calibInput) {
  calibInput.addEventListener("input", () => {
    updateScaleFromFlue(flue);
    evaluateAndRender();
  });
}

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
    sizeMaskToScene();
    maskPaintingEnabled = false;
    maskPointerId = null;
    lastMaskPt = null;
    deactivateMaskButtons();
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

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = "12px sans-serif";
    ctx.fillText(zone.label, zone.cx + 6, zone.cy + 16);
  });

  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.drawImage(maskCanvas, 0, 0);
  ctx.restore();

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

    const colors = AI_KIND_COLORS[area.kind] || {
      stroke: "rgba(59, 130, 246, 0.85)",
      fill: "rgba(59, 130, 246, 0.18)"
    };

    ctx.save();
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 3;

    let anchor = null;
    let bounds = null;

    if ((area.type === "polygon" || area.type === "rect") && points.length) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = colors.fill;
      ctx.fill();
      points.forEach(pt => {
        if (!bounds) {
          bounds = { minX: pt.x, maxX: pt.x, minY: pt.y, maxY: pt.y };
        } else {
          bounds.minX = Math.min(bounds.minX, pt.x);
          bounds.maxX = Math.max(bounds.maxX, pt.x);
          bounds.minY = Math.min(bounds.minY, pt.y);
          bounds.maxY = Math.max(bounds.maxY, pt.y);
        }
      });
      if (bounds) {
        anchor = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
      }
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

    if (!anchor && points.length) {
      anchor = points[0];
    }

    if (anchor) {
      const confidence = Number.isFinite(area.confidence)
        ? ` (${Math.round(area.confidence * 100)}%)`
        : "";
      const labelText = `#${idx + 1} ${area.label || area.kind || "AI area"}${confidence}`;
      ctx.font = "12px sans-serif";
      const textWidth = ctx.measureText(labelText).width + 8;
      const x = anchor.x + 6;
      const y = anchor.y - 18;
      ctx.fillStyle = "rgba(15,23,42,0.85)";
      ctx.fillRect(x, y, textWidth, 18);
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(labelText, x + 4, y + 13);
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

function renderLegendFromAI(areas) {
  if (!legendEl) return;
  legendEl.innerHTML = "";
  if (!areas || !areas.length) return;
  areas.forEach((area, i) => {
    const colour = AI_KIND_TEXT_COLOURS[area.kind] || "#64748b";
    const confidence = Number.isFinite(area?.confidence)
      ? ` (${Math.round(area.confidence * 100)}%)`
      : "";
    const div = document.createElement("div");
    div.innerHTML = `<strong style="color:${colour}">#${i + 1}</strong> ${
      area.label || area.kind || "object"
    }${confidence}`;
    legendEl.appendChild(div);
  });
}

function renderLegend() {
  renderLegendFromAI(aiOverlays);
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
    const actualText =
      Number.isFinite(result.actual) && result.actual != null
        ? `${result.actual}mm`
        : "–";
    if (result.pass) {
      li.textContent = `${result.label} OK – ${actualText} clear ≥ ${result.required}mm required.`;
    } else {
      li.textContent = `${result.label}: move to ≥${result.required}mm clear (currently ${actualText} clear).`;
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
    const deficit = Number.isFinite(result.actualMm)
      ? result.required - result.actualMm
      : result.required;
    if (!worst || deficit > worst.deficit) {
      worst = { result, deficit };
    }
  });

  if (worst) {
    const shortfall = Math.max(0, Math.ceil(worst.deficit));
    const label = worst.result.label || formatObjectLabel(worst.result.kind);
    return `Move flue at least ${shortfall}mm clear of ${label} or fit plume kit.`;
  }

  return "All edge clearances satisfied for fan-assisted flue.";
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

  if (currentToolIsMask()) {
    evt.preventDefault();
    isPaintingMask = true;
    maskPointerId = evt.pointerId;
    lastMaskPt = pos;
    drawMaskStroke(pos, pos);
    draw();
    return;
  }

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
  if (isPaintingMask && maskPointerId === evt.pointerId && currentToolIsMask()) {
    evt.preventDefault();
    drawMaskStroke(lastMaskPt || pos, pos);
    lastMaskPt = pos;
    draw();
    return;
  }
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
  if (maskPointerId === evt.pointerId) {
    isPaintingMask = false;
    maskPointerId = null;
    lastMaskPt = null;
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
  if (maskPointerId === evt.pointerId) {
    isPaintingMask = false;
    maskPointerId = null;
    lastMaskPt = null;
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
  if (FAN_RULES[kind]) {
    return FAN_RULES[kind];
  }
  return { label: "Opening", mm: FAN_RULES["window-opening"].mm };
}

function formatObjectLabel(kind) {
  if (!kind) return "";
  if (KIND_LABELS[kind]) return KIND_LABELS[kind];
  return kind
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, chr => chr.toUpperCase());
}

function labelForKind(kind) {
  if (KIND_LABELS[kind]) {
    return KIND_LABELS[kind];
  }
  return formatObjectLabel(kind);
}

function ruleNameForKind(kind) {
  const rule = FAN_RULES[kind];
  if (rule && rule.label) {
    return rule.label;
  }
  return formatObjectLabel(kind);
}

function requiredForKind(kind, rules) {
  if (!rules) return 300;
  switch (kind) {
    case "window-opening":
      return rules.windowOpening;
    case "window-fabric":
      return rules.windowFabric;
    case "gutter":
      return rules.gutter;
    case "eaves":
      return rules.eaves;
    case "boundary":
      return rules.boundary;
    default:
      return rules.windowOpening ?? 300;
  }
}

function distanceFromFlueToShape(flueShape, shape) {
  if (!flueShape || !shape || !Array.isArray(shape.points) || shape.points.length < 2) {
    return { distancePx: null, closestPoint: null };
  }

  let minPx = Infinity;
  let closestPoint = null;

  forEachShapeSegment(shape.points, (a, b) => {
    const distPx = pointToSegmentDist(flueShape.x, flueShape.y, a.x, a.y, b.x, b.y);
    if (distPx < minPx) {
      minPx = distPx;
      closestPoint = closestPointOnSegment(flueShape.x, flueShape.y, a.x, a.y, b.x, b.y);
    }
  });

  if (!Number.isFinite(minPx)) {
    return { distancePx: null, closestPoint: null };
  }

  const radii = [];
  if (Number.isFinite(flueShape.rx) && flueShape.rx > 0) radii.push(flueShape.rx);
  if (Number.isFinite(flueShape.ry) && flueShape.ry > 0) radii.push(flueShape.ry);
  const radius = radii.length ? Math.min(...radii) : 0;
  const edgePx = Math.max(0, minPx - radius);

  return { distancePx: edgePx, closestPoint };
}

function renderResultsTable(rows, { emptyMessage } = {}) {
  if (!resultsBody) return;
  resultsBody.innerHTML = "";

  if (!rows || rows.length === 0) {
    const emptyRow = document.createElement("tr");
    emptyRow.className = "empty";
    emptyRow.innerHTML = `<td colspan="6">${emptyMessage || "Mark nearby objects to measure clearances."}</td>`;
    resultsBody.appendChild(emptyRow);
    return;
  }

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.className = row.ok ? "pass-row" : "fail-row";
    const actualCell =
      row.actualMM != null && Number.isFinite(row.actualMM)
        ? `${row.actualMM.toFixed(0)} mm`
        : "–";
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${row.object}</td>
      <td>${row.rule}</td>
      <td>${row.requiredMM} mm</td>
      <td>${actualCell}</td>
      <td>${row.ok ? "✅" : "❌"}</td>
    `;
    resultsBody.appendChild(tr);
  });
}

function recomputeClearancesAndRender() {
  if (!resultsBody) return;

  const rows = [];
  measurementResults = [];
  distanceAnnotations = [];
  safetyZones = [];

  if (!flue) {
    lastPxPerMm = null;
    renderResultsTable([], { emptyMessage: "Add a flue and marks to see clearances." });
    draw();
    renderSuggestions();
    return;
  }

  updateScaleFromFlue(flue);
  const activePxPerMm = Number.isFinite(pxPerMm) && pxPerMm > 0 ? pxPerMm : null;
  lastPxPerMm = activePxPerMm || null;

  const rules = currentRules || RULE_SETS.fan;

  paintedObjects.forEach(shape => {
    const pts = shape.points;
    if (!pts || pts.length < 2) {
      shape._evaluation = null;
      return;
    }

    const { distancePx, closestPoint } = distanceFromFlueToShape(flue, shape);
    if (distancePx == null) {
      shape._evaluation = null;
      return;
    }

    const required = requiredForKind(shape.kind, rules);
    const actualMM =
      activePxPerMm && Number.isFinite(distancePx) ? distancePx / activePxPerMm : null;
    const pass = actualMM != null ? actualMM >= required : false;
    const actualRounded = actualMM != null ? Math.round(actualMM) : null;

    const evaluation = {
      shape,
      kind: shape.kind,
      label: ruleNameForKind(shape.kind),
      required,
      actual: actualRounded,
      actualMm: actualMM,
      pass,
      closestPoint
    };

    measurementResults.push(evaluation);
    shape._evaluation = evaluation;

    if (activePxPerMm && Number.isFinite(required)) {
      safetyZones.push({
        type: "circle",
        cx: flue.x,
        cy: flue.y,
        r: required * activePxPerMm,
        color: pass ? "rgba(0,180,0,0.06)" : "rgba(255,0,0,0.12)",
        label: `${ruleNameForKind(shape.kind)} ${required}mm`
      });
    }

    const rowNumber = rows.length + 1;
    rows.push({
      object: labelForKind(shape.kind),
      rule: ruleNameForKind(shape.kind),
      requiredMM: required,
      actualMM,
      ok: pass
    });

    if (closestPoint) {
      const actualText = actualRounded != null ? `${actualRounded}mm` : "–";
      distanceAnnotations.push({
        x: closestPoint.x,
        y: closestPoint.y,
        text: `#${rowNumber}: ${actualText} / ${required}mm`,
        color: pass ? "rgba(34,197,94,0.9)" : "rgba(239,68,68,0.95)"
      });
    }
  });

  const windowFail = measurementResults.some(
    result => result.kind === "window-opening" && result.pass === false
  );
  const downpipeOrEavesFail = measurementResults.some(
    result => (result.kind === "gutter" || result.kind === "eaves") && result.pass === false
  );

  if (windowFail && !downpipeOrEavesFail && activePxPerMm) {
    safetyZones.push({
      type: "circle",
      cx: flue.x,
      cy: flue.y,
      r: 150 * activePxPerMm,
      color: "rgba(0,120,255,0.12)",
      label: "Plume outlet 150mm hint"
    });
  }

  if (rows.length === 0) {
    renderResultsTable([], { emptyMessage: "Mark nearby objects to measure clearances." });
  } else {
    renderResultsTable(rows);
  }

  draw();
  renderPreviews(activePxPerMm);
  renderSuggestions();
}

function evaluateAndRender() {
  recomputeClearancesAndRender();
  setAIStatus(getRemedyMessage());
}

function hasLocalFailures() {
  if (!flue) return false;
  const pxPerMm = getPxPerMm();
  if (!Number.isFinite(pxPerMm) || pxPerMm <= 0) return false;
  const flueRadiusPx = getFlueRadiusPx();
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
    const edgePx = Math.max(0, minPx - flueRadiusPx);
    const mm = edgePx / pxPerMm;
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
  if (!Number.isFinite(pxPerMm) || pxPerMm <= 0) return Infinity;
  const flueRadiusPx = getFlueRadiusPx();
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
    const edgePx = Math.max(0, minPx - flueRadiusPx);
    const mm = edgePx / pxPerMm;
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
  if (!Number.isFinite(pxPerMm) || pxPerMm <= 0) return false;
  const flueRadiusPx = getFlueRadiusPx();
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
    const edgePx = Math.max(0, minPx - flueRadiusPx);
    const mm = edgePx / pxPerMm;
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

  const payload = buildAiPayload({ includeMarks: false });
  payload.mode = "detect-only";

  if (autoDetectBtn) {
    autoDetectBtn.disabled = true;
  }
  setAIStatus("Auto-detecting objects…");

  try {
    const result = await analyseImageWithAI(payload);
    let areas = Array.isArray(result?.areas) ? result.areas : [];
    areas = filterAiAreas(areas, canvas, ctx);
    const added = applyAiAreasToPaintedObjects(areas, {
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
    const payload = buildAiPayload({ includeMarks: false });
    payload.mode = "rough-clean";
    payload.rough = roughStrokes.map(pt => ({ x: pt.x, y: pt.y }));

    const result = await analyseImageWithAI(payload);
    let areas = Array.isArray(result?.areas) ? result.areas : [];
    areas = filterAiAreas(areas, canvas, ctx);
    const added = applyAiAreasToPaintedObjects(areas, {
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

function buildAiPayload({ includeMarks = true } = {}) {
  const payload = {
    image: canvas.toDataURL("image/jpeg", 0.6),
    manufacturer: currentManufacturerKey,
    boilerType: boilerTypeSelect ? boilerTypeSelect.value : "fan",
    clearances: { ...currentRules },
    rules: { ...currentRules }
  };

  if (flue) {
    const flueSizeMm = getSelectedFlueSizeMm();
    payload.flue = {
      x: flue.x,
      y: flue.y,
      rx: flue.rx,
      ry: flue.ry,
      radiusPx: getFlueRadiusPx(),
      sizeMm: flueSizeMm
    };
  }

  if (includeMarks) {
    payload.shapes = paintedObjects.map(shape => ({
      kind: shape.kind,
      points: (shape.points || []).map(pt => ({ x: pt.x, y: pt.y }))
    }));
    payload.measurements = (measurementResults || []).map(res => ({
      kind: res.kind,
      requiredMm: res.required,
      actualMm: res.actualMm,
      pass: !!res.pass
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

function fallbackAreasFromMask() {
  if (!maskCanvas.width || !maskCanvas.height) {
    return [];
  }

  const classes = [
    { name: "flue", rgb: [255, 77, 77], kind: "flue" },
    { name: "opening", rgb: [255, 216, 77], kind: "window-opening" },
    { name: "boundary", rgb: [77, 163, 255], kind: "boundary" },
    { name: "other", rgb: [56, 210, 107], kind: "other" }
  ];

  const { width: W, height: H } = maskCanvas;
  if (W === 0 || H === 0) return [];

  let imageData;
  try {
    imageData = maskCtx.getImageData(0, 0, W, H);
  } catch (err) {
    console.warn("Unable to read mask image data", err);
    return [];
  }

  const data = imageData.data;

  function close(a, b) {
    return Math.abs(a - b) <= 30;
  }

  function match(index, rgb) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const a = data[index + 3];
    if (a < 80) return false;
    return close(r, rgb[0]) && close(g, rgb[1]) && close(b, rgb[2]);
  }

  const areas = [];

  classes.forEach(cls => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let hit = false;

    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        const i = (y * W + x) * 4;
        if (match(i, cls.rgb)) {
          hit = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (hit && maxX - minX > 12 && maxY - minY > 12) {
      areas.push({
        label: cls.name,
        kind: cls.kind,
        type: "rect",
        confidence: 0.2,
        points: [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY }
        ]
      });
    }
  });

  return areas;
}

function handleAiResult(result) {
  const hasError = Boolean(result?.error);
  let areas = Array.isArray(result?.areas) ? result.areas : [];
  if (areas.length) {
    areas = filterAiAreas(areas, sceneCanvas, sceneCtx);
  }

  if (!areas.length) {
    const fallback = fallbackAreasFromMask();
    if (fallback.length) {
      areas = fallback;
      if (aiStatus) {
        aiStatus.textContent = hasError
          ? "AI error – used painted mask fallback."
          : "AI returned nothing – using your painted mask.";
        aiStatus.classList.toggle("error", hasError);
      }
    } else if (aiStatus) {
      const errorText = hasError ? `AI error: ${JSON.stringify(result.error)}` : "AI returned nothing.";
      aiStatus.textContent = errorText;
      aiStatus.classList.toggle("error", hasError);
    }
  } else if (aiStatus) {
    aiStatus.textContent = `AI detected ${areas.length} object(s).`;
    aiStatus.classList.remove("error");
  }

  aiOverlays = areas;
  renderLegendFromAI(aiOverlays);
  draw();
}

async function runAiAuto() {
  if (!bgImage) {
    setAIStatus("Upload a wall photo before running the AI.", { isError: true });
    aiOverlays = [];
    renderLegendFromAI(aiOverlays);
    draw();
    return;
  }

  if (aiAutoBtn) {
    aiAutoBtn.disabled = true;
  }
  if (aiStatus) {
    aiStatus.textContent = "Contacting AI…";
    aiStatus.classList.remove("error");
  }

  try {
    const result = await analyseImageWithAI({ mode: "detect-only" });
    handleAiResult(result);
  } catch (err) {
    console.error("runAiAuto failed", err);
    if (aiStatus) {
      aiStatus.textContent = "AI error: " + (err && err.message ? err.message : "unknown error");
      aiStatus.classList.add("error");
    }
    aiOverlays = [];
    renderLegendFromAI(aiOverlays);
    draw();
  } finally {
    if (aiAutoBtn) {
      aiAutoBtn.disabled = false;
    }
  }
}

async function runAiRefine() {
  if (!bgImage) {
    setAIStatus("Upload a wall photo before running the AI.", { isError: true });
    aiOverlays = [];
    renderLegendFromAI(aiOverlays);
    draw();
    return;
  }

  if (aiRefineBtn) {
    aiRefineBtn.disabled = true;
  }
  if (aiStatus) {
    aiStatus.textContent = "Refining with AI…";
    aiStatus.classList.remove("error");
  }

  try {
    const result = await analyseImageWithAI({
      mode: "refine",
      marks: paintedObjects.map(shape => ({
        kind: shape.kind,
        points: Array.isArray(shape.points)
          ? shape.points.map(pt => ({ x: pt.x, y: pt.y }))
          : []
      })),
      measurements: typeof buildMeasurementRows === "function" ? buildMeasurementRows() : []
    });
    handleAiResult(result);
  } catch (err) {
    console.error("runAiRefine failed", err);
    if (aiStatus) {
      aiStatus.textContent = "AI error: " + (err && err.message ? err.message : "unknown error");
      aiStatus.classList.add("error");
    }
    aiOverlays = [];
    renderLegendFromAI(aiOverlays);
    draw();
  } finally {
    if (aiRefineBtn) {
      aiRefineBtn.disabled = false;
    }
  }
}

async function analyseImageWithAI(payload) {
  payload.image = sceneCanvas.toDataURL("image/jpeg", 0.6);
  payload.mask = maskCanvas.toDataURL("image/png");

  const res = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  let json;
  try {
    json = await res.json();
  } catch (err) {
    json = { error: "non-json response" };
  }

  return json;
}

// initial draw
renderSuggestions();
renderLegend();
draw();

if (typeof window !== "undefined") {
  window.runAiAuto = runAiAuto;
  window.runAiRefine = runAiRefine;
}

