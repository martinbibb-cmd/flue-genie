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

    // Accept POST to / or /analyse-flue-image
    if (
      request.method === "POST" &&
      (url.pathname === "/" || url.pathname === "/analyse-flue-image")
    ) {
      const body = await request.json().catch(() => ({}));

      // temporary echo so we can confirm from the app
      return new Response(JSON.stringify({
        ok: true,
        received: body
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // everything else
    return new Response(JSON.stringify({ error: "Unknown endpoint" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};
