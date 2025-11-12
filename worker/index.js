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
        "[json] You detect precise building features for boiler flue siting. " +
        "You are given a photo and an optional PAINTED MASK with CATEGORY COLOURS: " +
        "RED=flue, YELLOW=opening (window/door aperture), BLUE=boundary/facing surface, GREEN=other (gutter/downpipe/eaves). " +
        "Use the mask as a hint and snap to exact edges. " +
        "Respond in valid json only, exactly: " +
        '{"areas":[{"label":string,"kind":"flue"|"window-opening"|"boundary"|"other","type":"polygon"|"rect","points":[{"x":number,"y":number}],"confidence":number}]}';

      const userText =
        (mode === "refine"
          ? "[json] Refine user marks and return strict json only."
          : "[json] Auto-detect objects and return strict json only.") +
        (marks?.length ? ` User marks (json): ${JSON.stringify(marks).slice(0, 1800)}` : "");

      const content = [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: image } }
      ];
      if (mask) {
        content.push({ type: "image_url", image_url: { url: mask } });
      }

      const baseReq = {
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content }
        ],
        response_format: { type: "json_object" }
      };

      async function callOpenAI(req) {
        try {
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${env.OPENAI_API_KEY}`
            },
            body: JSON.stringify(req)
          });
          const body = await res.json().catch(() => ({}));
          return { ok: res.ok, body };
        } catch (err) {
          console.error("OpenAI request failed", err);
          return { ok: false, body: { message: "openai_request_failed" } };
        }
      }

      let oai = await callOpenAI(baseReq);

      if (
        !oai.ok &&
        (oai.body?.type === "invalid_request_error" || /json/i.test(oai.body?.message || ""))
      ) {
        const retryReq = { ...baseReq };
        delete retryReq.response_format;
        const retryContent = [
          { type: "text", text: `${userText} Output ONLY the json object.` },
          { type: "image_url", image_url: { url: image } }
        ];
        if (mask) {
          retryContent.push({ type: "image_url", image_url: { url: mask } });
        }
        retryReq.messages = [
          { role: "system", content: `${SYSTEM} Return ONLY json text with no prose.` },
          { role: "user", content: retryContent }
        ];
        oai = await callOpenAI(retryReq);
      }

      if (!oai.ok) {
        return json({ areas: [], error: oai.body || { message: "openai_failed" } }, 502, origin);
      }

      let parsed = {};
      try {
        parsed = JSON.parse(oai.body?.choices?.[0]?.message?.content || "{}");
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

