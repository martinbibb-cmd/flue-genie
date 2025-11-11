// ==== BASIC DATA (same rules for all makes for now) ====
const MANUFACTURER_RULES = {
  ideal: {
    label: "Ideal / common",
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
  // add worcester / vaillant / viessmann here if you like
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

canvas.style.touchAction = "none"; // for iOS

// ==== STATE ====
let currentManufacturerKey = "ideal";
let currentClearances = { ...MANUFACTURER_RULES[currentManufacturerKey].clearances };
let currentTool = "window";
let bgImage = null;

// painted objects are POLYLINES: {kind, points:[{x,y},...]}
let paintedObjects = [];
// currently-being-added polyline (not a separate array entry)
let activePolyline = null;

// flue is ELLIPSE
// { x, y, rx, ry }
let flue = null;
let draggingFlue = false;
let draggingFlueW = false;
let draggingFlueH = false;

const FLUE_MM = 100; // assume 100mm terminals
const HANDLE_SIZE = 16;

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
    // switching tool ends current polyline
    activePolyline = null;
  });
});

// undo
undoBtn.addEventListener("click", () => {
  if (activePolyline) {
    activePolyline = null;
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
    draw();
  };
  img.src = URL.createObjectURL(file);
});

// ==== POINTER HELPERS ====
function getCanvasPos(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY
  };
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

// ==== DRAW ====
function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (bgImage) ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);

  // painted polylines
  paintedObjects.forEach(obj => {
    ctx.strokeStyle = colourForKind(obj.kind);
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    obj.points.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
  });

  // active polyline (not yet pushed)
  if (activePolyline) {
    ctx.strokeStyle = colourForKind(activePolyline.kind);
    ctx.lineWidth = 6;
    ctx.beginPath();
    activePolyline.points.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
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
  const pos = getCanvasPos(evt);

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
    flue = { x: pos.x, y: pos.y, rx: 60, ry: 60 };
    evaluateAndRender();
    return;
  }

  // polylines: every tap adds a vertex
  if (!activePolyline || activePolyline.kind !== currentTool) {
    // start new line and push it immediately so undo works
    activePolyline = { kind: currentTool, points: [] };
    paintedObjects.push(activePolyline);
  }
  activePolyline.points.push(pos);
  draw();
});

canvas.addEventListener("pointermove", evt => {
  const pos = getCanvasPos(evt);
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

canvas.addEventListener("pointerup", () => {
  draggingFlue = false;
  draggingFlueW = false;
  draggingFlueH = false;
});

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

function distanceEllipseCenterToPolyline(ellipse, poly) {
  const c = { x: ellipse.x, y: ellipse.y };
  let min = Infinity;
  for (let i = 0; i < poly.points.length - 1; i++) {
    const a = poly.points[i];
    const b = poly.points[i+1];
    const d = pointToSegmentDist(c.x, c.y, a.x, a.y, b.x, b.y);
    if (d < min) min = d;
  }
  return min;
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
    if (!obj.points || obj.points.length < 2) return;
    const distPx = distanceEllipseCenterToPolyline(flue, obj);
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
      <td>${r.required}</td>
      <td>${r.actual}</td>
      <td class="${r.pass ? "pass" : "fail"}">${r.pass ? "✔" : "✖"}</td>
    `;
    resultsBody.appendChild(tr);
  });

  draw();
  renderPreviews(pxPerMm);
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
    if (!obj.points || obj.points.length < 2) return;
    const dPx = distanceEllipseCenterToPolyline(flue, obj);
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

