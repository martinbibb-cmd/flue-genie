const BRAND_RULES = {
  // Values are mm edge-to-edge from obstruction to FLUE centreline + 0;
  // we will always add 50 mm (flue radius) in the geometry step.
  worcester: {
    opening: 300,
    reveal: 150,
    downpipe: 75,
    lintel: 0,
    eaves: 200,
    boundary: 600,
  },
  vaillant: { opening: 300, reveal: 150, downpipe: 75, lintel: 0, eaves: 200, boundary: 600 },
  viessmann: { opening: 300, reveal: 150, downpipe: 75, lintel: 0, eaves: 200, boundary: 600 },
  ideal: { opening: 300, reveal: 150, downpipe: 75, lintel: 0, eaves: 200, boundary: 600 },
};

const FLUE_RADIUS_MM = 50;

export default {
  async fetch(request, env, ctx) {
    try {
      const origin = request.headers.get("Origin") || "*";

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            ...cors(),
            "access-control-allow-origin": origin,
          },
        });
      }

      if (request.method !== "POST") {
        return new Response(
          JSON.stringify({ ok: true, service: "flue-genie-ai" }),
          {
            status: 200,
            headers: { ...cors(), "access-control-allow-origin": origin },
          }
        );
      }

      const url = new URL(request.url);
      const normalisedPath = url.pathname.replace(/\/+$/, "") || "/";
      const isAnalyseRequest =
        normalisedPath === "/" ||
        normalisedPath.endsWith("/analyse-flue-image") ||
        normalisedPath.endsWith("/ai/analyse-flue-image") ||
        normalisedPath.endsWith("/api/analyse-flue-image");

      if (!isAnalyseRequest) {
        return json({ error: "Unknown endpoint" }, 404, origin);
      }

      const {
        mode = "detect-only",
        brand = "worcester",
        image,
        mask,
        marks = [],
        imageWidth,
        imageHeight,
      } =
        await request.json();

      if (!image) return json({ error: "missing_image" }, 400, origin);

      if (!env?.OPENAI_API_KEY) {
        return json({ error: "missing OPENAI_API_KEY" }, 500, origin);
      }

      const MODEL = "gpt-4o-mini"; // vision-capable + affordable
      const systemText =
        "You detect precise building features for boiler flue siting from photos. " +
        "Categories: FLUE (terminal), WINDOW-OPENING (aperture), BOUNDARY/FACING-SURFACE, OTHER (gutter/downpipe/eaves/soffit). " +
        "If a rough PAINTED MASK is supplied, use it only as a hint and snap to true edges in the image. " +
        "Return only the minimal geometry needed: polygons or rects in image pixel coords, no prose.";

      const userText =
        (mode === "refine"
          ? "Refine user marks; output detected areas using the schema."
          : "Auto-detect areas; output using the schema.") +
        (marks?.length ? ` User marks: ${JSON.stringify(marks).slice(0, 1800)}` : "");

      const input = [
        {
          role: "system",
          content: [{ type: "input_text", text: systemText }],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: userText },
            { type: "input_image", image_url: { url: image } },
            ...(mask ? [{ type: "input_image", image_url: { url: mask } }] : []),
          ],
        },
      ];

      const schema = {
        name: "areas_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["areas"],
          properties: {
            areas: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["kind", "type", "points"],
                properties: {
                  label: { type: "string" },
                  kind: {
                    type: "string",
                    enum: ["flue", "window-opening", "boundary", "other"],
                  },
                  type: { type: "string", enum: ["polygon", "rect"] },
                  points: {
                    type: "array",
                    minItems: 2,
                    items: {
                      type: "object",
                      required: ["x", "y"],
                      additionalProperties: false,
                      properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                      },
                    },
                  },
                  confidence: { type: "number" },
                },
              },
            },
          },
        },
      };

      const body = {
        model: MODEL,
        input,
        response_format: { type: "json_schema", json_schema: schema },
      };

      const oai = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      const data = await oai.json().catch(() => ({}));
      if (!oai.ok) return json({ error: data }, oai.status || 502, origin);

      let areas = [];
      try {
        const content = data?.output?.[0]?.content?.[0];
        const txt = content?.text ?? content?.json ?? JSON.stringify(content ?? {});
        const parsed = typeof txt === "string" ? JSON.parse(txt) : txt;
        areas = Array.isArray(parsed?.areas) ? parsed.areas : [];
      } catch (e) {
        return json({ areas: [], error: "parse_failed", raw: data }, 502, origin);
      }

      areas = areas.filter((a) => a && Array.isArray(a.points) && a.points.length >= 2);

      let exportPayload = null;
      let exportRaw = null;

      if (mode === "refine") {
        try {
          const width = parseDimension(imageWidth);
          const height = parseDimension(imageHeight);
          const viewBoxW = width ?? 1000;
          const viewBoxH = height ?? 750;
          const rules = BRAND_RULES[brand] || BRAND_RULES.worcester;

          const { payload, raw } = buildDeterministicExports({
            areas,
            marks,
            rules,
            brand,
            width: viewBoxW,
            height: viewBoxH,
          });

          if (payload) exportPayload = payload;
          if (raw != null) exportRaw = raw;
        } catch (err) {
          exportRaw = { error: String(err) };
        }
      }

      const body = { areas };
      if (exportPayload) body.exports = exportPayload;
      if (exportRaw != null) body.exports_raw = exportRaw;

      return json(body, 200, origin);
    } catch (err) {
      return json({ error: String(err) }, 500, "*");
    }
  },
};

function parseDimension(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num);
}

function buildDeterministicExports({ areas, marks, rules, brand, width, height }) {
  const calibration = calibrateFromMarks(marks);
  const pxPerMm = calibration.ok ? calibration.pxPerMm : null;
  const rawDetails = {
    brand,
    rules,
    calibration,
    width,
    height,
    rects: [],
  };

  const rects = [];
  const ignored = [];

  if (pxPerMm) {
    const uniqueAreas = Array.isArray(areas) ? areas : [];
    uniqueAreas.forEach((area) => {
      const category = classifyArea(area);
      if (!category) {
        ignored.push({
          reason: "unclassified",
          kind: area?.kind ?? null,
          label: area?.label ?? null,
        });
        return;
      }
      const clearanceMm = rules?.[category];
      if (!Number.isFinite(clearanceMm)) {
        ignored.push({
          reason: "no_rule",
          category,
          kind: area?.kind ?? null,
          label: area?.label ?? null,
        });
        return;
      }
      const baseRect = boundingRect(area);
      if (!baseRect) {
        ignored.push({
          reason: "invalid_geometry",
          category,
          kind: area?.kind ?? null,
          label: area?.label ?? null,
        });
        return;
      }
      const expandMm = clearanceMm + FLUE_RADIUS_MM;
      const expandPx = expandMm * pxPerMm;
      const expandedRect = {
        minX: baseRect.minX - expandPx,
        minY: baseRect.minY - expandPx,
        maxX: baseRect.maxX + expandPx,
        maxY: baseRect.maxY + expandPx,
      };
      const clamped = clampRect(expandedRect, width, height);
      if (!clamped) {
        ignored.push({
          reason: "clamped_outside",
          category,
          kind: area?.kind ?? null,
          label: area?.label ?? null,
        });
        return;
      }
      const rectInfo = {
        ...clamped,
        clearanceMm,
        expandMm,
        category,
        label: area?.label ?? null,
        kind: area?.kind ?? null,
        baseRect,
      };
      rects.push(rectInfo);
      rawDetails.rects.push({
        category,
        clearanceMm,
        expandMm,
        label: area?.label ?? null,
        kind: area?.kind ?? null,
        baseRect,
        expandedRect,
        clampedRect: clamped,
      });
    });
  }

  if (!pxPerMm && calibration.reason) {
    rawDetails.reason = calibration.reason;
  }
  if (ignored.length) {
    rawDetails.ignored = ignored;
  }

  const rectElements = rects
    .map(
      (rect) =>
        `<rect x="${fmt(rect.x)}" y="${fmt(rect.y)}" width="${fmt(rect.width)}" height="${fmt(rect.height)}" />`
    )
    .join("");

  const rectGroup = rectElements
    ? `<g fill="#ff4d4d" fill-opacity="0.35" stroke="#ff4d4d" stroke-opacity="0.7" stroke-width="1">${rectElements}</g>`
    : "";

  const standardSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `${rectGroup}</svg>`;

  const plumeSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#e6f9e6" />` +
    `${rectGroup}</svg>`;

  const notesParts = [];
  if (pxPerMm) {
    notesParts.push(
      `Calibrated at ${pxPerMm.toFixed(3)} px/mm using the 100 mm flue reference (radius ≈ ${calibration.radiusPx.toFixed(
        2
      )} px).`
    );
    notesParts.push(
      `Applied ${rects.length} clearance zone${rects.length === 1 ? "" : "s"} using ${titleCase(
        brand
      )} rules.`
    );
  } else {
    notesParts.push(
      `Unable to calibrate pixel size from the flue mark${calibration.reason ? `: ${calibration.reason}` : ""}.`
    );
  }

  return {
    payload: {
      standard_svg: standardSvg,
      plume_svg: plumeSvg,
      notes: notesParts.join(" ").trim() || "No additional notes.",
    },
    raw: rawDetails,
  };
}

function calibrateFromMarks(marks) {
  if (!Array.isArray(marks) || !marks.length) {
    return { ok: false, reason: "no flue ellipse supplied" };
  }
  const flueEllipse = marks.find(
    (mark) => mark && mark.kind === "flue" && mark.type === "ellipse"
  );
  if (!flueEllipse) {
    return { ok: false, reason: "flue ellipse mark missing" };
  }
  const rx = parseNumber(flueEllipse.rx);
  const ry = parseNumber(flueEllipse.ry);
  if (rx == null || ry == null) {
    return { ok: false, reason: "invalid ellipse radii" };
  }
  const avgRadiusPx = (Math.abs(rx) + Math.abs(ry)) / 2;
  if (!avgRadiusPx) {
    return { ok: false, reason: "zero ellipse radius" };
  }
  const pxPerMm = avgRadiusPx / FLUE_RADIUS_MM; // 100 mm diameter -> 50 mm radius
  return {
    ok: true,
    pxPerMm,
    mmPerPx: 1 / pxPerMm,
    radiusPx: avgRadiusPx,
    mark: flueEllipse,
    flueRadiusMm: FLUE_RADIUS_MM,
  };
}

function classifyArea(area) {
  if (!area) return null;
  const label = typeof area.label === "string" ? area.label.toLowerCase() : "";
  switch (area.kind) {
    case "window-opening":
      if (label.includes("lintel")) return "lintel";
      if (label.includes("reveal") || label.includes("frame") || label.includes("jamb")) return "reveal";
      return "opening";
    case "other":
      if (label.includes("lintel")) return "lintel";
      if (label.includes("reveal") || label.includes("frame") || label.includes("jamb")) return "reveal";
      if (
        label.includes("downpipe") ||
        label.includes("pipe") ||
        label.includes("soil") ||
        label.includes("rainwater") ||
        label.includes("gutter")
      ) {
        return "downpipe";
      }
      if (label.includes("eaves") || label.includes("soffit")) return "eaves";
      return null;
    case "boundary":
      return "boundary";
    default:
      return null;
  }
}

function boundingRect(area) {
  const points = Array.isArray(area?.points) ? area.points : [];
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach((p) => {
    const x = parseNumber(p?.x);
    const y = parseNumber(p?.y);
    if (x == null || y == null) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

function clampRect(rect, width, height) {
  let { minX, minY, maxX, maxY } = rect;
  if (Number.isFinite(width)) {
    minX = Math.max(0, minX);
    maxX = Math.min(width, maxX);
  }
  if (Number.isFinite(height)) {
    minY = Math.max(0, minY);
    maxY = Math.min(height, maxY);
  }
  const clampedWidth = maxX - minX;
  const clampedHeight = maxY - minY;
  if (clampedWidth <= 0 || clampedHeight <= 0) return null;
  return {
    x: minX,
    y: minY,
    width: clampedWidth,
    height: clampedHeight,
    maxX,
    maxY,
  };
}

function parseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function fmt(n) {
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function titleCase(str) {
  if (typeof str !== "string" || !str.length) return "Unknown";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function cors() {
  return {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST,GET,OPTIONS",
  };
}

function json(obj, status = 200, origin = "*") {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors(), "access-control-allow-origin": origin },
  });
}
