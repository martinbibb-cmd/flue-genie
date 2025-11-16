// Simple demo overlay drawing using the calibration scale.
// Replace this with your real boiler / flue overlay logic.

(function () {
  function clearOverlay(ctx, canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawCardOutline(ctx, cardCorners) {
    if (!cardCorners) return;
    const { tl, tr, br, bl } = cardCorners;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#00ff88";
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // Example boiler rectangle:
  // 400mm wide x 700mm tall, 50mm above the card and horizontally centred.
  function drawDemoBoiler(ctx, cardCorners, pxPerMm) {
    if (!cardCorners || !pxPerMm) return;
    const { tl, tr, bl } = cardCorners;

    // Card centre in pixel space (midpoint of top+bottom)
    const cardCenterX = (tl.x + tr.x + bl.x + (bl.x + (tr.x - tl.x))) / 4;

    const boilerWidthMm = 400;
    const boilerHeightMm = 700;
    const offsetAboveCardMm = 50;

    const widthPx = boilerWidthMm * pxPerMm;
    const heightPx = boilerHeightMm * pxPerMm;
    const offsetPx = offsetAboveCardMm * pxPerMm;

    const x = cardCenterX - widthPx / 2;
    const y = tl.y - offsetPx - heightPx;

    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 255, 0, 0.9)";
    ctx.fillStyle = "rgba(0, 255, 0, 0.15)";
    ctx.beginPath();
    ctx.rect(x, y, widthPx, heightPx);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  window.IDOverlay = {
    clearOverlay,
    drawCardOutline,
    drawDemoBoiler,
  };
})();
