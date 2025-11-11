import { MANUFACTURER_RULES } from "./data/manufacturerRules.js";

const canvas = document.getElementById("sceneCanvas");
const ctx = canvas.getContext("2d");
const manufacturerSelect = document.getElementById("manufacturerSelect");
const clearanceFields = document.getElementById("clearanceFields");
const resultsBody = document.querySelector("#resultsTable tbody");
const bgUpload = document.getElementById("bgUpload");
const plumeMmInput = document.getElementById("plumeMm");
const optACanvas = document.getElementById("optA");
const optACTX = optACanvas.getContext("2d");
const optBCanvas = document.getElementById("optB");
const optBCTX = optBCanvas.getContext("2d");
const flueSizeBtns = document.querySelectorAll("#flueSizeBtns button");

let currentManufacturerKey = "ideal";
let currentClearances = {
  ...MANUFACTURER_RULES[currentManufacturerKey].clearances
};

let currentTool = "window";
let bgImage = null;

let FLUE_MM = 100;

const FLUE_HANDLE_HALF = 14;

let paintedObjects = []; // {kind, path:[{x,y},...]}

let flue = null; // {x,y,r}
let draggingFlue = false;
let draggingFlueHandle = false;

function populateManufacturers() {
  Object.entries(MANUFACTURER_RULES).forEach(([key, val]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = val.label;
    manufacturerSelect.appendChild(opt);
  });
  manufacturerSelect.value = currentManufacturerKey;
}

function renderClearances() {
  clearanceFields.innerHTML = "";
  Object.entries(currentClearances).forEach(([name, value]) => {
    const label = document.createElement("label");
    label.textContent = name;
    const input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.style.width = "80px";
    input.addEventListener("input", () => {
      currentClearances[name] = Number(input.value);
      evaluateAndRender();
    });
    label.appendChild(input);
    clearanceFields.appendChild(label);
  });
}

function colourForKind(kind) {
  switch (kind) {
    case "window":
      return "#0088ff";
    case "door":
      return "#0055aa";
    case "eaves":
      return "#ff9900";
    case "gutter":
      return "#00aa44";
    case "downpipe":
      return "#aa33aa";
    case "boundary":
      return "#2d3436";
    default:
      return "#ff6b81";
  }
}

function setToolFromButtons() {
  document.querySelectorAll("#tools button").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentTool = btn.dataset.tool;
      document
        .querySelectorAll("#tools button")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
  const initialButton = document.querySelector(
    `#tools button[data-tool="${currentTool}"]`
  );
  if (initialButton) initialButton.classList.add("active");
}

function getCanvasPos(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY
  };
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (bgImage) ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);

  paintedObjects.forEach((obj) => {
    ctx.strokeStyle = colourForKind(obj.kind);
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    obj.path.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
  });

  if (flue) {
    ctx.beginPath();
    ctx.arc(flue.x, flue.y, flue.r, 0, Math.PI * 2);
    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.stroke();

    const hx = flue.x + flue.r;
    const hy = flue.y;
    ctx.fillStyle = "white";
    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(
      hx - FLUE_HANDLE_HALF,
      hy - FLUE_HANDLE_HALF,
      FLUE_HANDLE_HALF * 2,
      FLUE_HANDLE_HALF * 2
    );
    ctx.fill();
    ctx.stroke();
  }
}

function pointInFlue(pos) {
  if (!flue) return false;
  const d = Math.hypot(pos.x - flue.x, pos.y - flue.y);
  return d <= flue.r;
}

function onResizeHandle(pos) {
  if (!flue) return false;
  const hx = flue.x + flue.r;
  const hy = flue.y;
  return (
    pos.x >= hx - FLUE_HANDLE_HALF &&
    pos.x <= hx + FLUE_HANDLE_HALF &&
    pos.y >= hy - FLUE_HANDLE_HALF &&
    pos.y <= hy + FLUE_HANDLE_HALF
  );
}

let painting = false;
let currentPath = null;

canvas.addEventListener("pointerdown", (evt) => {
  evt.preventDefault();
  const pos = getCanvasPos(evt);

  if (flue && onResizeHandle(pos)) {
    draggingFlueHandle = true;
    return;
  }
  if (flue && pointInFlue(pos)) {
    draggingFlue = true;
    return;
  }

  if (currentTool === "flue") {
    flue = { x: pos.x, y: pos.y, r: 60 };
    evaluateAndRender();
    draw();
    return;
  }

  painting = true;
  currentPath = { kind: currentTool, path: [pos] };
  draw();
});

canvas.addEventListener("pointermove", (evt) => {
  const pos = getCanvasPos(evt);

  if (draggingFlue && flue) {
    flue.x = pos.x;
    flue.y = pos.y;
    evaluateAndRender();
    draw();
    return;
  }
  if (draggingFlueHandle && flue) {
    flue.r = Math.max(10, Math.hypot(pos.x - flue.x, pos.y - flue.y));
    evaluateAndRender();
    draw();
    return;
  }

  if (painting && currentPath) {
    currentPath.path.push(pos);
    draw();
  }
});

function endPointerInteraction() {
  if (painting && currentPath) {
    paintedObjects.push(currentPath);
  }
  painting = false;
  currentPath = null;
  draggingFlue = false;
  draggingFlueHandle = false;
  evaluateAndRender();
}

canvas.addEventListener("pointerup", endPointerInteraction);
canvas.addEventListener("pointercancel", endPointerInteraction);

bgUpload.addEventListener("change", (evt) => {
  const file = evt.target.files?.[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    bgImage = img;
    paintedObjects = [];
    flue = null;
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.style.width = `${img.width}px`;
    canvas.style.height = `${img.height}px`;
    draw();
    evaluateAndRender();
  };
  img.src = URL.createObjectURL(file);
});

manufacturerSelect.addEventListener("change", () => {
  currentManufacturerKey = manufacturerSelect.value;
  currentClearances = {
    ...MANUFACTURER_RULES[currentManufacturerKey].clearances
  };
  renderClearances();
  evaluateAndRender();
});

function distancePointToPath(p, path) {
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const d = pointToSegmentDist(p.x, p.y, a.x, a.y, b.x, b.y);
    if (d < min) min = d;
  }
  return min;
}

function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  const tt = Math.max(0, Math.min(1, t));
  const cx = x1 + tt * dx;
  const cy = y1 + tt * dy;
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
    renderPreviews(1);
    return;
  }

  const fluePxDiameter = flue.r * 2;
  const pxPerMm = fluePxDiameter / FLUE_MM;

  const rows = [];
  paintedObjects.forEach((obj) => {
    if (obj.path.length < 2) return;
    const distPx = distancePointToPath(flue, obj.path);
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

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.object}</td>
      <td>${row.rule}</td>
      <td>${row.required}</td>
      <td>${row.actual}</td>
      <td class="${row.pass ? "pass" : "fail"}">${row.pass ? "✔" : "✖"}</td>
    `;
    resultsBody.appendChild(tr);
  });

  draw();
  renderPreviews(pxPerMm);
}

function drawScaled(ctx2d, img, canv) {
  const iw = img.width;
  const ih = img.height;
  const cw = canv.width;
  const ch = canv.height;
  const s = Math.min(cw / iw, ch / ih);
  const w = iw * s;
  const h = ih * s;
  const ox = (cw - w) / 2;
  const oy = (ch - h) / 2;
  ctx2d.drawImage(img, ox, oy, w, h);
  return { s, ox, oy };
}

function mapToPreview(pt, img, canv, meta) {
  return {
    x: meta.ox + pt.x * meta.s,
    y: meta.oy + pt.y * meta.s
  };
}

function renderPreviews(pxPerMm) {
  optACTX.clearRect(0, 0, optACanvas.width, optACanvas.height);
  optBCTX.clearRect(0, 0, optBCanvas.width, optBCanvas.height);
  if (!bgImage || !flue) return;

  const metaA = drawScaled(optACTX, bgImage, optACanvas);
  const metaB = drawScaled(optBCTX, bgImage, optBCanvas);

  const req = 300;
  let closestMm = Infinity;
  paintedObjects.forEach((obj) => {
    if (obj.path.length < 2) return;
    const dPx = distancePointToPath(flue, obj.path);
    const dMm = dPx / pxPerMm;
    if (dMm < closestMm) closestMm = dMm;
  });
  if (closestMm === Infinity) closestMm = req;
  const deficitMm = Math.max(0, req - closestMm);

  const movePx = deficitMm * pxPerMm;
  const moved = { x: flue.x + movePx, y: flue.y };

  const fluePrev = mapToPreview(flue, bgImage, optACanvas, metaA);
  const movedPrev = mapToPreview(moved, bgImage, optACanvas, metaA);
  const rPrev = flue.r * metaA.s;

  optACTX.strokeStyle = "red";
  optACTX.lineWidth = 2;
  optACTX.beginPath();
  optACTX.arc(movedPrev.x, movedPrev.y, rPrev, 0, Math.PI * 2);
  optACTX.stroke();

  const fluePrevB = mapToPreview(flue, bgImage, optBCanvas, metaB);
  const movedPrevB = mapToPreview(moved, bgImage, optBCanvas, metaB);
  const plumeMmRaw = parseFloat(plumeMmInput.value);
  const plumeMm = Number.isFinite(plumeMmRaw) && plumeMmRaw > 0 ? plumeMmRaw : 60;
  const plumePx = plumeMm * pxPerMm * metaB.s;

  optBCTX.strokeStyle = "blue";
  optBCTX.lineWidth = 2;
  optBCTX.beginPath();
  optBCTX.arc(fluePrevB.x, fluePrevB.y, rPrev, 0, Math.PI * 2);
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
  optBCTX.arc(movedPrevB.x, movedPrevB.y, rPrev, 0, Math.PI * 2);
  optBCTX.stroke();
}

plumeMmInput.addEventListener("input", evaluateAndRender);

if (flueSizeBtns.length) {
  flueSizeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      flueSizeBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      FLUE_MM = Number(btn.dataset.flueMm) || 100;
      evaluateAndRender();
    });
  });
}

populateManufacturers();
renderClearances();
setToolFromButtons();
draw();
