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

canvas.style.touchAction = "none"; // for iOS

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
let currentTool = "window";
let bgImage = null;

const HANDLE_SIZE = 14;
// painted objects are 2-point lines: {kind, p1:{x,y}, p2:{x,y|null}}
let paintedObjects = [];
let activeLine = null;
let draggingHandle = null;

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
    currentTool = btn.dataset.tool;
    document.querySelectorAll("#tools button[data-tool]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    // switching tool cancels unfinished line
    if (activeLine && !activeLine.p2) {
      paintedObjects.pop();
    }
    activeLine = null;
  });
});

// undo
undoBtn.addEventListener("click", () => {
  if (activeLine && !activeLine.p2) {
    activeLine = null;
    paintedObjects.pop();
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
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.style.width = img.width + "px";
    canvas.style.height = img.height + "px";
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

function hitHandle(pos, obj) {
  const half = HANDLE_SIZE / 2;
  const within = (target) => Math.abs(pos.x - target.x) <= half && Math.abs(pos.y - target.y) <= half;
  if (within(obj.p1)) return "p1";
  if (obj.p2 && within(obj.p2)) return "p2";
  return null;
}

function snapToHandlePos(pos) {
  for (let i = paintedObjects.length - 1; i >= 0; i--) {
    const obj = paintedObjects[i];
    const which = hitHandle(pos, obj);
    if (which) {
      const target = obj[which];
      return { x: target.x, y: target.y };
    }
  }
  return pos;
}

// ==== DRAW ====
function draw() {
  ctx.save();
  ctx.setTransform(viewScale, 0, 0, viewScale, viewOffsetX, viewOffsetY);
  ctx.clearRect(-viewOffsetX / viewScale, -viewOffsetY / viewScale,
                canvas.width / viewScale, canvas.height / viewScale);
  if (bgImage) ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);

  // painted 2-point lines and handles
  paintedObjects.forEach(obj => {
    const colour = colourForKind(obj.kind);
    if (obj.p2) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(obj.p1.x, obj.p1.y);
      ctx.lineTo(obj.p2.x, obj.p2.y);
      ctx.stroke();
    }

    ctx.fillStyle = "#fff";
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(obj.p1.x - HANDLE_SIZE/2, obj.p1.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fill();
    ctx.stroke();
    if (obj.p2) {
      ctx.beginPath();
      ctx.rect(obj.p2.x - HANDLE_SIZE/2, obj.p2.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.fill();
      ctx.stroke();
    }
  });

  if (activeLine && !activeLine.p2 && !paintedObjects.includes(activeLine)) {
    const colour = colourForKind(activeLine.kind);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(activeLine.p1.x - HANDLE_SIZE/2, activeLine.p1.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fill();
    ctx.stroke();
  }

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

  ctx.restore();

  updateDownloadButtons();
}

function colourForKind(kind) {
  switch (kind) {
    case "window": return "#0088ff";
    case "door": return "#0055aa";
    case "eaves": return "#ff9900";
    case "gutter": return "#00aa44";
    case "downpipe": return "#aa33aa";
    case "boundary": return "#2d3436";
    default: return "#ff6b81";
  }
}

// ==== POINTER EVENTS ====
canvas.addEventListener("pointerdown", evt => {
  evt.preventDefault();
  const rect = canvas.getBoundingClientRect();
  activePointers.set(evt.pointerId, {
    x: evt.clientX - rect.left,
    y: evt.clientY - rect.top
  });

  if (activePointers.size === 2) {
    draggingFlue = false;
    draggingFlueW = false;
    draggingFlueH = false;
    lastPinchDist = getPinchDistance();
    lastPinchMid = getPinchMidpoint();
    return;
  }

  const pos = getCanvasPos(evt);

  // try to grab existing line handle
  for (let i = paintedObjects.length - 1; i >= 0; i--) {
    const obj = paintedObjects[i];
    const which = hitHandle(pos, obj);
    if (which) {
      draggingHandle = { objIndex: i, which };
      return;
    }
  }

  // try flue first
  if (flue && hitFlueWidthHandle(pos)) {
    draggingFlueW = true;
    return;
  }
  if (flue && hitFlueHeightHandle(pos)) {
    draggingFlueH = true;
    return;
  }
  if (flue && hitFlueBody(pos)) {
    draggingFlue = true;
    return;
  }

  // placing new flue
  if (currentTool === "flue") {
    // if we already HAVE a flue, do nothing here
    // (you can move it by grabbing the middle, or resize by handles)
    if (!flue) {
      flue = { x: pos.x, y: pos.y, rx: 60, ry: 60 };
      evaluateAndRender();
    }
    return;
  }

  const snapped = snapToHandlePos(pos);

  if (!activeLine || activeLine.kind !== currentTool || activeLine.p2) {
    const newLine = {
      kind: currentTool,
      p1: { x: snapped.x, y: snapped.y },
      p2: null
    };
    paintedObjects.push(newLine);
    activeLine = newLine;
    draw();
    return;
  }

  activeLine.p2 = { x: snapped.x, y: snapped.y };
  activeLine = null;
  evaluateAndRender();
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
  if (draggingHandle) {
    const obj = paintedObjects[draggingHandle.objIndex];
    if (obj) {
      obj[draggingHandle.which] = { x: pos.x, y: pos.y };
      evaluateAndRender();
    }
    return;
  }
  if (draggingFlue && flue) {
    flue.x = pos.x;
    flue.y = pos.y;
    evaluateAndRender();
    return;
  }
  if (draggingFlueW && flue) {
    flue.rx = Math.max(10, Math.abs(pos.x - flue.x));
    evaluateAndRender();
    return;
  }
  if (draggingFlueH && flue) {
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
  draggingHandle = null;
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
  draggingHandle = null;
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

function ruleForKind(kind) {
  switch (kind) {
    case "window":
    case "door":
      return { label: "opening", mm: currentClearances.toOpening };
    case "eaves":
      return { label: "below eaves", mm: currentClearances.belowEaves };
    case "gutter":
    case "downpipe":
      return { label: "below gutter", mm: currentClearances.belowGutter };
    case "boundary":
      return { label: "boundary/surface", mm: currentClearances.toFacingSurface };
    default:
      return { label: "opening", mm: currentClearances.toOpening };
  }
}

function evaluateAndRender() {
  resultsBody.innerHTML = "";
  if (!flue) {
    draw();
    return;
  }

  // scale: use horizontal diameter = 100mm
  const fluePxDiameter = flue.rx * 2;
  const pxPerMm = fluePxDiameter / FLUE_MM;

  const rows = [];
  paintedObjects.forEach(obj => {
    if (!obj.p1 || !obj.p2) return;
    const distPx = pointToSegmentDist(flue.x, flue.y, obj.p1.x, obj.p1.y, obj.p2.x, obj.p2.y);
    const distMm = distPx / pxPerMm;
    const rule = ruleForKind(obj.kind);
    rows.push({
      object: obj.kind,
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
  paintedObjects.forEach(obj => {
    if (!obj.p1 || !obj.p2) return;
    const dPx = pointToSegmentDist(flue.x, flue.y, obj.p1.x, obj.p1.y, obj.p2.x, obj.p2.y);
    const dMm = dPx / pxPerMm;
    if (dMm < closestMm) closestMm = dMm;
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

// initial draw
draw();

