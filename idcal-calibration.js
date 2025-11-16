// ID card calibration logic
// Assumes a standard ID-1 card: 86mm x 54mm

(function () {
  const CARD_WIDTH_MM = 86;
  const CARD_HEIGHT_MM = 54;

  // global-ish state, shared with main/overlay via window
  const calibState = {
    scalePxPerMm: null,
    cardCorners: null, // { tl:{x,y}, tr:{x,y}, br:{x,y}, bl:{x,y} }
  };

  function getCalibState() {
    return calibState;
  }

  // ---------- Utility helpers ----------

  function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function computeScaleFromCorners(cardCorners) {
    const { tl, tr, br, bl } = cardCorners;
    const top = distance(tl, tr);
    const bottom = distance(bl, br);
    const left = distance(tl, bl);
    const right = distance(tr, br);

    const widthPx = (top + bottom) / 2;
    const heightPx = (left + right) / 2;

    const pxPerMmX = widthPx / CARD_WIDTH_MM;
    const pxPerMmY = heightPx / CARD_HEIGHT_MM;

    const pxPerMm = (pxPerMmX + pxPerMmY) / 2;

    calibState.scalePxPerMm = pxPerMm;
    calibState.cardCorners = cardCorners;

    try {
      localStorage.setItem("idcal_scalePxPerMm", String(pxPerMm));
    } catch (e) {
      // ignore
    }

    return pxPerMm;
  }

  // ---------- Auto detection ----------
  // NOTE: very simple heuristic:
  // - Downscale the image
  // - Look for the largest blob of highly-saturated, mid-bright pixels
  // - Treat its bounding box as the card
  // Works best if the reference card is a bright solid colour (red, green, blue).

  function detectCardCornersFromCanvas(baseCanvas) {
    const w = baseCanvas.width;
    const h = baseCanvas.height;
    if (!w || !h) return null;

    const sampleW = 200;
    const sampleH = Math.round((h / w) * sampleW);

    const off = document.createElement("canvas");
    off.width = sampleW;
    off.height = sampleH;
    const octx = off.getContext("2d");
    octx.drawImage(baseCanvas, 0, 0, sampleW, sampleH);

    const img = octx.getImageData(0, 0, sampleW, sampleH);
    const data = img.data;

    let minX = sampleW,
      maxX = -1,
      minY = sampleH,
      maxY = -1;
    let count = 0;

    for (let y = 0; y < sampleH; y++) {
      for (let x = 0; x < sampleW; x++) {
        const idx = (y * sampleW + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max === 0 ? 0 : (max - min) / max;
        const val = max / 255;

        // Heuristic thresholds: fairly bright, quite saturated
        if (sat > 0.4 && val > 0.35 && val < 0.95) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          count++;
        }
      }
    }

    if (count === 0 || maxX <= minX || maxY <= minY) {
      return null;
    }

    // Area sanity check: at least 0.5% of sampled image
    const area = (maxX - minX) * (maxY - minY);
    if (area < 0.005 * sampleW * sampleH) {
      return null;
    }

    // Aspect ratio check – allow some perspective distortion
    const wPx = maxX - minX;
    const hPx = maxY - minY;
    const aspect = wPx / hPx; // should be about 86/54 ≈ 1.59
    if (aspect < 1.1 || aspect > 2.1) {
      // not card-like
      return null;
    }

    // Map to full-res coordinates
    const scaleX = w / sampleW;
    const scaleY = h / sampleH;

    const tl = { x: minX * scaleX, y: minY * scaleY };
    const tr = { x: maxX * scaleX, y: minY * scaleY };
    const br = { x: maxX * scaleX, y: maxY * scaleY };
    const bl = { x: minX * scaleX, y: maxY * scaleY };

    return { tl, tr, br, bl };
  }

  // ---------- Manual tapping mode ----------

  function startManualCornerTap(overlayCanvas, onDone, onCancel, drawGuide) {
    const points = [];
    const rect = overlayCanvas.getBoundingClientRect();
    const ctx = overlayCanvas.getContext("2d");

    function drawPoints() {
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      if (typeof drawGuide === "function") {
        drawGuide(ctx);
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#00ff88";
      ctx.fillStyle = "#00ff88";

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      if (points.length === 4) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        ctx.lineTo(points[2].x, points[2].y);
        ctx.lineTo(points[3].x, points[3].y);
        ctx.closePath();
        ctx.stroke();
      }
    }

    function handleClick(ev) {
      const x = ((ev.clientX - rect.left) / rect.width) * overlayCanvas.width;
      const y = ((ev.clientY - rect.top) / rect.height) * overlayCanvas.height;
      points.push({ x, y });
      drawPoints();

      if (points.length === 4) {
        overlayCanvas.removeEventListener("click", handleClick);
        const cardCorners = {
          tl: points[0],
          tr: points[1],
          br: points[2],
          bl: points[3],
        };
        const scale = computeScaleFromCorners(cardCorners);
        if (typeof onDone === "function") {
          onDone(scale, cardCorners);
        }
      }
    }

    function cancel() {
      overlayCanvas.removeEventListener("click", handleClick);
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      if (typeof onCancel === "function") {
        onCancel();
      }
    }

    overlayCanvas.addEventListener("click", handleClick);

    return { cancel };
  }

  // ---------- Expose API on window ----------

  window.IDCalib = {
    CARD_WIDTH_MM,
    CARD_HEIGHT_MM,
    getCalibState,
    computeScaleFromCorners,
    detectCardCornersFromCanvas,
    startManualCornerTap,
  };

  // Load saved scale if present
  try {
    const saved = localStorage.getItem("idcal_scalePxPerMm");
    if (saved) {
      calibState.scalePxPerMm = parseFloat(saved);
    }
  } catch (e) {
    // ignore
  }
})();
