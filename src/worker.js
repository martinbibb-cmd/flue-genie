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

    // main endpoint
    if (
      request.method === "POST" &&
      (url.pathname === "/" || url.pathname === "/analyse-flue-image")
    ) {
      const body = await request.json().catch(() => ({}));
      const imageDataUrl = body.image;
      const measurements = body.measurements || [];
      const mode = body.mode || "zones";

      // no image → return empty
      if (!imageDataUrl) {
        return json({ areas: [], error: "no-image" });
      }

      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "You detect building elements that affect boiler flue clearances: window openings, doors, gutters/downpipes, eaves/soffits, and near-wall obstructions. " +
                  "Return ONLY JSON of the form {\"areas\":[...]} where each area has: " +
                  "{type:'polygon'|'line', label:string, zone:'no-go'|'safe'|'plume', points:[{x,y}...], confidence:number}."
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text:
                      mode === "detect-only"
                        ? "Detect and label windows/doors, gutters/downpipes, and eaves in this photo."
                        : "Highlight parts of this photo that are too close to the flue. These are the local app measurements (actual < required means it failed): " +
                          JSON.stringify(measurements) +
                          ". Mark those as 'no-go'. If a plume kit could solve it, mark that area as 'plume'."
                  },
                  {
                    type: "image_url",
                    image_url: { url: imageDataUrl }
                  }
                ]
              }
            ]
          })
        });

        const jsonRes = await res.json();

        if (!res.ok) {
          // show the actual error to the frontend
          return json({ areas: [], error: jsonRes });
        }

        const content = jsonRes?.choices?.[0]?.message?.content;
        let parsed;
        try {
          parsed = typeof content === "string" ? JSON.parse(content) : content || {};
        } catch (_e) {
          parsed = { areas: [] };
        }

        const areas = Array.isArray(parsed.areas) ? parsed.areas : [];
        return json({ areas });
      } catch (err) {
        return json({ areas: [], error: String(err) });
      }
    }

    // unknown route
    return new Response("Not found", { status: 404 });
  }
};

function json(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
