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

const MODEL = "gpt-4.1-mini";

function buildAreas(body) {
  const areas = [];

  const shapes = Array.isArray(body.shapes) ? body.shapes : [];
  shapes.forEach(shape => {
    const pts = toPointArray(shape.points);
    if (pts.length >= 2) {
      areas.push({
        type: pts.length > 2 ? "polygon" : "line",
        label: labelForKind(shape.kind),
        kind: shape.kind,
        zone: "alert",
        points: pts
      });
    }
  });

  const roughPoints = toPointArray(body.rough);
  if (roughPoints.length >= 2) {
    const bounds = boundsForPoints(roughPoints);
    const polygon = polygonFromBounds(bounds);
    if (polygon.length) {
      areas.push({
        type: "polygon",
        label: "Rough area",
        kind: "rough",
        zone: "alert",
        points: polygon
      });
    }
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

      const { image, mask, mode = "detect-only", marks = [], measurements = [] } = body || {};
      const userText =
        (mode === "refine"
          ? "Refine user marks and add missing objects. "
          : "Auto-detect relevant objects. ") +
        (mask
          ? "Use the second image as an attention mask: GREEN = focus regions (prefer detect there), RED = ignore/low priority regions, BLUE = proposed plume path. "
          : "") +
        "Return JSON only under key 'areas' with polygon points in image pixels.";

      const content = [
        {
          type: "text",
          text:
            userText +
            (marks?.length ? `\nUser marks: ${JSON.stringify(marks).slice(0, 1800)}` : "") +
            (measurements?.length ? `\nMeasurements: ${JSON.stringify(measurements).slice(0, 1800)}` : "")
        },
        { type: "image_url", image_url: { url: image } }
      ];
      if (mask) {
        content.push({ type: "image_url", image_url: { url: mask } });
      }

      const oaiReq = {
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Detect window openings, window fabric, gutters/downpipes, and eaves/soffits for boiler flue siting. " +
              "Return {\"areas\":[{label,type,points:[{x,y}],confidence,zone?}]} ONLY. " +
              "If a plume kit route is obvious adjacent to the terminal, include a 'zone':'plume' region approx where the outlet could terminate."
          },
          { role: "user", content }
        ]
      };

      return new Response(JSON.stringify({
        ok: true,
        areas,
        received: body,
        prompt: {
          userText,
          contentLength: content.length,
          includesMask: Boolean(mask),
          mode
        },
        openaiRequest: oaiReq
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
