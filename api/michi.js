// api/michi.js — Vercel Serverless Function
// Ponte verso l'API di Anthropic per le stime e la chat di Michi.
// La chiave ANTHROPIC_API_KEY sta lato server (mai nel browser).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY non configurata" });
  }

  try {
    // Leggi il body in modo robusto (Vercel a volte non lo parsa da solo)
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    if (!body || typeof body !== "object" || !body.messages) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw) { try { body = JSON.parse(raw); } catch (e) {} }
    }

    const { messages, system, max_tokens } = body || {};
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages mancante o non valido" });
    }

    const payload = {
      model: "claude-sonnet-4-6",
      max_tokens: max_tokens || 2000,
      messages,
    };
    if (system) payload.system = system;

    const aRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const text = await aRes.text();
    if (!aRes.ok) {
      return res.status(aRes.status).json({ error: "Errore Anthropic", detail: text.slice(0, 800) });
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(text);

  } catch (e) {
    return res.status(500).json({ error: "Errore server", detail: String(e && e.stack ? e.stack : e).slice(0, 800) });
  }
}
