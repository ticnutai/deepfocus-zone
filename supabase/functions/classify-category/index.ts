import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Supabase environment is not configured");
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: userRoles, error: rolesError } = await adminClient
      .from("user_roles")
      .select("role_id")
      .eq("user_id", user.id);
    if (rolesError) throw rolesError;

    const roleIds = (userRoles ?? []).map((row) => row.role_id);
    const { data: adminRoles, error: adminRolesError } = roleIds.length
      ? await adminClient.from("app_roles").select("id").in("id", roleIds).eq("name", "admin").limit(1)
      : { data: [], error: null };
    if (adminRolesError) throw adminRolesError;
    if (!adminRoles?.length) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { question, answer, categories, maxResults } = await req.json() as {
      question?: string;
      answer?: string;
      categories?: string[]; // full paths e.g. "חומש/שמות/כי תשא"
      maxResults?: number;
    };

    if (!question || typeof question !== "string" || !question.trim()) {
      return new Response(JSON.stringify({ error: "חסר טקסט שאלה" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!Array.isArray(categories) || categories.length === 0) {
      return new Response(JSON.stringify({ matches: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const limit = Math.min(Math.max(maxResults ?? 2, 1), 5);

    const systemPrompt = `אתה מסווג שאלות לימוד לקטגוריות קיימות בעברית.
קבל שאלה (ולעיתים תשובה) ורשימת קטגוריות אפשריות (כל אחת בנתיב מלא, מופרדות ב"/").
החזר את שמות הקטגוריות הכי מתאימות מהרשימה — בדיוק כפי שהן כתובות, ללא המצאה של שמות חדשים.
החזר בין 1 ל-${limit} התאמות, מהמתאימה ביותר לפחות מתאימה. אם אין התאמה טובה — החזר מערך ריק.`;

    const userText = `שאלה: ${question}\n${answer ? `תשובה: ${answer}\n` : ""}\nקטגוריות אפשריות:\n${categories.map((c, i) => `${i + 1}. ${c}`).join("\n")}`;

    const body = {
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      tools: [{
        type: "function",
        function: {
          name: "classify_category",
          description: "Return best-matching category paths from the provided list",
          parameters: {
            type: "object",
            properties: {
              matches: {
                type: "array",
                description: "Selected category paths, exactly as provided in the input list, ordered best-first",
                items: { type: "string" },
              },
              reasoning: { type: "string", description: "קצר, בעברית" },
            },
            required: ["matches"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "classify_category" } },
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
    const args = toolCall ? JSON.parse(toolCall.function.arguments) : { matches: [] };

    // Filter to ensure model only returned values from input list (case-sensitive exact match)
    const allowed = new Set(categories);
    const matches: string[] = (Array.isArray(args.matches) ? args.matches : [])
      .filter((m: unknown): m is string => typeof m === "string" && allowed.has(m))
      .slice(0, limit);

    return new Response(JSON.stringify({ matches, reasoning: args.reasoning }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("classify-category error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
