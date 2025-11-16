(function () {
  const photoInput = document.getElementById("photoInput");
  const btnCalibrate = document.getElementById("btnCalibrate");
  const calStatus = document.getElementById("calStatus");

  const photoCanvas = document.getElementById("photoCanvas");
  const overlayCanvas = document.getElementById("overlayCanvas");
  const photoCtx = photoCanvas.getContext("2d");
  const overlayCtx = overlayCanvas.getContext("2d");

  const calModal = document.getElementById("calModal");
  const btnAutoDetect = document.getElementById("btnAutoDetect");
  const btnManualCorners = document.getElementById("btnManualCorners");
  const btnCloseModal = document.getElementById("btnCloseModal");

  const tapHint = document.getElementById("tapHint");
  const btnCancelTap = document.getElementById("btnCancelTap");

  let currentImage = null;
  let tapSession = null;

  function updateStatus(text, ok) {
    calStatus.textContent = text;
    calStatus.style.color = ok ? "#6ee7b7" : "#f97373";
  }

  function resizeCanvasesToImage(img) {
    // Use the image's natural size for the internal canvas pixels
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    photoCanvas.width = w;
    photoCanvas.height = h;
    overlayCanvas.width = w;
    overlayCanvas.height = h;

    // CSS width is set via stylesheet to 100%, so both canvases scale together visually.
  }

  function drawImageToCanvas(img) {
    resizeCanvasesToImage(img);
    photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
    photoCtx.drawImage(img, 0, 0, photoCanvas.width, photoCanvas.height);

    IDOverlay.clearOverlay(overlayCtx, overlayCanvas);

    const state = IDCalib.getCalibState();
    if (state.scalePxPerMm && state.cardCorners) {
      IDOverlay.drawCardOutline(overlayCtx, state.cardCorners);
      IDOverlay.drawDemoBoiler(
        overlayCtx,
        state.cardCorners,
        state.scalePxPerMm
      );
      updateStatus(
        `Scale: ${state.scalePxPerMm.toFixed(3)} px/mm (loaded)`,
        true
      );
    } else {
      updateStatus("Not calibrated", false);
    }
  }

  // ---------- Image loading ----------

  photoInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      drawImageToCanvas(img);
      btnCalibrate.disabled = false;
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      updateStatus("Failed to load image", false);
    };
    img.src = url;
  });

  // ---------- Modal handling ----------

  function openModal() {
    if (!currentImage) return;
    calModal.classList.remove("hidden");
  }

  function closeModal() {
    calModal.classList.add("hidden");
  }

  btnCalibrate.addEventListener("click", openModal);
  btnCloseModal.addEventListener("click", closeModal);

  // ---------- Auto-detect calibration ----------

  btnAutoDetect.addEventListener("click", () => {
    closeModal();
    if (!currentImage) return;

    const corners = IDCalib.detectCardCornersFromCanvas(photoCanvas);
    if (!corners) {
      updateStatus("Auto-detect failed – try manual taps.", false);
      return;
    }

    const scale = IDCalib.computeScaleFromCorners(corners);

    IDOverlay.clearOverlay(overlayCtx, overlayCanvas);
    IDOverlay.drawCardOutline(overlayCtx, corners);
    IDOverlay.drawDemoBoiler(overlayCtx, corners, scale);

    updateStatus(`Calibrated (auto): ${scale.toFixed(3)} px/mm`, true);
  });

  // ---------- Manual corner-tap calibration ----------

  btnManualCorners.addEventListener("click", () => {
    closeModal();
    if (!currentImage) return;

    if (tapSession && tapSession.cancel) {
      tapSession.cancel();
    }

    tapHint.classList.remove("hidden");

    tapSession = IDCalib.startManualCornerTap(
      overlayCanvas,
      (scale, cardCorners) => {
        tapHint.classList.add("hidden");
        IDOverlay.clearOverlay(overlayCtx, overlayCanvas);
        IDOverlay.drawCardOutline(overlayCtx, cardCorners);
        IDOverlay.drawDemoBoiler(overlayCtx, cardCorners, scale);
        updateStatus(`Calibrated (manual): ${scale.toFixed(3)} px/mm`, true);
      },
      () => {
        tapHint.classList.add("hidden");
        updateStatus("Manual calibration cancelled", false);
      },
      (ctx) => {
        // Optional visual guide: faint “card sized” rectangle in the centre.
        const w = overlayCanvas.width;
        const h = overlayCanvas.height;
        const cardAspect = IDCalib.CARD_WIDTH_MM / IDCalib.CARD_HEIGHT_MM;
        let guideW = w * 0.35;
        let guideH = guideW / cardAspect;

        if (guideH > h * 0.6) {
          guideH = h * 0.6;
          guideW = guideH * cardAspect;
        }

        const gx = (w - guideW) / 2;
        const gy = (h - guideH) / 2;

        ctx.save();
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 2;
        ctx.strokeRect(gx, gy, guideW, guideH);
        ctx.restore();
      }
    );
  });

  btnCancelTap.addEventListener("click", () => {
    if (tapSession && tapSession.cancel) {
      tapSession.cancel();
    }
    tapHint.classList.add("hidden");
  });

  // ---------- Initial status ----------
  const initial = IDCalib.getCalibState();
  if (initial.scalePxPerMm) {
    updateStatus(
      `Saved scale available (${initial.scalePxPerMm.toFixed(3)} px/mm) – load a photo to use it.`,
      true
    );
  } else {
    updateStatus("Load a photo, then calibrate with your card.", false);
  }
})();
