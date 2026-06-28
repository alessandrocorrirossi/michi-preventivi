// api/tts.js — Vercel Serverless Function (ElevenLabs)
// Riceve { text }, chiama ElevenLabs con la voce di Michi, restituisce audio/mpeg (MP3)

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey  = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    return res.status(500).json({ error: "ELEVENLABS_API_KEY o ELEVENLABS_VOICE_ID non configurati" });
  }

  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Testo mancante" });
    }

    const url = "https://api.elevenlabs.io/v1/text-to-speech/" + voiceId;

    const elRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.85,
          style: 0.3,
          use_speaker_boost: true
        }
      })
    });

    if (!elRes.ok) {
      const errText = await elRes.text();
      return res.status(502).json({ error: "Errore ElevenLabs", detail: errText.slice(0, 500) });
    }

    const audioBuffer = Buffer.from(await elRes.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(audioBuffer);

  } catch (e) {
    return res.status(500).json({ error: "Errore server", detail: String(e).slice(0, 300) });
  }
}
