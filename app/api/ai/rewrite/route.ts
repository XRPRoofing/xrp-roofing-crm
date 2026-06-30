import { NextRequest, NextResponse } from "next/server";
import { buildCrmAssistantPrompt } from "@/lib/ai-crm-knowledge";

interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const mode = (body.mode as string) || "rewrite";

  // -------------------------------------------------------------------------
  // Chat mode — conversational AI assistant
  // -------------------------------------------------------------------------
  if (mode === "chat") {
    const chatMessages = body.messages as ChatMsg[] | undefined;
    const userMessage = body.message as string | undefined;
    const currentPage = body.currentPage as string | undefined;

    if (!userMessage && (!chatMessages || chatMessages.length === 0)) {
      return NextResponse.json(
        { error: "A 'message' or 'messages' array is required for chat mode" },
        { status: 400 },
      );
    }

    const chatSystemPrompt = buildCrmAssistantPrompt(currentPage);

    const messages: ChatMsg[] = [{ role: "system", content: chatSystemPrompt }];

    if (chatMessages && chatMessages.length > 0) {
      // Include conversation history (limit to last 20 messages for token budget)
      const recent = chatMessages.slice(-20);
      for (const m of recent) {
        if (m.role === "user" || m.role === "assistant") {
          messages.push({ role: m.role, content: m.content });
        }
      }
    }

    if (userMessage) {
      messages.push({ role: "user", content: userMessage });
    }

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.7,
          max_tokens: 2048,
          messages,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[AI Chat] OpenAI error:", response.status, errText);
        return NextResponse.json(
          { error: "AI service unavailable" },
          { status: 502 },
        );
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const result = data.choices?.[0]?.message?.content?.trim() || "";

      return NextResponse.json({ result });
    } catch (err) {
      console.error("[AI Chat] Unexpected error:", err);
      return NextResponse.json(
        { error: "Failed to process AI request" },
        { status: 500 },
      );
    }
  }

  // -------------------------------------------------------------------------
  // Rewrite mode (default) — existing behavior unchanged
  // -------------------------------------------------------------------------
  const text = body.text as string;
  const instruction = body.instruction as string;
  const context = body.context as string | undefined;

  if (!text || !instruction) {
    return NextResponse.json(
      { error: "Both 'text' and 'instruction' are required" },
      { status: 400 },
    );
  }

  const systemPrompt = [
    "You are a professional writing assistant for a roofing company CRM (XRP Roofing, based in Arizona).",
    "Your job is to rewrite, improve, or generate text based on the user's instruction.",
    "Always maintain accuracy with roofing terminology.",
    "Return ONLY the rewritten/generated text. No explanations, no preamble, no markdown formatting unless the original text uses it.",
    "Match the general length and format of the original unless the instruction says otherwise.",
    context ? `Context: ${context}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        max_tokens: 2048,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Instruction: ${instruction}\n\nOriginal text:\n${text}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[AI Rewrite] OpenAI error:", response.status, errText);
      return NextResponse.json(
        { error: "AI service unavailable" },
        { status: 502 },
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const result = data.choices?.[0]?.message?.content?.trim() || "";

    return NextResponse.json({ result });
  } catch (err) {
    console.error("[AI Rewrite] Unexpected error:", err);
    return NextResponse.json(
      { error: "Failed to process AI request" },
      { status: 500 },
    );
  }
}
