// api/michi.js — Vercel Serverless Function
// Ponte verso l'API di Anthropic per le stime e la chat di Michi.
// La chiave ANTHROPIC_API_KEY sta lato server (mai nel browser).

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY non configurata" });
  }

  try {
    const { messages, system, max_tokens } = req.body || {};
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages mancante" });
    }

    const body = {
      model: "claude-sonnet-4-6",
      max_tokens: max_tokens || 2000,
      messages,
    };
    if (system) body.system = system;

    const aRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!aRes.ok) {
      const errText = await aRes.text();
      return res.status(502).json({ error: "Errore Anthropic", detail: errText.slice(0, 600) });
    }

    const data = await aRes.json();
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({ error: "Errore server", detail: String(e).slice(0, 400) });
  }
}
