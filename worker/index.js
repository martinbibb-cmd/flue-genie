const MODEL = "gpt-4.1-mini";

function json(body, status = 200, origin = "*") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": origin
    }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    const url = new URL(request.url);
    const normalisedPath = url.pathname.replace(/\/+$/, "") || "/";
    const isAnalyseRequest =
      normalisedPath === "/" ||
      normalisedPath.endsWith("/analyse-flue-image") ||
      normalisedPath.endsWith("/ai/analyse-flue-image") ||
      normalisedPath.endsWith("/api/analyse-flue-image");

    if (request.method === "POST" && isAnalyseRequest) {
      let body = {};
      try {
        body = await request.json();
      } catch (err) {
        console.warn("Failed to parse JSON body", err);
      }

      const { image, mask, mode = "detect-only", marks = [] } = body || {};
      if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
        return json({ error: "image dataURL required" }, 400, origin);
      }

      if (!env?.OPENAI_API_KEY) {
        return json({ error: "missing OPENAI_API_KEY" }, 500, origin);
      }

      const SYSTEM =
        "You detect precise building features for boiler flue siting. " +
        "You receive a photo and an optional PAINTED MASK. In the mask: " +
        "RED = FLUE (user’s rough flue location); YELLOW = OPENING (window/door aperture); " +
        "BLUE = BOUNDARY/FACING SURFACE; GREEN = OTHER (gutter/downpipe/eaves/soffit). " +
        "Use the mask only as a hint; snap to exact edges in the photo. " +
        "Return STRICT JSON: {\"areas\":[{label:string, kind:\"flue\"|\"window-opening\"|\"boundary\"|\"other\", type:\"polygon\"|\"rect\", points:[{x,y}], confidence:number}]}";

      const userText =
        (mode === "refine"
          ? "Refine user marks, adjust to exact edges."
          : "Auto-detect objects.") +
        (marks.length ? ` User marks JSON (optional): ${JSON.stringify(marks).slice(0, 1800)}` : "");

      const content = [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: image } }
      ];
      if (mask) {
        content.push({ type: "image_url", image_url: { url: mask } });
      }

      const oaiReq = {
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content }
        ]
      };

      let openaiResponse;
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${env.OPENAI_API_KEY}`
          },
          body: JSON.stringify(oaiReq)
        });
        openaiResponse = await res.json();
        if (!res.ok) {
          return json({ areas: [], error: openaiResponse }, 502, origin);
        }
      } catch (err) {
        console.error("OpenAI request failed", err);
        return json({ areas: [], error: "openai_request_failed" }, 502, origin);
      }

      let parsed = {};
      try {
        parsed = JSON.parse(openaiResponse?.choices?.[0]?.message?.content || "{}");
      } catch (err) {
        console.warn("Failed to parse OpenAI JSON", err);
      }

      let areas = Array.isArray(parsed.areas) ? parsed.areas : [];
      areas = areas.filter(area => Array.isArray(area.points) && area.points.length >= 2);

      return json({ areas }, 200, origin);
    }

    return json({ error: "Unknown endpoint" }, 404, origin);
  }
};

