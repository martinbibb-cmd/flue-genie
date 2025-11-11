export default {
  async fetch(request, env, ctx) {
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

    const url = new URL(request.url);

    if (
      request.method === "POST" &&
      (url.pathname === "/" || url.pathname === "/analyse-flue-image")
    ) {
      const body = await request.json().catch(() => ({}));

      // TODO: call your real AI here

      const fake = {
        areas: [
          {
            type: "polygon",
            label: "AI: window opening (300mm)",
            rule: "window-opening",
            points: [
              { x: 200, y: 150 },
              { x: 360, y: 150 },
              { x: 360, y: 280 },
              { x: 200, y: 280 }
            ],
            confidence: 0.9
          },
          {
            type: "line",
            label: "AI: eaves (200mm)",
            rule: "eaves",
            points: [
              { x: 80, y: 110 },
              { x: 600, y: 110 }
            ],
            confidence: 0.85
          }
        ]
      };

      return new Response(JSON.stringify(fake), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: {
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    return new Response("Not found", {
      status: 404,
      headers: {
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};
