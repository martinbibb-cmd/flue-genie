import { MANUFACTURER_RULES } from "./data/manufacturerRules.js";

const canvas = document.getElementById("sceneCanvas");
const ctx = canvas.getContext("2d");
const manufacturerSelect = document.getElementById("manufacturerSelect");
const clearanceFields = document.getElementById("clearanceFields");
const resultsBody = document.querySelector("#resultsTable tbody");
const bgUpload = document.getElementById("bgUpload");
const suggestPlumeBtn = document.getElementById("suggestPlumeBtn");

const FLUE_RADIUS = 12;
const FLUE_HANDLE_SIZE = 10;

let currentManufacturerKey = "ideal";
let currentClearances = {
  ...MANUFACTURER_RULES[currentManufacturerKey].clearances
};
let currentTool = "window";

let paintedObjects = [];
let flueRect = null;
let draggingFlue = false;
let draggingHandle = null;

let painting = false;
let currentPath = null;
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
      if (flueRect) evaluateAndRender();
    });
    wrap.appendChild(input);
    clearanceFields.appendChild(wrap);
  });
}

function setTool(toolName) {
  currentTool = toolName;
}

function colourForKind(kind) {
  const colours = {
    window: "#0088ff",
    door: "#0055aa",
    eaves: "#ff9900",
    gutter: "#00aa44",
    downpipe: "#aa33aa",
    corner: "#777",
    boundary: "#999"
  };
  return colours[kind] || "#333";
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (bgImage) ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);

  paintedObjects.forEach((obj) => {
    if (obj.path) {
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
    } else if (obj.rect) {
      ctx.save();
      ctx.fillStyle = colourForKind(obj.kind);
      ctx.globalAlpha = 0.25;
      ctx.fillRect(obj.rect.x, obj.rect.y, obj.rect.w, obj.rect.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colourForKind(obj.kind);
      ctx.strokeRect(obj.rect.x, obj.rect.y, obj.rect.w, obj.rect.h);
      ctx.restore();
    }
  });

  if (painting && currentPath && currentPath.points.length) {
    ctx.strokeStyle = colourForKind(currentPath.kind);
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    currentPath.points.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
  }

  if (flueRect) {
    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.strokeRect(flueRect.x, flueRect.y, flueRect.w, flueRect.h);

    const hs = FLUE_HANDLE_SIZE;
    const handles = getFlueHandles(flueRect);
    ctx.fillStyle = "white";
    ctx.strokeStyle = "red";
    handles.forEach((h) => {
      ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
      ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
    });
  }
}

function getFlueHandles(r) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return [
    { name: "tl", x: r.x, y: r.y },
    { name: "tr", x: r.x + r.w, y: r.y },
    { name: "bl", x: r.x, y: r.y + r.h },
    { name: "br", x: r.x + r.w, y: r.y + r.h },
    { name: "t", x: cx, y: r.y },
    { name: "b", x: cx, y: r.y + r.h },
    { name: "l", x: r.x, y: cy },
    { name: "r", x: r.x + r.w, y: cy }
  ];
}

function hitHandle(pos, r) {
  const hs = FLUE_HANDLE_SIZE;
  const handles = getFlueHandles(r);
  for (const h of handles) {
    if (
      pos.x >= h.x - hs / 2 &&
      pos.x <= h.x + hs / 2 &&
      pos.y >= h.y - hs / 2 &&
      pos.y <= h.y + hs / 2
    ) {
      return h.name;
    }
  }
  return null;
}

function distancePointToRect(px, py, rect) {
  const dx = Math.max(rect.x - px, 0, px - (rect.x + rect.w));
  const dy = Math.max(rect.y - py, 0, py - (rect.y + rect.h));
  return Math.sqrt(dx * dx + dy * dy);
}

function distancePointToPath(px, py, path) {
  if (path.length === 0) return Infinity;
  if (path.length === 1) {
    const pt = path[0];
    return Math.hypot(px - pt.x, py - pt.y);
  }
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const dist = distancePointToSegment(px, py, a, b);
    if (dist < min) min = dist;
  }
  return min;
}

function distancePointToSegment(px, py, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = px - a.x;
  const wy = py - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - a.x, py - a.y);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - b.x, py - b.y);
  const t = c1 / c2;
  const projX = a.x + t * vx;
  const projY = a.y + t * vy;
  return Math.hypot(px - projX, py - projY);
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

function flueCenter() {
  if (!flueRect) return null;
  return {
    x: flueRect.x + flueRect.w / 2,
    y: flueRect.y + flueRect.h / 2
  };
}

function evaluateAndRender(extraCenter = null) {
  const center = extraCenter || flueCenter();
  if (!center) {
    draw();
    return;
  }
  const rows = [];
  paintedObjects.forEach((obj) => {
    const rule = ruleForObject(obj.kind);
    const distPx = obj.path
      ? distancePointToPath(center.x, center.y, obj.path)
      : obj.rect
        ? distancePointToRect(center.x, center.y, obj.rect)
        : Infinity;
    rows.push({
      object: obj.kind,
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
  const pos = getCanvasPos(evt);

  if (flueRect) {
    const handle = hitHandle(pos, flueRect);
    if (handle) {
      draggingHandle = handle;
      return;
    }
    if (
      pos.x >= flueRect.x &&
      pos.x <= flueRect.x + flueRect.w &&
      pos.y >= flueRect.y &&
      pos.y <= flueRect.y + flueRect.h
    ) {
      draggingFlue = {
        offsetX: pos.x - flueRect.x,
        offsetY: pos.y - flueRect.y
      };
      return;
    }
  }

  if (currentTool === "flue") {
    const size = 120;
    flueRect = {
      x: pos.x - size / 2,
      y: pos.y - size / 2,
      w: size,
      h: size
    };
    evaluateAndRender();
    return;
  }

  painting = true;
  currentPath = {
    kind: currentTool,
    points: [pos]
  };
  draw();
}

function onPointerMove(evt) {
  const pos = getCanvasPos(evt);

  if (draggingHandle && flueRect) {
    resizeFlue(flueRect, draggingHandle, pos);
    evaluateAndRender();
    return;
  }

  if (draggingFlue && flueRect) {
    flueRect.x = pos.x - draggingFlue.offsetX;
    flueRect.y = pos.y - draggingFlue.offsetY;
    evaluateAndRender();
    return;
  }

  if (painting && currentPath) {
    currentPath.points.push(pos);
    draw();
  }
}

function onPointerUp() {
  if (painting && currentPath) {
    paintedObjects.push({ kind: currentPath.kind, path: currentPath.points });
    if (flueRect) evaluateAndRender();
    else draw();
  }
  painting = false;
  currentPath = null;
  draggingFlue = false;
  draggingHandle = null;
}

function resizeFlue(r, handleName, pos) {
  const minSize = 40;
  switch (handleName) {
    case "tl":
      r.w = r.x + r.w - pos.x;
      r.h = r.y + r.h - pos.y;
      r.x = pos.x;
      r.y = pos.y;
      break;
    case "tr":
      r.w = pos.x - r.x;
      r.h = r.y + r.h - pos.y;
      r.y = pos.y;
      break;
    case "bl":
      r.w = r.x + r.w - pos.x;
      r.h = pos.y - r.y;
      r.x = pos.x;
      break;
    case "br":
      r.w = pos.x - r.x;
      r.h = pos.y - r.y;
      break;
    case "t":
      r.h = r.y + r.h - pos.y;
      r.y = pos.y;
      break;
    case "b":
      r.h = pos.y - r.y;
      break;
    case "l":
      r.w = r.x + r.w - pos.x;
      r.x = pos.x;
      break;
    case "r":
      r.w = pos.x - r.x;
      break;
  }
  if (r.w < minSize) r.w = minSize;
  if (r.h < minSize) r.h = minSize;
}

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);
canvas.style.touchAction = "none";

// tool buttons
document.querySelectorAll("#tools button").forEach((btn) => {
  btn.addEventListener("click", () => setTool(btn.dataset.tool));
});

// manufacturer change
manufacturerSelect.addEventListener("change", () => {
  currentManufacturerKey = manufacturerSelect.value;
  currentClearances = { ...MANUFACTURER_RULES[currentManufacturerKey].clearances };
  renderClearanceFields();
  if (flueRect) evaluateAndRender();
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
  if (!flueRect) return;
  const center = flueCenter();
  const plumePoint = { x: center.x + 100, y: center.y };
  evaluateAndRender(plumePoint);
  ctx.beginPath();
  ctx.arc(plumePoint.x, plumePoint.y, FLUE_RADIUS - 4, 0, Math.PI * 2);
  ctx.fillStyle = "purple";
  ctx.fill();
});

// init
populateManufacturers();
renderClearanceFields();
draw();
