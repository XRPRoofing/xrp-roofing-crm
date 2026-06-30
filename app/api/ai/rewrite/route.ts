import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 500 },
    );
  }

  let text: string;
  let instruction: string;
  let context: string | undefined;

  try {
    const body = await req.json();
    text = body.text;
    instruction = body.instruction;
    context = body.context;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

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
