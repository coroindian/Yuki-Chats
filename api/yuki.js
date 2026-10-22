import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message, history = [] } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "API key missing" });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-3.8-flash",
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        maxOutputTokens: 250
      }
    });

    const chatHistory = (Array.isArray(history) ? history : [])
      .slice(-10)
      .filter(
        h =>
          h &&
          h.content &&
          (h.role === "user" || h.role === "assistant")
      )
      .map(h => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: String(h.content).slice(0, 2000) }]
      }));

    const chat = model.startChat({
      history: chatHistory
    });

    // Retry temporary Gemini errors automatically.
    let result;
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        result = await chat.sendMessage(message.slice(0, 2000));
        break;
      } catch (err) {
        const status = Number(
          err?.status ||
          err?.response?.status ||
          0
        );

        const errMsg = String(err?.message || err);

        const retryable =
          status === 408 ||
          status === 429 ||
          status >= 500 ||
          /\b(408|429|500|502|503|504)\b/.test(errMsg) ||
          /Service Unavailable|temporarily|high demand|overload/i.test(errMsg);

        if (!retryable || attempt === maxRetries) {
          throw err;
        }

        const delay =
          Math.min(8000, 1000 * (2 ** attempt)) +
          Math.floor(Math.random() * 300);

        await new Promise(resolve =>
          setTimeout(resolve, delay)
        );
      }
    }

    let reply = result.response.text()?.trim() || "";

    const lines = reply.split("\n").filter(Boolean);

    if (lines.length > 6) {
      reply = lines.slice(0, 5).join("\n");
    }

    if (!reply) {
      reply = "Hmm, couldn't think of a reply. Try again?";
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("Yuki API error:", err);

    const msg = String(err?.message || err);

    if (
      msg.includes("API_KEY_INVALID") ||
      msg.includes("API key not valid")
    ) {
      return res.status(500).json({
        error: "Invalid Gemini API key"
      });
    }

    if (
      msg.includes("quota") ||
      msg.includes("429")
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
