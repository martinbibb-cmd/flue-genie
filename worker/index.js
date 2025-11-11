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
