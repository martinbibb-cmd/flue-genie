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
  if (bgImage) ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);

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
}

// canvas events
canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // first: can we grab the flue?
  if (fluePoint) {
    const d = Math.hypot(x - fluePoint.x, y - fluePoint.y);
    if (d <= FLUE_RADIUS + 4) {
      isDraggingFlue = true;
      return;
    }
  }

  // otherwise: normal tool
  if (currentTool === "flue") {
    fluePoint = { x, y };
    evaluateAndRender();
  } else {
    paintedObjects.push({
      id: Date.now(),
      type: currentTool,
      x,
      y,
      w: 80,
      h: 80
    });
    // if we already have a flue, re-evaluate
    if (fluePoint) evaluateAndRender();
    else draw();
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (!isDraggingFlue) return;
  const rect = canvas.getBoundingClientRect();
  fluePoint.x = e.clientX - rect.left;
  fluePoint.y = e.clientY - rect.top;
  evaluateAndRender();
});

canvas.addEventListener("mouseup", () => {
  if (isDraggingFlue) {
    isDraggingFlue = false;
    evaluateAndRender();
  }
});

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
