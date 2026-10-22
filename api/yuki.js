import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const SYSTEM_PROMPT = `You are Yuki, a friendly and helpful AI companion inside a chat app.
Rules:
- Reply in the SAME language the user used (Hindi → Hindi, English → English, Hinglish → Hinglish).
- Keep replies SHORT: maximum 4-5 lines. Never write long paragraphs.
- Be warm, casual, and helpful. Answer questions directly.
- If asked about code/design, give concise actionable answers.
- Never mention you are Gemini or a Google model. You are "Yuki".
- Do not use markdown headers or bullet spam. Plain friendly sentences.`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { message, history = [] } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        error: "Groq API key missing"
      });
    }

    const chatHistory = (Array.isArray(history) ? history : [])
      .slice(-10)
      .filter(
        h =>
          h &&
          h.content &&
          (h.role === "user" || h.role === "assistant")
      )
      .map(h => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: String(h.content).slice(0, 2000)
      }));

    const messages = [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      ...chatHistory,
      {
        role: "user",
        content: message.slice(0, 2000)
      }
    ];

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.8,
      max_tokens: 250
    });

    let reply =
      completion?.choices?.[0]?.message?.content?.trim() || "";

    const lines = reply.split("\n").filter(Boolean);

    if (lines.length > 6) {
      reply = lines.slice(0, 5).join("\n");
    }

    if (!reply) {
      reply = "Hmm, couldn't think of a reply. Try again?";
    }

    return res.status(200).json({
      reply
    });

  } catch (err) {
    console.error("Yuki API error:", err);

    const msg = String(err?.message || err);

    if (
      msg.includes("401") ||
      msg.includes("Invalid API Key") ||
      msg.includes("invalid_api_key")
    ) {
      return res.status(500).json({
        error: "Invalid Groq API key"
      });
    }

    if (
      msg.includes("429") ||
      msg.toLowerCase().includes("rate limit")
    ) {
      return res.status(429).json({
        error: "Rate limit reached. Try again in a minute."
      });
    }

    return res.status(500).json({
      error: "Yuki is unavailable right now."
    });
  }
}
