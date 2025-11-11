function toPointArray(points) {
  if (!Array.isArray(points)) return [];
  return points
    .map(point => ({
      x: typeof point.x === "number" ? point.x : Number(point.x),
      y: typeof point.y === "number" ? point.y : Number(point.y)
    }))
    .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y));
}

function boundsForPoints(points) {
  if (!points || points.length === 0) return null;
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  points.forEach(pt => {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  });
  return { minX, minY, maxX, maxY };
}

function polygonFromBounds(bounds) {
  if (!bounds) return [];
  const { minX, minY, maxX, maxY } = bounds;
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY }
  ];
}

function labelForKind(kind) {
  switch (kind) {
    case "window-opening":
      return "Window";
    case "window-fabric":
      return "Window fabric";
    case "gutter":
      return "Gutter";
    case "eaves":
      return "Eaves";
    case "boundary":
      return "Boundary";
    default:
      return "Object";
  }
}

function buildAreas(body) {
  const areas = [];
  const roughPoints = toPointArray(body.rough);
  if (roughPoints.length >= 2) {
    const bounds = boundsForPoints(roughPoints);
    const polygon = polygonFromBounds(bounds);
    if (polygon.length) {
      areas.push({
        type: "polygon",
        label: "Window (rough)",
        zone: "alert",
        confidence: 0.6,
        points: polygon
      });
    }
  }

  if (body.mode === "detect-only" && areas.length === 0) {
    const shapes = Array.isArray(body.shapes) ? body.shapes : [];
    shapes.forEach(shape => {
      const pts = toPointArray(shape.points);
      if (pts.length >= 3) {
        areas.push({
          type: "polygon",
          label: labelForKind(shape.kind),
          zone: "alert",
          confidence: 0.5,
          points: pts
        });
      }
    });
  }

  return areas;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    const normalisedPath = url.pathname.replace(/\/+$/, "") || "/";

    const isAnalyseRequest =
      normalisedPath === "/" ||
      normalisedPath.endsWith("/analyse-flue-image") ||
      normalisedPath.endsWith("/ai/analyse-flue-image") ||
      normalisedPath.endsWith("/api/analyse-flue-image");

    // Handle POST requests for analyse endpoints (with or without trailing slash)
    if (request.method === "POST" && isAnalyseRequest) {
      const body = await request.json().catch(() => ({}));
      const areas = buildAreas(body);

      return new Response(JSON.stringify({
        ok: true,
        areas,
        received: body
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // Fallback 404
    return new Response(JSON.stringify({ error: "Unknown endpoint" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};
