export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    // --- handle POST to /analyse-flue-image or /
    if (
      request.method === "POST" &&
      (url.pathname === "/" || url.pathname === "/analyse-flue-image")
    ) {
      const body = await request.json().catch(() => ({}));

      // 🔧 replace this with your real AI logic later
      const fake = {
        areas: [
          {
            type: "polygon",
            label: "AI test box (fake detection)",
            rule: "window-opening",
            points: [
              { x: 220, y: 160 },
              { x: 360, y: 160 },
              { x: 360, y: 260 },
              { x: 220, y: 260 }
            ],
            confidence: 0.9
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

    // --- anything else → 404
    return new Response(JSON.stringify({ error: "Unknown endpoint" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};
