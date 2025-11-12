function json(obj, status = 200, origin = "*") {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "content-type,x-flue-sig",
      "access-control-allow-methods": "POST,OPTIONS"
    }
  });
}

function originAllowed(req, allowed) {
  const o = req.headers.get("origin") || "";
  if (allowed === "*" || !allowed) return "*";
  const list = allowed.split(",").map(s => s.trim());
  return list.includes(o) ? o : null;
}

async function verifyHmac(request, secret) {
  // Protects the endpoint even if the URL is known.
  // Frontend must send header x-flue-sig = HMAC_SHA256(body, HMAC_SECRET) hex
  if (!secret) return true; // disable if not set
  const sig = request.headers.get("x-flue-sig") || "";
  const body = await request.clone().text();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2,"0")).join("");
  return crypto.timingSafeEqual(
    new TextEncoder().encode(hex),
    new TextEncoder().encode(sig)
  );
}

export default {
  async fetch(request, env) {
    const allowedOrigin = originAllowed(request, env.ALLOWED_ORIGENS ?? env.ALLOWED_ORIGINS);
    if (request.method === "OPTIONS") return json({}, 200, allowedOrigin || "*");

    if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405, allowedOrigin || "*");

    if (!allowedOrigin) return json({ error: "CORS blocked" }, 403);

    // HMAC auth (set HMAC_SECRET in Secrets)
    if (!(await verifyHmac(request, env.HMAC_SECRET))) return json({ error: "Bad signature" }, 401, allowedOrigin);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, allowedOrigin); }

    // Guard rails
    const dataUrl = body.image || "";
    if (!dataUrl.startsWith("data:image/")) return json({ error: "image data URL required" }, 400, allowedOrigin);
    if (dataUrl.length > 1_500_000) return json({ error: "image too large" }, 413, allowedOrigin);

    // ---- REAL AI CALL (OpenAI) ----
    try {
      const oai = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Detect window openings, gutters/downpipes, eaves/soffits. Return {\"areas\":[{label, type, points:[{x,y}], confidence}]} only." },
            { role: "user", content: [
              { type: "text", text: "Find the relevant building features in this image." },
              { type: "image_url", image_url: { url: dataUrl } }
            ]}
          ]
        })
      });
      const j = await oai.json();
      if (!oai.ok) return json({ areas: [], error: j }, 502, allowedOrigin);

      const content = j?.choices?.[0]?.message?.content;
      let parsed = {};
      try { parsed = typeof content === "string" ? JSON.parse(content) : (content || {}); } catch {}
      const areas = Array.isArray(parsed.areas) ? parsed.areas : [];
      return json({ areas }, 200, allowedOrigin);
    } catch (e) {
      return json({ areas: [], error: String(e) }, 500, allowedOrigin);
    }
  }
}
