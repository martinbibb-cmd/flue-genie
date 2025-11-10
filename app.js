import { MANUFACTURER_RULES } from "./data/manufacturerRules.js";

const canvas = document.getElementById("sceneCanvas");
const ctx = canvas.getContext("2d");
const manufacturerSelect = document.getElementById("manufacturerSelect");
const clearanceFields = document.getElementById("clearanceFields");
const resultsBody = document.querySelector("#resultsTable tbody");
const bgUpload = document.getElementById("bgUpload");
const suggestPlumeBtn = document.getElementById("suggestPlumeBtn");

const FLUE_RADIUS = 12;

let currentManufacturerKey = "ideal";
let currentClearances = MANUFACTURER_RULES[currentManufacturerKey].clearances;
let currentTool = "window";

let paintedObjects = [];
let fluePoint = null;
let isDraggingFlue = false;
let bgImage = null;

function getCanvasPos(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY
  };
}

function populateManufacturers() {
  Object.entries(MANUFACTURER_RULES).forEach(([key, val]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = val.label;
    manufacturerSelect.appendChild(opt);
  });
  manufacturerSelect.value = currentManufacturerKey;
}

function renderClearanceFields() {
  clearanceFields.innerHTML = "";
  Object.entries(currentClearances).forEach(([name, value]) => {
    const wrap = document.createElement("label");
    wrap.textContent = name;
    const input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.dataset.key = name;
    input.addEventListener("input", () => {
      currentClearances[name] = Number(input.value);
      if (fluePoint) evaluateAndRender();
    });
    wrap.appendChild(input);
    clearanceFields.appendChild(wrap);
  });
}

function setTool(toolName) {
  currentTool = toolName;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (bgImage) ctx.drawImage(bgImage, 0, 0);

  paintedObjects.forEach((obj) => {
    ctx.save();
    const colours = {
      window: "#0088ff",
      door: "#0055aa",
      eaves: "#ff9900",
      gutter: "#00aa44",
      downpipe: "#aa33aa",
      corner: "#777",
      boundary: "#999"
    };
    ctx.fillStyle = colours[obj.type] || "#333";
    ctx.globalAlpha = 0.4;
    ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colours[obj.type] || "#333";
    ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
    ctx.fillStyle = "#000";
    ctx.fillText(obj.type, obj.x + 4, obj.y + 12);
    ctx.restore();
  });

  if (fluePoint) {
    ctx.beginPath();
    ctx.arc(fluePoint.x, fluePoint.y, FLUE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "red";
    ctx.fill();
    ctx.strokeStyle = "black";
    ctx.stroke();
    ctx.fillStyle = "white";
    ctx.fillText("flue", fluePoint.x + FLUE_RADIUS + 4, fluePoint.y);
  }
}

function distancePointToRect(px, py, rect) {
  const dx = Math.max(rect.x - px, 0, px - (rect.x + rect.w));
  const dy = Math.max(rect.y - py, 0, py - (rect.y + rect.h));
  return Math.sqrt(dx * dx + dy * dy);
}

function ruleForObject(objType) {
  switch (objType) {
    case "window":
    case "door":
      return { label: "opening", mm: currentClearances.toOpening };
    case "eaves":
      return { label: "below eaves", mm: currentClearances.belowEaves };
    case "gutter":
    case "downpipe":
      return { label: "below gutter/pipe", mm: currentClearances.belowGutter };
    case "corner":
    case "boundary":
      return { label: "boundary/surface", mm: currentClearances.toFacingSurface };
    default:
      return { label: "opening", mm: currentClearances.toOpening };
  }
}

function evaluateAndRender(extraFlue = null) {
  const fp = extraFlue || fluePoint;
  if (!fp) {
    draw();
    return;
  }
  const rows = [];
  paintedObjects.forEach((obj) => {
    const distPx = distancePointToRect(fp.x, fp.y, obj);
    const rule = ruleForObject(obj.type);
    rows.push({
      object: obj.type,
      rule: rule.label,
      required: rule.mm,
      actual: Math.round(distPx),
      pass: distPx >= rule.mm
    });
  });
  resultsBody.innerHTML = "";
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    const columns = [
      { label: "Object", value: r.object },
      { label: "Rule", value: r.rule },
      { label: "Required", value: r.required },
      { label: "Actual", value: r.actual },
      {
        label: "OK?",
        value: r.pass ? "✔" : "✖",
        className: r.pass ? "pass" : "fail"
      }
    ];

    columns.forEach((col) => {
      const td = document.createElement("td");
      td.textContent = col.value;
      td.dataset.label = col.label;
      if (col.className) td.className = col.className;
      tr.appendChild(td);
    });
    resultsBody.appendChild(tr);
  });
  draw();
}

// canvas events
function onPointerDown(evt) {
  evt.preventDefault();
  const { x, y } = getCanvasPos(evt);

  if (fluePoint) {
    const d = Math.hypot(x - fluePoint.x, y - fluePoint.y);
    if (d <= FLUE_RADIUS + 4) {
      isDraggingFlue = true;
      if (canvas.setPointerCapture) {
        canvas.setPointerCapture(evt.pointerId);
      }
      return;
    }
  }

  if (currentTool === "flue") {
    fluePoint = { x, y };
    evaluateAndRender();
    return;
  }

  paintedObjects.push({
    id: Date.now(),
    type: currentTool,
    x,
    y,
    w: 80,
    h: 80
  });
  if (fluePoint) evaluateAndRender();
  else draw();
}

function onPointerMove(evt) {
  if (!isDraggingFlue) return;
  evt.preventDefault();
  const { x, y } = getCanvasPos(evt);
  fluePoint.x = x;
  fluePoint.y = y;
  evaluateAndRender();
}

function onPointerUp(evt) {
  if (!isDraggingFlue) return;
  evt.preventDefault();
  isDraggingFlue = false;
  if (canvas.hasPointerCapture && canvas.hasPointerCapture(evt.pointerId)) {
    canvas.releasePointerCapture(evt.pointerId);
  }
  evaluateAndRender();
}

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);

// tool buttons
document.querySelectorAll("#tools button").forEach((btn) => {
  btn.addEventListener("click", () => setTool(btn.dataset.tool));
});

// manufacturer change
manufacturerSelect.addEventListener("change", () => {
  currentManufacturerKey = manufacturerSelect.value;
  currentClearances = { ...MANUFACTURER_RULES[currentManufacturerKey].clearances };
  renderClearanceFields();
  if (fluePoint) evaluateAndRender();
});

// background image
bgUpload.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    bgImage = img;
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    draw();
  };
  img.src = URL.createObjectURL(file);
});

// plume suggestion
suggestPlumeBtn.addEventListener("click", () => {
  if (!fluePoint) return;
  // shove 100px to the right for plume demo
  const plumePoint = { x: fluePoint.x + 100, y: fluePoint.y };
  evaluateAndRender(plumePoint);
  // draw plume marker
  ctx.beginPath();
  ctx.arc(plumePoint.x, plumePoint.y, FLUE_RADIUS - 4, 0, Math.PI * 2);
  ctx.fillStyle = "purple";
  ctx.fill();
});

// init
populateManufacturers();
renderClearanceFields();
draw();
