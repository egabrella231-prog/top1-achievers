import { GoogleGenAI } from "@google/genai";

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const { messages, subject, level } = await req.json();
    const ai = new GoogleGenAI(); 
    const model = ai.getGenerativeModel({ 
      model: "gemini-2.0-flash",
      systemInstruction: "You are a Grade 12 Namibia tutor for " + subject + " (" + level + ")."
    });
    const result = await model.generateContentStream(messages[messages.length - 1].content);
    return new Response(result.stream as any);
  } catch (error) {
    return new Response(JSON.stringify({ error: "Disrupted" }), { status: 500 });
  }
}
