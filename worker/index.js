const BRAND_RULES = {
  worcester: { opening: 300, fabric: 150, gutter: 75, eaves: 200, boundary: 600 },
  vaillant: { opening: 300, fabric: 150, gutter: 75, eaves: 200, boundary: 600 },
  viessmann: { opening: 300, fabric: 150, gutter: 75, eaves: 200, boundary: 600 },
  ideal: { opening: 300, fabric: 150, gutter: 75, eaves: 200, boundary: 600 },
};

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
        existingAreas = [],
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
          const width = Number.isFinite(Number(imageWidth)) && Number(imageWidth) > 0
            ? Math.round(Number(imageWidth))
            : null;
          const height = Number.isFinite(Number(imageHeight)) && Number(imageHeight) > 0
            ? Math.round(Number(imageHeight))
            : null;
          const viewBoxW = width ?? 1000;
          const viewBoxH = height ?? 750;
          const rules = BRAND_RULES[brand] || null;
          const areaSnippet = JSON.stringify({
            existingAreas,
            refinedAreas: areas,
            marks,
          }).slice(0, 7000);

          const exportSystemText =
            "You return ONLY valid JSON. Create two SVG overlays sized to the input image: a 'Standard terminal' map and a 'Plume kit' map. Use red shapes for no-go, green for safe areas, and a small black circle for a suggested terminal position. No prose, no markdown fences.";

          const userContent = [
            {
              type: "input_text",
              text: `Return a JSON object with keys: standard_svg (string), plume_svg (string), notes (string). The SVGs must include viewBox='0 0 ${viewBoxW} ${viewBoxH}' and be fully self-contained.`,
            },
            {
              type: "input_text",
              text: rules
                ? `Brand clearance rules (mm): ${JSON.stringify(rules)}.`
                : "Brand clearance rules unknown; use reasonable assumptions and explain them in notes.",
            },
            {
              type: "input_text",
              text: `Image width: ${width ?? "unknown"}, height: ${height ?? "unknown"}.`,
            },
            {
              type: "input_text",
              text: `Detected areas JSON (truncated): ${areaSnippet}`,
            },
            { type: "input_text", text: "Notes should explain key decisions in <= 3 sentences." },
            { type: "input_text", text: "JSON only." },
            { type: "input_image", image_url: { url: image } },
            ...(mask ? [{ type: "input_image", image_url: { url: mask } }] : []),
          ];

          const exportInput = [
            { role: "system", content: [{ type: "input_text", text: exportSystemText }] },
            { role: "user", content: userContent },
          ];

          const exportBody = {
            model: MODEL,
            input: exportInput,
            response_format: { type: "json_object" },
          };

          const exportRes = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify(exportBody),
          });

          const exportJson = await exportRes.json().catch(() => ({}));
          if (!exportRes.ok) {
            exportRaw = exportJson;
          } else {
            const expContent = exportJson?.output?.[0]?.content?.[0];
            const expText = expContent?.text ?? expContent?.json ?? JSON.stringify(expContent ?? {});
            exportRaw = typeof expText === "string" ? expText : JSON.stringify(expText);
            try {
              exportPayload = typeof expText === "string" ? JSON.parse(expText) : expText;
            } catch (err) {
              exportPayload = null;
            }
          }
        } catch (err) {
          exportRaw = String(err);
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
