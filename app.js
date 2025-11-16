// type Calibration = {
//   pxPerMm: number;
//   source: "calibrationSheet" | "plumbLine" | "mock";
//   sheetCornersPx: { tl: [number, number]; tr: [number, number]; br: [number, number]; bl: [number, number] };
//   homography: number[]; // 3x3 flattened
//   sheetWidthMm: number;
//   sheetHeightMm: number;
//   plumbTopPx?: [number, number];
//   plumbBottomPx?: [number, number];
//   plumbLengthMm?: number;
// };

// type BoilerChoice = {
//   modelId: string;
//   widthMm: number;
//   heightMm: number;
//   depthMm: number;
//   install: { top: number; bottom: number; left: number; right: number; front: number };
//   service: { top: number; front: number };
//   sheetDepthFromWallMm: number;
// };

// type BoilerObstacle = {
//   kind: "leftTall" | "rightTall" | "wallUnit" | "worktop" | "ceiling";
//   x: number;
//   y: number;
// };

// type FlueObstacle = {
//   kind: "window" | "downpipe" | "boundary" | "soffit";
//   x: number;
//   y: number;
// };

// type FlueMark = {
//   x: number;
//   y: number;
//   diameterMm: number;
// };

// type Job = {
//   image: string | null;
//   calibration: Calibration | null;
//   boiler: BoilerChoice | null;
//   boilerObstacles: BoilerObstacle[];
//   flue: FlueMark | null;
//   flueObstacles: FlueObstacle[];
// };

const job = {
  image: null,
  calibration: null,
  boiler: null,
  boilerObstacles: [],
  flue: null,
  flueObstacles: [],
};

// Global physical sheet config (mm between corner marker centres)
// Defaults assume printer is accurate A4, 210 × 297 mm.
const sheetConfig = {
  widthMm: 210,
  heightMm: 297,
};

// Global plumb-line config
const plumbConfig = {
  enabled: false,
  lengthMm: 400,
};

let boilerModels = [];
let flueOptions = [];
let boilerPlacement = null; // stored in image pixel space
let selectedFlueId = null;

const boilerObstacleKinds = [
  { kind: "leftTall", label: "Left tall unit", color: "#8e5b3a" },
  { kind: "rightTall", label: "Right tall unit", color: "#8e5b3a" },
  { kind: "wallUnit", label: "Wall unit above", color: "#e67e22" },
  { kind: "worktop", label: "Worktop/base units", color: "#f1c40f" },
  { kind: "ceiling", label: "Ceiling/bulkhead", color: "#9b59b6" },
];

const flueObstacleKinds = [
  { kind: "window", label: "Window / opening", color: "#e67e22" },
  { kind: "downpipe", label: "Downpipe", color: "#3498db" },
  { kind: "boundary", label: "Boundary/corner", color: "#2ecc71" },
  { kind: "soffit", label: "Soffit/eaves", color: "#9b59b6" },
];

const fallbackFlueOption = {
  flueId: "dummy",
  brand: "Generic",
  systemName: "Standard horizontal",
  terminalType: "horizontal",
  diameterMm: 100,
  rules: {
    minAboveWindowMm: 300,
    minBelowWindowMm: 300,
    minSideWindowMm: 300,
    minFromCornerMm: 300,
    minBelowSoffitMm: 300,
    minFromDownpipeMm: 300,
    minFromBoundaryMm: 300,
  },
};

const flueNumericFields = [
  "diameterMm",
  "minAboveWindowMm",
  "minBelowWindowMm",
  "minSideWindowMm",
  "minFromCornerMm",
  "minBelowSoffitMm",
  "minFromDownpipeMm",
  "minFromBoundaryMm",
];

const viewRoot = () => document.getElementById("view-root");

function resetJob() {
  job.image = null;
  job.calibration = null;
  job.boiler = null;
  job.boilerObstacles = [];
  job.flue = null;
  job.flueObstacles = [];
  boilerPlacement = null;
  selectedFlueId = null;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function recalcScaleFromPlumb() {
  if (!plumbConfig.enabled) return;
  const calibration = job.calibration;
  if (!calibration) return;
  const top = calibration.plumbTopPx;
  const bottom = calibration.plumbBottomPx;
  const lengthMm = calibration.plumbLengthMm || plumbConfig.lengthMm;
  if (!top || !bottom || !lengthMm) return;

  const dx = bottom[0] - top[0];
  const dy = bottom[1] - top[1];
  const distPx = Math.hypot(dx, dy);
  if (distPx <= 0) return;

  const pxPerMm = distPx / lengthMm;
  calibration.pxPerMm = pxPerMm;
  calibration.plumbLengthMm = lengthMm;
  calibration.source = "plumbLine";
}

function parseCSV(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split(",").map((v) => v.trim()));
  return { headers, rows };
}

async function loadBoilerModels() {
  try {
    const res = await fetch("data/boilers.csv", { cache: "no-store" });
    if (!res.ok) throw new Error("Boilers CSV not found");
    const text = await res.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length < 2) throw new Error("Boilers CSV empty");

    const parseCsvLine = (line) => {
      const result = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i += 1;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === "," && !inQuotes) {
          result.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const header = parseCsvLine(lines[0]);
    const idx = (name) => header.indexOf(name);

    const idIdx = idx("boiler_id");
    const brandIdx = idx("brand");
    const modelIdx = idx("model");
    const variantIdx = idx("variant");
    const typeIdx = idx("type");
    const widthIdx = idx("width_mm");
    const heightIdx = idx("height_mm");
    const depthIdx = idx("depth_mm");
    const aboveIdx = idx("above_mm");
    const belowIdx = idx("below_mm");
    const leftIdx = idx("left_mm");
    const rightIdx = idx("right_mm");
    const frontMinIdx = idx("front_min_mm");
    const frontPrefIdx = idx("front_preferred_mm");
    const sideServIdx = idx("service_side_mm");

    const requiredIndices = [
      idIdx,
      brandIdx,
      modelIdx,
      typeIdx,
      widthIdx,
      heightIdx,
      depthIdx,
      aboveIdx,
      leftIdx,
      rightIdx,
      frontMinIdx,
      frontPrefIdx,
    ];
    if (requiredIndices.some((value) => value === -1)) {
      throw new Error("Boilers CSV missing required columns");
    }

    const numberOrNull = (v) => {
      if (typeof v !== "string") return null;
      const trimmed = v.trim();
      if (!trimmed) return null;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    };

    boilerModels = lines
      .slice(1)
      .map((line) => {
        const cols = parseCsvLine(line);
        const widthMm = numberOrNull(cols[widthIdx]);
        const heightMm = numberOrNull(cols[heightIdx]);
        const depthMm = numberOrNull(cols[depthIdx]);
        const aboveMm = numberOrNull(cols[aboveIdx]);
        const belowMm = numberOrNull(cols[belowIdx]);
        const leftMm = numberOrNull(cols[leftIdx]);
        const rightMm = numberOrNull(cols[rightIdx]);
        const frontMinMm = numberOrNull(cols[frontMinIdx]);
        const frontPreferredMm = numberOrNull(cols[frontPrefIdx]);
        const serviceSideMm = numberOrNull(cols[sideServIdx]);

        const brand = (cols[brandIdx] || "").trim();
        const model = (cols[modelIdx] || "").trim();
        const variant = (cols[variantIdx] || "").trim();
        const type = (cols[typeIdx] || "").trim();

        const displayName = [
          brand,
          model,
          variant ? `(${variant})` : "",
          type ? `[${type}]` : "",
        ]
          .filter(Boolean)
          .join(" ");

        return {
          id: (cols[idIdx] || "").trim(),
          brand,
          model,
          variant,
          type,
          displayName,
          widthMm,
          heightMm,
          depthMm,
          clearances: {
            install: {
              top: aboveMm,
              bottom: belowMm,
              left: leftMm,
              right: rightMm,
              frontMin: frontMinMm,
              frontPreferred: frontPreferredMm,
            },
            service: {
              side: serviceSideMm,
            },
          },
        };
      })
      .filter((b) => b.id);

    if (!boilerModels.length) throw new Error("No valid boiler rows");
  } catch (err) {
    console.error("Failed to load boilers.csv, using fallback model:", err);

    boilerModels = [
      {
        id: "std_400x700x300",
        brand: "Generic",
        model: "Standard",
        variant: "Fallback",
        type: "combi",
        displayName: "Generic Standard 400×700×300 [combi]",
        widthMm: 400,
        heightMm: 700,
        depthMm: 300,
        clearances: {
          install: {
            top: 200,
            bottom: 150,
            left: 5,
            right: 5,
            frontMin: 450,
            frontPreferred: 600,
          },
          service: {
            side: 300,
          },
        },
      },
    ];
  }
}

async function loadFlueOptions() {
  try {
    const res = await fetch("/data/flues.csv", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const { headers, rows } = parseCSV(text);
    if (!rows.length || headers.length === 0) throw new Error("Empty CSV");
    flueOptions = rows.map((values) => {
      const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
      flueNumericFields.forEach((field) => {
        record[field] = toNumber(record[field]);
      });
      return {
        flueId: record.flueId,
        brand: record.brand,
        systemName: record.systemName,
        terminalType: record.terminalType,
        diameterMm: record.diameterMm,
        rules: {
          minAboveWindowMm: record.minAboveWindowMm,
          minBelowWindowMm: record.minBelowWindowMm,
          minSideWindowMm: record.minSideWindowMm,
          minFromCornerMm: record.minFromCornerMm,
          minBelowSoffitMm: record.minBelowSoffitMm,
          minFromDownpipeMm: record.minFromDownpipeMm,
          minFromBoundaryMm: record.minFromBoundaryMm,
        },
      };
    }).filter((entry) => entry.flueId && entry.brand && entry.systemName);
    if (!flueOptions.length) throw new Error("No valid flue options");
  } catch (error) {
    console.warn("Failed to load flues.csv", error);
    flueOptions = [fallbackFlueOption];
  }
}

function setView(viewName) {
  const homeSection = document.getElementById("home-section");
  const root = viewRoot();
  if (!root) return;
  if (viewName === "home") {
    homeSection.hidden = false;
    renderHome();
    return;
  }
  homeSection.hidden = true;
  switch (viewName) {
    case "printSheet":
      renderPrintSheet();
      break;
    case "boilerStep1":
      renderBoilerStep1();
      break;
    case "boilerStep2":
      renderBoilerStep2();
      break;
    case "boilerStep3":
      renderBoilerStep3();
      break;
    case "flueStep1":
      renderFlueStep1();
      break;
    case "flueStep2":
      renderFlueStep2();
      break;
    case "flueStep3":
      renderFlueStep3();
      break;
    case "settings":
      renderSettings();
      break;
    default:
      renderHome();
  }
}

function renderHome() {
  const root = viewRoot();
  if (!root) return;
  root.innerHTML = `<div class="view-header"><h2>Ready when the data is</h2><p class="hint">Calibration and clearance logic will drop in once services are wired. For now, explore the mock workflows.</p></div>`;

  const tiles = document.getElementById("home-tiles");
  if (tiles && !tiles.querySelector("#tileSettings")) {
    tiles.insertAdjacentHTML(
      "beforeend",
      `
        <button class="tile" data-view="settings" id="tileSettings">
          <h3>Settings</h3>
          <p>Sheet calibration &amp; app options</p>
        </button>
      `,
    );
  }
}

function renderPrintSheet() {
  const root = viewRoot();
  if (!root) return;
  root.innerHTML = `
    <div class="print-sheet-view">
      <h2>Print positioning sheet</h2>
      <p>
        This A4 sheet is used to calibrate scale and orientation for boiler and flue positioning.
        Print it at <strong>100% scale</strong> (no "fit to page") and check that the short edge
        measures 210&nbsp;mm and the long edge 297&nbsp;mm.
      </p>
      <p>
        Tape the sheet flat to the wall, cupboard, or boiler front in the approximate position
        where the boiler or flue will go. Keep it reasonably level.
      </p>
      <p>
        <a href="assets/positioning-sheet-a4.svg" target="_blank" class="btn">
          Open A4 positioning sheet
        </a>
      </p>
      <p class="hint">
        Tip: When the sheet opens in your browser, use the print dialog and ensure
        the scale is set to 100% (or "Actual size").
      </p>
      <button type="button" class="btn secondary" id="backHomeBtn">Back to home</button>
    </div>
  `;
  const backBtn = document.getElementById("backHomeBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      setView("home");
    });
  }
}

function renderBoilerStep1() {
  const root = viewRoot();
  if (!root) return;
  root.innerHTML = `
    <div class="view-header">
      <div class="inline-group">
        <button class="btn secondary" data-nav="home">&larr; Home</button>
      </div>
      <h2>Boiler positioning &mdash; Step 1</h2>
      <p class="hint">Capture or upload an image containing the positioning sheet. Calibration is mocked with fixed px/mm for now.</p>
    </div>
    <div class="controls-grid">
      <div class="control-card">
        <label for="boilerImageInput">Site photograph</label>
        <input type="file" id="boilerImageInput" accept="image/*">
        <p class="hint">Images stay on-device. We only store them locally for overlay previews.</p>
      </div>
      <div class="control-card">
        <h3>Preview</h3>
        <div class="image-preview" id="boilerImagePreview"></div>
      </div>
    </div>
    <div class="plumb-tools">
      <p class="hint">
        Optional: if a red plumb line is visible in the photo, tap <strong>"Mark plumb line"</strong> then tap the <strong>top</strong>
        of the string and then the <strong>bottom</strong>. The app will use this to refine scale.
      </p>
      <button type="button" id="markPlumbBtn">Mark plumb line</button>
      <span id="plumbStatus" class="hint"></span>
    </div>
    <div class="flow-actions">
      <button class="btn secondary" data-nav="home">Cancel</button>
      <button class="btn" id="boilerDetectBtn" disabled>Detect sheet &amp; continue</button>
    </div>
  `;

  const backButtons = root.querySelectorAll("[data-nav='home']");
  backButtons.forEach((btn) => btn.addEventListener("click", () => setView("home")));

  const fileInput = root.querySelector("#boilerImageInput");
  const preview = root.querySelector("#boilerImagePreview");
  const detectBtn = root.querySelector("#boilerDetectBtn");
  const markPlumbBtn = root.querySelector("#markPlumbBtn");
  const plumbStatus = root.querySelector("#plumbStatus");

  let boilerPreviewCanvas = null;
  let previewImage = null;
  let plumbMarkMode = false;
  let plumbClickStage = 0;

  const updatePlumbStatus = (message) => {
    if (plumbStatus) plumbStatus.textContent = message;
  };

  const syncPlumbStatus = () => {
    if (!plumbStatus) return;
    const top = job.calibration?.plumbTopPx;
    const bottom = job.calibration?.plumbBottomPx;
    if (top && bottom) {
      const pxPerMm = Number.isFinite(job.calibration.pxPerMm)
        ? job.calibration.pxPerMm.toFixed(3)
        : "?";
      const length = job.calibration.plumbLengthMm ?? plumbConfig.lengthMm;
      const message = `Plumb line marked (${length} mm → ${pxPerMm} px/mm).`;
      plumbStatus.textContent = plumbConfig.enabled ? message : `${message} (disabled in Settings)`;
    } else {
      plumbStatus.textContent = "";
    }
  };

  const renderPreviewImage = () => {
    if (!boilerPreviewCanvas || !previewImage) return;
    drawImageToCanvas(boilerPreviewCanvas, previewImage);
    const ctx = boilerPreviewCanvas.getContext("2d");
    if (!ctx) return;
    const top = job.calibration?.plumbTopPx;
    const bottom = job.calibration?.plumbBottomPx;
    if (!top && !bottom) return;

    ctx.save();
    ctx.strokeStyle = "rgba(220, 38, 38, 0.85)";
    ctx.fillStyle = "rgba(220, 38, 38, 0.9)";
    ctx.lineWidth = 2;
    if (top && bottom) {
      ctx.beginPath();
      ctx.moveTo(top[0], top[1]);
      ctx.lineTo(bottom[0], bottom[1]);
      ctx.stroke();
    }
    const drawPoint = (point) => {
      if (!point) return;
      ctx.beginPath();
      ctx.arc(point[0], point[1], 4, 0, Math.PI * 2);
      ctx.fill();
    };
    drawPoint(top);
    drawPoint(bottom);
    ctx.restore();
  };

  const handleCanvasClick = (event) => {
    if (!plumbMarkMode || !boilerPreviewCanvas) return;
    const rect = boilerPreviewCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (!job.calibration) {
      job.calibration = {
        pxPerMm: 4.0,
        source: "mock",
        sheetCornersPx: {
          tl: [0, 0],
          tr: [0, 0],
          br: [0, 0],
          bl: [0, 0],
        },
        homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        sheetWidthMm: sheetConfig.widthMm,
        sheetHeightMm: sheetConfig.heightMm,
      };
    }

    if (plumbClickStage === 1) {
      job.calibration.plumbTopPx = [x, y];
      delete job.calibration.plumbBottomPx;
      job.calibration.plumbLengthMm = plumbConfig.lengthMm;
      plumbClickStage = 2;
      updatePlumbStatus("Now tap the BOTTOM of the plumb line...");
      renderPreviewImage();
      return;
    }

    if (plumbClickStage === 2) {
      job.calibration.plumbBottomPx = [x, y];
      job.calibration.plumbLengthMm = plumbConfig.lengthMm;
      plumbMarkMode = false;
      plumbClickStage = 0;
      recalcScaleFromPlumb();
      renderPreviewImage();
      syncPlumbStatus();
      return;
    }
  };

  const refreshPreview = () => {
    if (!preview) return;
    if (!job.image) {
      preview.innerHTML = '<span class="hint">No image selected yet.</span>';
      boilerPreviewCanvas = null;
      previewImage = null;
      plumbMarkMode = false;
      plumbClickStage = 0;
      updatePlumbStatus("");
      return;
    }

    preview.innerHTML = '<canvas id="boilerPreviewCanvas" class="preview-canvas"></canvas>';
    boilerPreviewCanvas = preview.querySelector("#boilerPreviewCanvas");
    previewImage = null;
    if (!boilerPreviewCanvas) return;
    boilerPreviewCanvas.addEventListener("click", handleCanvasClick);
    loadImage(job.image)
      .then((img) => {
        if (boilerPreviewCanvas) {
          previewImage = img;
          renderPreviewImage();
          syncPlumbStatus();
        }
      })
      .catch(() => {
        preview.innerHTML = '<span class="hint">Unable to load image preview.</span>';
        boilerPreviewCanvas = null;
        previewImage = null;
      });
  };

  if (job.image && detectBtn) {
    detectBtn.disabled = false;
  }

  refreshPreview();

  if (fileInput) {
    fileInput.addEventListener("change", (event) => {
      const target = event.target;
      const file = target.files && target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        resetJob();
        job.image = e.target?.result || null;
        refreshPreview();
        if (detectBtn) detectBtn.disabled = !job.image;
      };
      reader.readAsDataURL(file);
    });
  }

  if (markPlumbBtn) {
    markPlumbBtn.addEventListener("click", () => {
      if (!plumbConfig.enabled) {
        updatePlumbStatus("Enable plumb line in Settings first.");
        return;
      }
      if (!job.image) {
        updatePlumbStatus("Select an image first.");
        return;
      }
      if (!boilerPreviewCanvas) {
        updatePlumbStatus("Image preview not ready yet.");
        return;
      }
      plumbMarkMode = true;
      plumbClickStage = 1;
      updatePlumbStatus("Tap the TOP of the plumb line...");
    });
  }

  if (detectBtn) {
    detectBtn.addEventListener("click", () => {
      if (!job.image) return;
      job.calibration = {
        pxPerMm: 4.0, // TEMP: will be recomputed just below
        source: "mock",
        sheetCornersPx: {
          tl: [100, 100],
          tr: [400, 100],
          br: [400, 500],
          bl: [100, 500],
        },
        homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        sheetWidthMm: sheetConfig.widthMm,
        sheetHeightMm: sheetConfig.heightMm,
      };

      (function recalcMockScale() {
        const c = job.calibration;
        const { tl, tr, bl } = c.sheetCornersPx;
        const dxW = tr[0] - tl[0];
        const dyW = tr[1] - tl[1];
        const dxH = bl[0] - tl[0];
        const dyH = bl[1] - tl[1];
        const distPxWidth = Math.hypot(dxW, dyW);
        const distPxHeight = Math.hypot(dxH, dyH);

        const pxPerMmW = distPxWidth / c.sheetWidthMm;
        const pxPerMmH = distPxHeight / c.sheetHeightMm;
        c.pxPerMm = (pxPerMmW + pxPerMmH) / 2;
        c.source = "calibrationSheet";
      })();
      recalcScaleFromPlumb();
      // TODO: replace with real QR detection / calibration later.
      setView("boilerStep2");
    });
  }
}

function buildBoilerChoice(model, sheetDepth) {
  return {
    modelId: model.id,
    brand: model.brand,
    model: model.model,
    variant: model.variant,
    type: model.type,
    displayName: model.displayName,
    widthMm: model.widthMm ?? 0,
    heightMm: model.heightMm ?? 0,
    depthMm: model.depthMm ?? 0,
    install: { ...model.clearances.install },
    service: { ...model.clearances.service },
    sheetDepthFromWallMm: sheetDepth ?? 0,
  };
}

function renderBoilerStep2() {
  const root = viewRoot();
  if (!root) return;
  if (!job.image) {
    root.innerHTML = `<div class="view-header"><button class="btn secondary" data-nav="boilerStep1">&larr; Back</button><h2>Boiler positioning &mdash; Step 2</h2><p class="hint">Please upload a photograph first.</p></div>`;
    const backBtn = root.querySelector("[data-nav='boilerStep1']");
    if (backBtn) backBtn.addEventListener("click", () => setView("boilerStep1"));
    return;
  }

  if (!job.boiler && boilerModels.length) {
    const firstModel = boilerModels[0];
    job.boiler = buildBoilerChoice(firstModel, 0);
  }

  root.innerHTML = `
    <div class="view-header">
      <div class="inline-group">
        <button class="btn secondary" id="boilerStep2BackHeader">&larr; Back</button>
      </div>
      <h2>Boiler positioning &mdash; Step 2</h2>
      <p class="hint">Pick the boiler model and mark nearby cupboards, worktops, or ceilings.</p>
    </div>
    <div class="boiler-step">
      <div class="controls-grid split">
        <div class="control-card boiler-config">
          <div class="stack">
            <label for="boilerModelSelect">Boiler model</label>
            <select id="boilerModelSelect"></select>

            <div class="depth-controls">
              <p>Depth from wall to positioning sheet (mm)</p>
              <div class="buttons">
                <button type="button" id="depthOnWall">On wall (0)</button>
                <button type="button" id="depthOnBoilerFront">On boiler front (auto)</button>
                <button type="button" id="depthOnCupboard">On cupboard (600)</button>
              </div>
              <input type="number" id="sheetDepthInput" min="0" step="10">
            </div>
          </div>
        </div>
        <div class="stack boiler-canvas-wrap">
          <div class="canvas-wrapper">
            <canvas id="boilerCanvas" class="dashed"></canvas>
          </div>
          <div class="palette boiler-obstacles-palette" id="boilerPalette"></div>
        </div>
      </div>
      <div class="flow-actions boiler-nav">
        <button class="btn secondary" type="button" id="boilerBackBtn">Back</button>
        <button class="btn" type="button" id="boilerNextBtn">Next: Place boiler</button>
      </div>
    </div>
  `;

  const select = document.getElementById("boilerModelSelect");
  const depthInput = document.getElementById("sheetDepthInput");
  const depthOnWallBtn = document.getElementById("depthOnWall");
  const depthOnBoilerFrontBtn = document.getElementById("depthOnBoilerFront");
  const depthOnCupboardBtn = document.getElementById("depthOnCupboard");
  const palette = document.getElementById("boilerPalette");
  const canvas = document.getElementById("boilerCanvas");
  const headerBackBtn = document.getElementById("boilerStep2BackHeader");
  const backBtn = document.getElementById("boilerBackBtn");
  const nextBtn = document.getElementById("boilerNextBtn");

  const goBack = () => setView("boilerStep1");

  if (headerBackBtn) {
    headerBackBtn.addEventListener("click", goBack);
  }

  if (backBtn) {
    backBtn.addEventListener("click", goBack);
  }

  if (nextBtn) {
    nextBtn.disabled = !job.boiler;
    nextBtn.addEventListener("click", () => {
      if (!job.boiler) return;
      setView("boilerStep3");
    });
  }

  if (select) {
    boilerModels.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.displayName;
      if (job.boiler?.modelId === m.id) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });

    select.addEventListener("change", () => {
      const selId = select.value;
      const m = boilerModels.find((b) => b.id === selId);
      if (!m) return;
      const sheetDepth = job.boiler?.sheetDepthFromWallMm ?? 0;
      job.boiler = buildBoilerChoice(m, sheetDepth);
      if (depthInput) depthInput.value = String(job.boiler.sheetDepthFromWallMm);
      if (nextBtn) nextBtn.disabled = !job.boiler;
    });
  }

  const updateDepth = (mm) => {
    if (!job.boiler) return;
    job.boiler.sheetDepthFromWallMm = mm;
    if (depthInput) depthInput.value = String(mm);
  };

  if (depthInput) {
    depthInput.value = String(job.boiler?.sheetDepthFromWallMm ?? 0);
    depthInput.addEventListener("input", () => {
      const mm = Number(depthInput.value) || 0;
      updateDepth(mm);
    });
  }

  if (depthOnWallBtn) {
    depthOnWallBtn.addEventListener("click", () => updateDepth(0));
  }

  if (depthOnBoilerFrontBtn) {
    depthOnBoilerFrontBtn.addEventListener("click", () => {
      const model = boilerModels.find((b) => b.id === job.boiler?.modelId);
      updateDepth(model?.depthMm ?? 300);
    });
  }

  if (depthOnCupboardBtn) {
    depthOnCupboardBtn.addEventListener("click", () => updateDepth(600));
  }

  let currentKind = null;
  if (palette) {
    palette.innerHTML = "";
    boilerObstacleKinds.forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.kind = entry.kind;
      button.innerHTML = `<span class="color-dot" style="background:${entry.color}"></span>${entry.label}`;
      if (currentKind === entry.kind) button.classList.add("active");
      button.addEventListener("click", () => {
        currentKind = entry.kind;
        palette.querySelectorAll("button").forEach((btn) => btn.classList.toggle("active", btn === button));
      });
      palette.appendChild(button);
    });
  }

  if (canvas) {
    loadImage(job.image).then((img) => {
      const drawScene = () => {
        const info = drawImageToCanvas(canvas, img);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        job.boilerObstacles.forEach((obstacle) => {
          const colorEntry = boilerObstacleKinds.find((entry) => entry.kind === obstacle.kind);
          ctx.fillStyle = colorEntry?.color || "#333";
          ctx.beginPath();
          ctx.arc(obstacle.x, obstacle.y, 6, 0, Math.PI * 2);
          ctx.fill();
        });
      };
      drawScene();
      canvas.addEventListener("click", (event) => {
        if (!currentKind) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (event.clientX - rect.left) * scaleX;
        const y = (event.clientY - rect.top) * scaleY;
        job.boilerObstacles.push({ kind: currentKind, x, y });
        drawScene();
      });
    });
  }

}

function renderBoilerStep3() {
  const root = viewRoot();
  if (!root) return;
  if (!job.image || !job.calibration || !job.boiler) {
    root.innerHTML = `<div class="view-header"><button class="btn secondary" data-nav="boilerStep2">&larr; Back</button><h2>Boiler positioning &mdash; Step 3</h2><p class="hint">Complete the previous steps first.</p></div>`;
    const backBtn = root.querySelector("[data-nav='boilerStep2']");
    if (backBtn) backBtn.addEventListener("click", () => setView("boilerStep2"));
    return;
  }

  root.innerHTML = `
    <div class="view-header">
      <div class="inline-group">
        <button class="btn secondary" data-nav="boilerStep2">&larr; Back</button>
      </div>
      <h2>Boiler positioning &mdash; Step 3</h2>
      <p class="hint">Move the boiler overlay into position. Aura colours are placeholders until clearance logic is connected.</p>
    </div>
    <div class="stack">
      <div class="canvas-wrapper">
        <canvas id="boilerCanvasStep3" class="dashed"></canvas>
      </div>
      <div class="arrow-pad" id="boilerArrowPad">
        <span></span><button data-direction="up">&uarr;</button><span></span>
        <button data-direction="left">&larr;</button><span></span><button data-direction="right">&rarr;</button>
        <span></span><button data-direction="down">&darr;</button><span></span>
      </div>
      <div class="status-panel" id="boilerStatusPanel"></div>
    </div>
    <div class="flow-actions">
      <button class="btn" id="boilerSnapshot">Save snapshot</button>
      <button class="btn secondary" id="boilerRestart">Start again</button>
    </div>
  `;

  const canvas = root.querySelector("#boilerCanvasStep3");
  const statusPanel = root.querySelector("#boilerStatusPanel");
  const arrowPad = root.querySelectorAll("#boilerArrowPad button[data-direction]");
  const snapshotBtn = root.querySelector("#boilerSnapshot");
  const restartBtn = root.querySelector("#boilerRestart");
  const backBtn = root.querySelector("[data-nav='boilerStep2']");
  if (backBtn) backBtn.addEventListener("click", () => setView("boilerStep2"));

  if (!canvas) return;
  loadImage(job.image).then((img) => {
    const drawScene = () => {
      const info = drawImageToCanvas(canvas, img);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const scale = info.scale;
      if (!boilerPlacement) {
        const corners = job.calibration?.sheetCornersPx;
        if (corners) {
          const cx = (corners.tl[0] + corners.br[0]) / 2;
          const cy = (corners.tl[1] + corners.br[1]) / 2;
          boilerPlacement = { x: cx, y: cy };
        } else {
          boilerPlacement = { x: img.width / 2, y: img.height / 2 };
        }
      }

      const widthPx = job.boiler.widthMm * job.calibration.pxPerMm;
      const heightPx = job.boiler.heightMm * job.calibration.pxPerMm;
      const auraMarginPx = 200 * job.calibration.pxPerMm;

      const centerX = boilerPlacement.x * scale;
      const centerY = boilerPlacement.y * scale;
      const boilerWidth = widthPx * scale;
      const boilerHeight = heightPx * scale;
      const aura = auraMarginPx * scale;

      ctx.fillStyle = "rgba(46, 204, 113, 0.2)";
      ctx.fillRect(
        centerX - boilerWidth / 2 - aura,
        centerY - boilerHeight / 2 - aura,
        boilerWidth + aura * 2,
        boilerHeight + aura * 2,
      );

      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.strokeStyle = "rgba(15, 23, 42, 0.7)";
      ctx.lineWidth = 2;
      ctx.fillRect(centerX - boilerWidth / 2, centerY - boilerHeight / 2, boilerWidth, boilerHeight);
      ctx.strokeRect(centerX - boilerWidth / 2, centerY - boilerHeight / 2, boilerWidth, boilerHeight);

      // TODO: once CSV clearances and AI geometry are wired:
      // - Use job.boilerObstacles as limit lines (leftTall/rightTall/wallUnit/worktop/ceiling).
      // - Compare distances from boiler aura to these limits using actual install/service values.
      // - Change aura colour to green/amber/red accordingly.

      if (statusPanel) {
        const label = job.boiler.displayName || [job.boiler.brand, job.boiler.model, job.boiler.variant]
          .filter(Boolean)
          .join(" ");
        statusPanel.innerHTML = `
          <div><strong>Boiler:</strong> ${label}</div>
          <div>Size: ${job.boiler.widthMm}mm × ${job.boiler.heightMm}mm × ${job.boiler.depthMm}mm</div>
          <div>Sheet depth reference: ${job.boiler.sheetDepthFromWallMm}mm</div>
          <div class="badge-amber">Clearance checks pending CSV rules</div>
        `;
      }
    };

    drawScene();

    arrowPad.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        if (!boilerPlacement) return;
        const nudgeMm = 10;
        const nudgePx = nudgeMm * job.calibration.pxPerMm;
        const direction = button.dataset.direction;
        if (direction === "up") boilerPlacement.y -= nudgePx;
        if (direction === "down") boilerPlacement.y += nudgePx;
        if (direction === "left") boilerPlacement.x -= nudgePx;
        if (direction === "right") boilerPlacement.x += nudgePx;
        drawScene();
      });
    });

    if (snapshotBtn) {
      snapshotBtn.addEventListener("click", () => {
        downloadCanvasImage(canvas, "boiler-overlay.png");
      });
    }
  });

  if (restartBtn) {
    restartBtn.addEventListener("click", () => {
      resetJob();
      setView("home");
    });
  }
}

function renderFlueStep1() {
  const root = viewRoot();
  if (!root) return;
  root.innerHTML = `
    <div class="view-header">
      <div class="inline-group">
        <button class="btn secondary" data-nav="home">&larr; Home</button>
      </div>
      <h2>Flue positioning &mdash; Step 1</h2>
      <p class="hint">Upload an exterior photo that clearly shows the calibration card and flue area.</p>
    </div>
    <div class="controls-grid">
      <div class="control-card">
        <label for="flueImageInput">Site photograph</label>
        <input type="file" id="flueImageInput" accept="image/*">
        <p class="hint">Use the same photo for calibration and overlays.</p>
        <div class="calibration-controls">
          <button type="button" class="btn" id="btnCalibrate" disabled>Calibrate with card</button>
          <span id="calStatus" class="status">Not calibrated</span>
        </div>
      </div>
      <div class="control-card">
        <h3>Preview</h3>
        <div class="image-preview" id="flueImagePreview">
          <div id="canvasContainer">
            <canvas id="photoCanvas"></canvas>
            <canvas id="overlayCanvas"></canvas>
          </div>
        </div>
      </div>
    </div>
    <div class="plumb-tools">
      <p class="hint">
        Optional: if a red plumb line is visible in the photo, tap <strong>"Mark plumb line"</strong> then tap the <strong>top</strong>
        of the string and then the <strong>bottom</strong>. The app will use this to refine scale.
      </p>
      <button type="button" id="flueMarkPlumbBtn">Mark plumb line</button>
      <span id="fluePlumbStatus" class="hint"></span>
    </div>
    <div class="flow-actions">
      <button class="btn secondary" data-nav="home">Cancel</button>
      <button class="btn" id="flueDetectBtn" disabled>Next: mark flue</button>
    </div>
    <div id="calModal" class="modal hidden">
      <div class="modal-content">
        <h2>Card calibration</h2>
        <p>
          Make sure the card is clearly visible, flat against the wall or boiler, in the same plane as the flue.
        </p>
        <div class="modal-buttons">
          <button type="button" id="btnAutoDetect">Auto-detect card</button>
          <button type="button" id="btnManualCorners">Tap corners manually</button>
        </div>
        <button type="button" id="btnCloseModal" class="secondary">Cancel</button>
      </div>
    </div>
    <div id="tapHint" class="tap-hint hidden">
      Tap the card corners in order: top-left, top-right, bottom-right, bottom-left.
      <button type="button" id="btnCancelTap" class="secondary small">Cancel</button>
    </div>
  `;

  const backButtons = root.querySelectorAll("[data-nav='home']");
  backButtons.forEach((btn) => btn.addEventListener("click", () => setView("home")));

  const fileInput = root.querySelector("#flueImageInput");
  const detectBtn = root.querySelector("#flueDetectBtn");
  const markPlumbBtn = root.querySelector("#flueMarkPlumbBtn");
  const plumbStatus = root.querySelector("#fluePlumbStatus");
  const btnCalibrate = root.querySelector("#btnCalibrate");
  const calStatus = root.querySelector("#calStatus");
  const photoCanvas = root.querySelector("#photoCanvas");
  const overlayCanvas = root.querySelector("#overlayCanvas");
  const photoCtx = photoCanvas ? photoCanvas.getContext("2d") : null;
  const overlayCtx = overlayCanvas ? overlayCanvas.getContext("2d") : null;
  const calModal = root.querySelector("#calModal");
  const btnAutoDetect = root.querySelector("#btnAutoDetect");
  const btnManualCorners = root.querySelector("#btnManualCorners");
  const btnCloseModal = root.querySelector("#btnCloseModal");
  const tapHint = root.querySelector("#tapHint");
  const btnCancelTap = root.querySelector("#btnCancelTap");

  let previewImage = null;
  let plumbMarkMode = false;
  let plumbClickStage = 0;
  let tapSession = null;

  const updateCalStatus = (text, ok = false) => {
    if (!calStatus) return;
    calStatus.textContent = text;
    calStatus.style.color = ok ? "#6ee7b7" : "#f97373";
  };

  const updatePlumbStatus = (message) => {
    if (plumbStatus) plumbStatus.textContent = message;
  };

  const syncPlumbStatus = () => {
    if (!plumbStatus) return;
    const top = job.calibration?.plumbTopPx;
    const bottom = job.calibration?.plumbBottomPx;
    if (top && bottom) {
      const pxPerMm = Number.isFinite(job.calibration?.pxPerMm)
        ? job.calibration.pxPerMm.toFixed(3)
        : "?";
      const length = job.calibration?.plumbLengthMm ?? plumbConfig.lengthMm;
      const message = `Plumb line marked (${length} mm → ${pxPerMm} px/mm).`;
      plumbStatus.textContent = plumbConfig.enabled ? message : `${message} (disabled in Settings)`;
    } else {
      plumbStatus.textContent = "";
    }
  };

  const ensureCalibrationShell = () => {
    if (!job.calibration) {
      job.calibration = {
        pxPerMm: 4.0,
        source: "mock",
        sheetCornersPx: {
          tl: [0, 0],
          tr: [0, 0],
          br: [0, 0],
          bl: [0, 0],
        },
        homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        sheetWidthMm: sheetConfig.widthMm,
        sheetHeightMm: sheetConfig.heightMm,
      };
    }
    return job.calibration;
  };

  const resetCardState = () => {
    if (typeof IDCalib === "undefined") return;
    const state = IDCalib.getCalibState();
    state.scalePxPerMm = null;
    state.cardCorners = null;
  };

  const resizeCanvasesToImage = (img) => {
    if (!photoCanvas || !overlayCanvas) return;
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    photoCanvas.width = width;
    photoCanvas.height = height;
    overlayCanvas.width = width;
    overlayCanvas.height = height;
  };

  const clearOverlay = () => {
    if (!overlayCtx || !overlayCanvas) return;
    if (typeof IDOverlay !== "undefined" && IDOverlay.clearOverlay) {
      IDOverlay.clearOverlay(overlayCtx, overlayCanvas);
    } else {
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
  };

  const drawPlumbOverlay = () => {
    if (!overlayCtx) return;
    const top = job.calibration?.plumbTopPx;
    const bottom = job.calibration?.plumbBottomPx;
    if (!top && !bottom) return;
    overlayCtx.save();
    overlayCtx.strokeStyle = "rgba(220, 38, 38, 0.85)";
    overlayCtx.fillStyle = "rgba(220, 38, 38, 0.9)";
    overlayCtx.lineWidth = 2;
    if (top && bottom) {
      overlayCtx.beginPath();
      overlayCtx.moveTo(top[0], top[1]);
      overlayCtx.lineTo(bottom[0], bottom[1]);
      overlayCtx.stroke();
    }
    const drawPoint = (point) => {
      if (!point) return;
      overlayCtx.beginPath();
      overlayCtx.arc(point[0], point[1], 4, 0, Math.PI * 2);
      overlayCtx.fill();
    };
    drawPoint(top);
    drawPoint(bottom);
    overlayCtx.restore();
  };

  const refreshOverlayVisuals = () => {
    if (!overlayCtx || !overlayCanvas) return;
    clearOverlay();
    if (typeof IDCalib !== "undefined") {
      const state = IDCalib.getCalibState();
      if (state?.cardCorners && IDOverlay?.drawCardOutline) {
        IDOverlay.drawCardOutline(overlayCtx, state.cardCorners);
      }
    }
    drawPlumbOverlay();
  };

  const drawPhoto = () => {
    if (!photoCtx || !photoCanvas || !previewImage) return;
    resizeCanvasesToImage(previewImage);
    photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
    photoCtx.drawImage(previewImage, 0, 0, photoCanvas.width, photoCanvas.height);
    refreshOverlayVisuals();
  };

  const refreshPreview = () => {
    if (!photoCanvas || !overlayCanvas) return;
    if (!job.image) {
      previewImage = null;
      photoCanvas.width = 0;
      photoCanvas.height = 0;
      overlayCanvas.width = 0;
      overlayCanvas.height = 0;
      if (btnCalibrate) btnCalibrate.disabled = true;
      updateCalStatus("Load a photo, then calibrate with the card.");
      clearOverlay();
      resetCardState();
      return;
    }
    loadImage(job.image)
      .then((img) => {
        previewImage = img;
        const state = typeof IDCalib !== "undefined" ? IDCalib.getCalibState() : null;
        if (state?.scalePxPerMm) {
          updateCalStatus(`Scale: ${state.scalePxPerMm.toFixed(3)} px/mm`, true);
        } else {
          updateCalStatus("Not calibrated", false);
        }
        drawPhoto();
        if (btnCalibrate) btnCalibrate.disabled = false;
      })
      .catch(() => {
        updateCalStatus("Failed to load preview.");
      });
  };

  const handleOverlayClick = (event) => {
    if (!plumbMarkMode || !overlayCanvas || tapSession) return;
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    const calibration = ensureCalibrationShell();

    if (plumbClickStage === 0) {
      plumbClickStage = 1;
      updatePlumbStatus("Tap the TOP of the plumb line...");
    }
    if (plumbClickStage === 1) {
      calibration.plumbTopPx = [x, y];
      delete calibration.plumbBottomPx;
      calibration.plumbLengthMm = plumbConfig.lengthMm;
      plumbClickStage = 2;
      updatePlumbStatus("Tap the BOTTOM of the plumb line...");
    } else if (plumbClickStage === 2) {
      calibration.plumbBottomPx = [x, y];
      calibration.plumbLengthMm = plumbConfig.lengthMm;
      plumbClickStage = 0;
      plumbMarkMode = false;
      recalcScaleFromPlumb();
      syncPlumbStatus();
    }
    refreshOverlayVisuals();
  };

  if (overlayCanvas) {
    overlayCanvas.addEventListener("click", handleOverlayClick);
  }

  if (fileInput) {
    fileInput.addEventListener("change", (event) => {
      const target = event.target;
      const file = target.files && target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        resetJob();
        resetCardState();
        job.image = e.target?.result || null;
        if (detectBtn) detectBtn.disabled = !job.image;
        plumbMarkMode = false;
        plumbClickStage = 0;
        syncPlumbStatus();
        refreshPreview();
      };
      reader.readAsDataURL(file);
    });
  }

  if (btnCalibrate) {
    const openCalModal = () => {
      if (!previewImage || !calModal) return;
      calModal.classList.remove("hidden");
    };
    const closeCalModal = () => {
      if (calModal) calModal.classList.add("hidden");
    };

    btnCalibrate.addEventListener("click", openCalModal);
    if (btnCloseModal) btnCloseModal.addEventListener("click", closeCalModal);

    if (btnAutoDetect) {
      btnAutoDetect.addEventListener("click", () => {
        closeCalModal();
        if (tapSession?.cancel) tapSession.cancel();
        tapSession = null;
        tapHint?.classList.add("hidden");
        if (!photoCanvas || !photoCanvas.width) return;
        const corners = IDCalib.detectCardCornersFromCanvas(photoCanvas);
        if (!corners) {
          updateCalStatus("Auto-detect failed – try manual taps.");
          refreshOverlayVisuals();
          return;
        }
        const scale = IDCalib.computeScaleFromCorners(corners);
        ensureCalibrationShell();
        job.calibration.pxPerMm = scale;
        job.calibration.source = "idCardAuto";
        job.calibration.cardCorners = corners;
        refreshOverlayVisuals();
        updateCalStatus(`Calibrated (auto): ${scale.toFixed(3)} px/mm`, true);
      });
    }

    if (btnManualCorners) {
      btnManualCorners.addEventListener("click", () => {
        closeCalModal();
        if (!overlayCanvas) return;
        plumbMarkMode = false;
        plumbClickStage = 0;
        if (tapSession?.cancel) tapSession.cancel();
        tapHint?.classList.remove("hidden");
        tapSession = IDCalib.startManualCornerTap(
          overlayCanvas,
          (scale, cardCorners) => {
            tapHint?.classList.add("hidden");
            tapSession = null;
            ensureCalibrationShell();
            job.calibration.pxPerMm = scale;
            job.calibration.source = "idCardManual";
            job.calibration.cardCorners = cardCorners;
            refreshOverlayVisuals();
            updateCalStatus(`Calibrated (manual): ${scale.toFixed(3)} px/mm`, true);
          },
          () => {
            tapHint?.classList.add("hidden");
            tapSession = null;
            updateCalStatus("Manual calibration cancelled");
            refreshOverlayVisuals();
          },
          (ctx) => {
            const w = overlayCanvas.width;
            const h = overlayCanvas.height;
            const aspect = IDCalib.CARD_WIDTH_MM / IDCalib.CARD_HEIGHT_MM;
            let gw = w * 0.35;
            let gh = gw / aspect;
            if (gh > h * 0.6) {
              gh = h * 0.6;
              gw = gh * aspect;
            }
            const gx = (w - gw) / 2;
            const gy = (h - gh) / 2;
            ctx.save();
            ctx.setLineDash([8, 6]);
            ctx.strokeStyle = "rgba(255,255,255,0.35)";
            ctx.lineWidth = 2;
            ctx.strokeRect(gx, gy, gw, gh);
            ctx.restore();
          },
        );
      });
    }

    if (btnCancelTap) {
      btnCancelTap.addEventListener("click", () => {
        if (tapSession?.cancel) tapSession.cancel();
        tapSession = null;
        tapHint?.classList.add("hidden");
        updateCalStatus("Manual calibration cancelled");
        refreshOverlayVisuals();
      });
    }
  }

  if (markPlumbBtn) {
    markPlumbBtn.addEventListener("click", () => {
      if (!plumbConfig.enabled) {
        updatePlumbStatus("Enable plumb line in Settings first.");
        return;
      }
      if (!job.image) {
        updatePlumbStatus("Select an image first.");
        return;
      }
      if (!overlayCanvas || !overlayCanvas.width) {
        updatePlumbStatus("Image preview not ready yet.");
        return;
      }
      ensureCalibrationShell();
      plumbMarkMode = true;
      plumbClickStage = 1;
      updatePlumbStatus("Tap the TOP of the plumb line...");
    });
  }

  if (detectBtn) {
    detectBtn.disabled = !job.image;
    detectBtn.addEventListener("click", () => {
      if (!job.image) return;
      const state = typeof IDCalib !== "undefined" ? IDCalib.getCalibState() : null;
      const pxPerMm = state?.scalePxPerMm;
      if (!pxPerMm) {
        updateCalStatus("Please calibrate with the card before continuing.");
        return;
      }
      ensureCalibrationShell();
      job.calibration.pxPerMm = pxPerMm;
      job.calibration.source = job.calibration.source || "idCard";
      recalcScaleFromPlumb();
      setView("flueStep2");
    });
  }

  refreshPreview();
  syncPlumbStatus();
}

function renderSettings() {
  const root = document.getElementById("view-root");
  if (!root) return;
  root.innerHTML = `
    <div class="settings-view">
      <h2>Settings</h2>

      <section class="settings-section">
        <h3>Positioning sheet scale</h3>
        <p class="hint">
          If Safari or the printer has scaled the A4 positioning sheet, measure the
          distance on the printed paper between the <strong>centre</strong> of the TL and TR
          markers, and between TL and BL. Enter those values here once and the app
          will use them for all jobs.
        </p>
        <div class="settings-field-row">
          <label>
            TL ↔ TR (width, mm)
            <input type="number" id="sheetWidthMmInput" min="100" max="400" step="1">
          </label>
          <label>
            TL ↔ BL (height, mm)
            <input type="number" id="sheetHeightMmInput" min="100" max="500" step="1">
          </label>
        </div>
        <p id="sheetScaleInfo" class="hint"></p>
      </section>

      <section class="settings-section">
        <h3>Plumb line (optional)</h3>
        <p class="hint">
          If you use a red plumb line for calibration, enable it here and set the physical string length. In a photo you can
          mark the top and bottom of the string and the app will compute scale directly from that length.
        </p>
        <label class="inline">
          <input type="checkbox" id="plumbEnabledCheckbox">
          Use plumb line when available
        </label>
        <label>
          Plumb line length (mm)
          <input type="number" id="plumbLengthInput" min="50" max="2000" step="10">
        </label>
        <p class="hint">
          Recommended: 400 mm (easy to measure and long enough to be accurate).
        </p>
      </section>

      <button type="button" id="settingsBackBtn">Back</button>
    </div>
  `;

  const widthInput = document.getElementById("sheetWidthMmInput");
  const heightInput = document.getElementById("sheetHeightMmInput");
  const info = document.getElementById("sheetScaleInfo");
  const plumbEnabledCheckbox = document.getElementById("plumbEnabledCheckbox");
  const plumbLengthInput = document.getElementById("plumbLengthInput");

  if (!widthInput || !heightInput || !plumbEnabledCheckbox || !plumbLengthInput) return;

  // Initialise from global sheetConfig
  widthInput.value = String(sheetConfig.widthMm);
  heightInput.value = String(sheetConfig.heightMm);
  plumbEnabledCheckbox.checked = plumbConfig.enabled;
  plumbLengthInput.value = String(plumbConfig.lengthMm);

  const refreshCalibrationInfo = (wMm, hMm) => {
    if (!info) return;
    if (job.calibration) {
      if (
        job.calibration.source === "plumbLine" &&
        job.calibration.plumbTopPx &&
        job.calibration.plumbBottomPx
      ) {
        const pxPerMm = Number.isFinite(job.calibration.pxPerMm)
          ? job.calibration.pxPerMm.toFixed(3)
          : "?";
        const length = job.calibration.plumbLengthMm ?? plumbConfig.lengthMm;
        info.textContent = `Current scale: ${pxPerMm} px/mm (plumb line ${length} mm).`;
        return;
      }
      if (job.calibration.source === "calibrationSheet") {
        const width = job.calibration.sheetWidthMm ?? wMm;
        const height = job.calibration.sheetHeightMm ?? hMm;
        const pxPerMm = Number.isFinite(job.calibration.pxPerMm)
          ? job.calibration.pxPerMm.toFixed(3)
          : "?";
        info.textContent = `Current scale: ${pxPerMm} px/mm (sheet ${width} × ${height} mm).`;
        return;
      }
      if (Number.isFinite(job.calibration.pxPerMm)) {
        info.textContent = `Current scale: ${job.calibration.pxPerMm.toFixed(3)} px/mm.`;
        return;
      }
    }
    info.textContent = `Sheet dimensions set to ${wMm} × ${hMm} mm. Calibration will use these once a sheet is detected.`;
  };

  const recomputeScaleFromSheet = (wMm, hMm) => {
    if (!job.calibration || !job.calibration.sheetCornersPx) return false;
    const { tl, tr, bl } = job.calibration.sheetCornersPx;
    if (!tl || !tr || !bl) return false;

    const dxW = tr[0] - tl[0];
    const dyW = tr[1] - tl[1];
    const dxH = bl[0] - tl[0];
    const dyH = bl[1] - tl[1];
    const distPxWidth = Math.hypot(dxW, dyW);
    const distPxHeight = Math.hypot(dxH, dyH);

    const pxPerMmW = distPxWidth / wMm;
    const pxPerMmH = distPxHeight / hMm;
    const pxPerMm = (pxPerMmW + pxPerMmH) / 2;

    job.calibration.pxPerMm = pxPerMm;
    job.calibration.sheetWidthMm = wMm;
    job.calibration.sheetHeightMm = hMm;
    job.calibration.source = "calibrationSheet";
    return true;
  };

  const updateSheetConfig = () => {
    const wMm = Number(widthInput.value) || 210;
    const hMm = Number(heightInput.value) || 297;

    sheetConfig.widthMm = wMm;
    sheetConfig.heightMm = hMm;

    recomputeScaleFromSheet(wMm, hMm);
    recalcScaleFromPlumb();
    refreshCalibrationInfo(wMm, hMm);
  };

  widthInput.addEventListener("input", updateSheetConfig);
  heightInput.addEventListener("input", updateSheetConfig);

  const updatePlumbConfig = () => {
    plumbConfig.enabled = !!plumbEnabledCheckbox.checked;
    const len = Number(plumbLengthInput.value) || 400;
    plumbConfig.lengthMm = len;

    if (job.calibration) {
      if (plumbConfig.enabled && job.calibration.plumbTopPx && job.calibration.plumbBottomPx) {
        job.calibration.plumbLengthMm = len;
      } else if (!plumbConfig.enabled) {
        recomputeScaleFromSheet(sheetConfig.widthMm, sheetConfig.heightMm);
      }
    }

    recalcScaleFromPlumb();
    refreshCalibrationInfo(sheetConfig.widthMm, sheetConfig.heightMm);
  };

  plumbEnabledCheckbox.addEventListener("change", updatePlumbConfig);
  plumbLengthInput.addEventListener("input", updatePlumbConfig);

  // Run once to show initial message
  updateSheetConfig();
  updatePlumbConfig();

  const backBtn = document.getElementById("settingsBackBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      setView("home");
    });
  }
}

function renderFlueStep2() {
  const root = viewRoot();
  if (!root) return;
  if (!job.image) {
    root.innerHTML = `<div class="view-header"><button class="btn secondary" data-nav="flueStep1">&larr; Back</button><h2>Flue positioning &mdash; Step 2</h2><p class="hint">Please upload a photograph first.</p></div>`;
    const backBtn = root.querySelector("[data-nav='flueStep1']");
    if (backBtn) backBtn.addEventListener("click", () => setView("flueStep1"));
    return;
  }

  if (!selectedFlueId && flueOptions.length) {
    selectedFlueId = flueOptions[0].flueId;
  }

  root.innerHTML = `
    <div class="view-header">
      <div class="inline-group">
        <button class="btn secondary" data-nav="flueStep1">&larr; Back</button>
      </div>
      <h2>Flue positioning &mdash; Step 2</h2>
      <p class="hint">Mark the flue terminal and surrounding obstacles.</p>
    </div>
    <div class="stack">
      <div class="control-card">
        <label for="flueSelect">Flue system</label>
        <select id="flueSelect"></select>
      </div>
      <div class="canvas-wrapper">
        <canvas id="flueCanvas" class="dashed"></canvas>
      </div>
      <div class="palette" id="fluePalette"></div>
    </div>
    <div class="flow-actions">
      <button class="btn secondary" data-nav="flueStep1">Back</button>
      <button class="btn" id="flueStep2Next" ${job.flue ? "" : "disabled"}>Next: clearances</button>
    </div>
  `;

  const select = root.querySelector("#flueSelect");
  const palette = root.querySelector("#fluePalette");
  const canvas = root.querySelector("#flueCanvas");
  const nextBtn = root.querySelector("#flueStep2Next");
  const backButtons = root.querySelectorAll("[data-nav='flueStep1']");
  backButtons.forEach((btn) => btn.addEventListener("click", () => setView("flueStep1")));

  if (select) {
    flueOptions.forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.flueId;
      opt.textContent = `${option.brand} ${option.systemName} (${option.terminalType})`;
      if (selectedFlueId === option.flueId) opt.selected = true;
      select.append(opt);
    });

    select.addEventListener("change", () => {
      selectedFlueId = select.value;
      const selectedOption = flueOptions.find((option) => option.flueId === selectedFlueId);
      if (job.flue && selectedOption) {
        job.flue.diameterMm = selectedOption.diameterMm;
      }
    });
  }

  let currentMode = null;
  if (palette) {
    const flueButton = document.createElement("button");
    flueButton.type = "button";
    flueButton.dataset.mode = "flue";
    flueButton.innerHTML = `<span class="color-dot" style="background:#e74c3c"></span>Flue terminal`;
    palette.append(flueButton);

    flueObstacleKinds.forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.mode = entry.kind;
      button.innerHTML = `<span class="color-dot" style="background:${entry.color}"></span>${entry.label}`;
      palette.append(button);
    });

    const updateActive = (activeButton) => {
      palette.querySelectorAll("button").forEach((btn) => btn.classList.toggle("active", btn === activeButton));
    };

    palette.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        currentMode = button.dataset.mode || null;
        updateActive(button);
      });
    });
  }

  if (canvas) {
    loadImage(job.image).then((img) => {
      const drawScene = () => {
        const info = drawImageToCanvas(canvas, img);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const scale = info.scale;
        job.flueObstacles.forEach((obstacle) => {
          const entry = flueObstacleKinds.find((item) => item.kind === obstacle.kind);
          ctx.fillStyle = entry?.color || "#2c3e50";
          ctx.beginPath();
          ctx.arc(obstacle.x * scale, obstacle.y * scale, 6, 0, Math.PI * 2);
          ctx.fill();
        });
        if (job.flue) {
          ctx.fillStyle = "rgba(231, 76, 60, 0.8)";
          ctx.beginPath();
          ctx.arc(job.flue.x * scale, job.flue.y * scale, 8, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      drawScene();

      canvas.addEventListener("click", (event) => {
        if (!currentMode) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = (event.clientX - rect.left) * scaleX;
        const canvasY = (event.clientY - rect.top) * scaleY;
        const info = { scale: canvas.width / img.width };
        const imageX = canvasX / info.scale;
        const imageY = canvasY / info.scale;
        if (currentMode === "flue") {
          const selectedOption = flueOptions.find((option) => option.flueId === selectedFlueId) || fallbackFlueOption;
          job.flue = {
            x: imageX,
            y: imageY,
            diameterMm: selectedOption.diameterMm,
          };
          if (nextBtn) nextBtn.disabled = false;
        } else {
          job.flueObstacles.push({ kind: currentMode, x: imageX, y: imageY });
        }
        drawScene();
      });
    });
  }

  if (nextBtn) {
    nextBtn.disabled = !job.flue;
    nextBtn.addEventListener("click", () => {
      if (!job.flue) return;
      setView("flueStep3");
    });
  }
}

function renderFlueStep3() {
  const root = viewRoot();
  if (!root) return;
  const calState = typeof IDCalib !== "undefined" ? IDCalib.getCalibState() : null;
  const pxPerMm = calState?.scalePxPerMm || job.calibration?.pxPerMm || null;
  if (!job.image || !job.flue || !pxPerMm) {
    root.innerHTML = `<div class="view-header"><button class="btn secondary" data-nav='flueStep2'>&larr; Back</button><h2>Flue positioning &mdash; Step 3</h2><p class="hint">Load a calibrated photo and mark the flue before continuing.</p></div>`;
    const backBtn = root.querySelector("[data-nav='flueStep2']");
    if (backBtn) backBtn.addEventListener("click", () => setView("flueStep2"));
    return;
  }

  const selectedOption = flueOptions.find((option) => option.flueId === selectedFlueId) || fallbackFlueOption;

  root.innerHTML = `
    <div class="view-header">
      <div class="inline-group">
        <button class="btn secondary" data-nav="flueStep2">&larr; Back</button>
      </div>
      <h2>Flue positioning &mdash; Step 3</h2>
      <p class="hint">Placeholder red/green zones show where clearance logic will appear.</p>
    </div>
    <div class="stack">
      <div class="canvas-wrapper">
        <canvas id="flueCanvasStep3" class="dashed"></canvas>
      </div>
      <div class="arrow-pad" id="flueArrowPad">
        <span></span><button data-direction="up">&uarr;</button><span></span>
        <button data-direction="left">&larr;</button><span></span><button data-direction="right">&rarr;</button>
        <span></span><button data-direction="down">&darr;</button><span></span>
      </div>
      <div class="status-panel" id="flueStatus"></div>
    </div>
    <div class="flow-actions">
      <button class="btn" id="flueSnapshot">Save snapshot</button>
      <button class="btn secondary" id="flueRestart">Start again</button>
    </div>
  `;

  const canvas = root.querySelector("#flueCanvasStep3");
  const statusPanel = root.querySelector("#flueStatus");
  const arrowButtons = root.querySelectorAll("#flueArrowPad button[data-direction]");
  const snapshotBtn = root.querySelector("#flueSnapshot");
  const restartBtn = root.querySelector("#flueRestart");
  const backBtn = root.querySelector("[data-nav='flueStep2']");
  if (backBtn) backBtn.addEventListener("click", () => setView("flueStep2"));

  if (!canvas) return;
  loadImage(job.image).then((img) => {
    const drawScene = () => {
      const info = drawImageToCanvas(canvas, img);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const scale = info.scale;
      const radiusPx = ((job.flue?.diameterMm || selectedOption.diameterMm || 100) * pxPerMm * scale) / 2;
      const centerX = job.flue.x * scale;
      const centerY = job.flue.y * scale;

      ctx.fillStyle = "rgba(39, 174, 96, 0.2)";
      ctx.beginPath();
      ctx.arc(centerX, centerY, radiusPx + 150 * pxPerMm * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(231, 76, 60, 0.35)";
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radiusPx + 80 * pxPerMm * scale, -Math.PI / 4, Math.PI / 4);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "rgba(231, 76, 60, 0.85)";
      ctx.beginPath();
      ctx.arc(centerX, centerY, radiusPx, 0, Math.PI * 2);
      ctx.fill();

      job.flueObstacles.forEach((obstacle) => {
        const entry = flueObstacleKinds.find((item) => item.kind === obstacle.kind);
        ctx.fillStyle = entry?.color || "#2c3e50";
        ctx.beginPath();
        ctx.arc(obstacle.x * scale, obstacle.y * scale, 6, 0, Math.PI * 2);
        ctx.fill();
      });

      // TODO: once flues.csv rules and AI segmentation are in place:
      // - Use job.flue position + calibration to compute distances to each job.flueObstacles.
      // - Apply rule thresholds from flueOptions selected item.
      // - Build forbidden (red) and safe (green) polygons and draw instead of mock ring.

      if (statusPanel) {
        statusPanel.innerHTML = `
          <div><strong>Selected flue:</strong> ${selectedOption.brand} ${selectedOption.systemName} (${selectedOption.terminalType})</div>
          <div>Diameter: ${selectedOption.diameterMm}mm</div>
          <div class="badge-green">Ready for clearance CSV integration</div>
          <div class="hint">Red/green overlays are placeholders; distances will calculate automatically when rules land.</div>
        `;
      }
    };

    drawScene();

    arrowButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        if (!job.flue) return;
        const nudgeMm = 10;
        const nudgePx = nudgeMm * pxPerMm;
        const direction = button.dataset.direction;
        if (direction === "up") job.flue.y -= nudgePx;
        if (direction === "down") job.flue.y += nudgePx;
        if (direction === "left") job.flue.x -= nudgePx;
        if (direction === "right") job.flue.x += nudgePx;
        drawScene();
      });
    });

    if (snapshotBtn) {
      snapshotBtn.addEventListener("click", () => {
        downloadCanvasImage(canvas, "flue-overlay.png");
      });
    }
  });

  if (restartBtn) {
    restartBtn.addEventListener("click", () => {
      resetJob();
      setView("home");
    });
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error("Missing image source"));
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawImageToCanvas(canvas, image) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { scale: 1 };
  const maxWidth = Math.min(canvas.parentElement?.clientWidth || image.width, 960);
  const scale = Math.min(1, maxWidth / image.width);
  const width = image.width * scale;
  const height = image.height * scale;
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return { scale };
}

function downloadCanvasImage(canvas, filename) {
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = filename;
  link.click();
}

document.addEventListener("DOMContentLoaded", async () => {
  const tiles = document.getElementById("home-tiles");
  const yearLabel = document.getElementById("year");
  if (yearLabel) yearLabel.textContent = String(new Date().getFullYear());

  await loadBoilerModels();
  await loadFlueOptions();
  renderHome();

  if (tiles) {
    tiles.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest(".tile") : null;
      if (!(target instanceof HTMLElement)) return;
      const view = target.dataset.view;
      if (!view) return;
      if (view === "boilerStep1" || view === "flueStep1") {
        resetJob();
      }
      setView(view);
    });
  }
});
