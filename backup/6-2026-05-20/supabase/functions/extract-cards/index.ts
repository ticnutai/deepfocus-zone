import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text, imageBase64, imageMime } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `אתה עוזר שמחלץ כרטיסי לימוד (שאלות ותשובות) מטקסט או מתמונה בעברית.
החזר תמיד דרך הכלי extract_cards.
סוגי כרטיסים אפשריים:
- "flashcard": שאלה פתוחה עם תשובה אחת
- "multiple": שאלה אמריקאית עם 2-6 אפשרויות, ציין את האינדקסים הנכונים (0-based)
- "boolean": נכון/לא נכון
אם יש כמה שאלות - החזר את כולן במערך.`;

    const userContent: any[] = [];
    if (text) userContent.push({ type: "text", text });
    if (imageBase64) {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${imageMime || "image/png"};base64,${imageBase64}` },
      });
      if (!text) userContent.push({ type: "text", text: "חלץ את כל השאלות והתשובות מהתמונה הזו." });
    }

    const body = {
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      tools: [{
        type: "function",
        function: {
          name: "extract_cards",
          description: "Return extracted study cards",
          parameters: {
            type: "object",
            properties: {
              cards: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["flashcard", "multiple", "boolean"] },
                    question: { type: "string" },
                    answer: { type: "string", description: "for flashcard" },
                    options: { type: "array", items: { type: "string" }, description: "for multiple" },
                    correctIndices: { type: "array", items: { type: "number" }, description: "for multiple, 0-based" },
                    correct: { type: "boolean", description: "for boolean" },
                    explanation: { type: "string" },
                  },
                  required: ["type", "question"],
                },
              },
            },
            required: ["cards"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "extract_cards" } },
    };

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI gateway error", resp.status, t);
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "חרגת ממכסת הבקשות, נסה שוב בעוד רגע" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "נדרשת הוספת קרדיטים ל-Lovable AI" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "AI error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await resp.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = toolCall ? JSON.parse(toolCall.function.arguments) : { cards: [] };

    return new Response(JSON.stringify(args), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-cards error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});