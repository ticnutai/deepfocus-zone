import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs.readFileSync(".env", "utf8");
const url = env.match(/VITE_SUPABASE_URL=(.*)/)?.[1]?.replace(/"/g, "");
const key = env.match(/VITE_SUPABASE_PUBLISHABLE_KEY=(.*)/)?.[1]?.replace(/"/g, "");

const supabase = createClient(url, key);

async function run() {
    await supabase.auth.signInWithPassword({
        email: "jj1212t@gmail.com",
        password: "543211"
    });

    const catTerms = ["ש\"ס", "שס", "מועד", "יומא", "פסחים", "פ.", "דף פ", "ע\"א", "ע\"ב"];
    const catOrStr = catTerms.map(t => `name.ilike.*${t}*`).join(",");
    
    const { data: categories } = await supabase
        .from("categories")
        .select("id, name, parent_id, deleted_at")
        .or(catOrStr)
        .limit(100);

    console.log("--- Categories ---");
    console.log(JSON.stringify(categories, null, 2));

    const cardTerms = ["cat:פ", "cat:פ'", "cat:דף פ", "cat:יומא"];
    
    // Instead of complex .or() with .cs, let's just fetch and filter or use a simpler query
    // If tags is a jsonb array:
    let allCards = [];
    for (const term of cardTerms) {
        const { data } = await supabase
            .from("cards")
            .select("id, question, tags")
            .contains("tags", [term])
            .limit(20);
        if (data) allCards.push(...data);
        if (allCards.length >= 20) break;
    }

    console.log("--- Cards ---");
    console.log(JSON.stringify(allCards.slice(0, 20), null, 2));
}

run();
