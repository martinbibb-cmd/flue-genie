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

    // accept POST to / and /analyse-flue-image
    if (
      request.method === "POST" &&
      (url.pathname === "/" || url.pathname === "/analyse-flue-image")
    ) {
      const body = await request.json().catch(() => ({}));

      const imageDataUrl = body.image; // canvas.toDataURL(...) from your app
      const measurements = body.measurements; // you added this on the frontend
      const rules = body.rules || {};

      // If no image, just return empty
      if (!imageDataUrl) {
        return new Response(JSON.stringify({ areas: [] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }

      // call OpenAI
      try {
        const oaRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "You detect building features that affect boiler flue clearances. " +
                  "Return JSON with an array named 'areas'. Each area must have: " +
                  "{type: 'polygon'|'line', label: string, points: [{x,y}...], confidence: number} " +
                  "Coordinates must be in the SAME pixel space as the supplied image."
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text:
                      "Find nearby openings (windows/doors), gutters/pipes, eaves/soffits, " +
                      "and anything else the flue has to clear. " +
                      "If the flue is clearly too close to something, add an area for it."
                  },
                  {
                    type: "text",
                    text:
                      "Existing app measurements (actual vs required): " +
                      JSON.stringify(measurements || []) +
                      ". Use these to prioritise which areas to return."
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

        const oaJson = await oaRes.json();

        // Expect model to return a JSON object
        const content = oaJson.choices?.[0]?.message?.content;
        const parsed = typeof content === "string" ? JSON.parse(content) : content;

        // Normalize: ensure we always return { areas: [...] }
        const areas = Array.isArray(parsed?.areas) ? parsed.areas : [];

        return new Response(JSON.stringify({ areas }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch (err) {
        // fallback: return empty but with error message
        return new Response(
          JSON.stringify({
            areas: [],
            error: String(err)
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }
    }

    // unknown route
    return new Response(JSON.stringify({ error: "Unknown endpoint" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};
