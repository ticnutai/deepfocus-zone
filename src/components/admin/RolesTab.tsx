import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Lock, Star, X } from "lucide-react";

interface Role { id: string; name: string; description: string | null; is_system: boolean; is_default_for_signup: boolean; }

export function RolesTab() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("app_roles").select("*").order("is_system", { ascending: false }).order("name");
    setRoles((data ?? []) as Role[]);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return toast.error("הזן שם תפקיד");
    setBusy(true);
    const { data, error } = await supabase
      .from("app_roles")
      .insert({ name: name.trim(), description: desc.trim() || null, is_system: false })
      .select()
      .single();
    if (error) { setBusy(false); return toast.error(error.message); }
    // seed permissions = all false
    const modules = ["decks","cards","goals","shas","analytics","users","roles","settings"] as const;
    const actions = ["view","create","edit","delete","manage"] as const;
    const rows = modules.flatMap((m) => actions.map((a) => ({
      role_id: (data as Role).id, module: m, action: a, allowed: false,
    })));
    await supabase.from("role_permissions").insert(rows as never[]);
    setBusy(false);
    setName(""); setDesc("");
    toast.success("התפקיד נוצר");
    load();
  };

  const remove = async (id: string) => {
    setBusy(true);
    const { error } = await supabase.from("app_roles").delete().eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("נמחק");
    load();
  };

  const setSignupDefault = async (roleId: string | null) => {
    setBusy(true);
    const { error } = await supabase.rpc("admin_set_default_signup_role", {
      p_role_id: roleId,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(roleId ? "תפקיד ברירת המחדל להרשמה עודכן" : "ברירת המחדל להרשמה נוקתה");
    await load();
  };

  return (
    <div className="space-y-4">
      <Card className="gold-frame p-4 space-y-3">
        <h3 className="font-display text-lg font-semibold">תפקיד חדש</h3>
        <div className="grid sm:grid-cols-3 gap-2">
          <Input placeholder="שם (למשל editor)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input className="sm:col-span-2" placeholder="תיאור" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <Button onClick={create} disabled={busy} className="bg-gradient-navy text-primary-foreground">
          <Plus className="h-4 w-4" /> הוסף תפקיד
        </Button>
        <p className="text-xs text-muted-foreground">
          לאחר יצירת התפקיד, מגדירים לו את כל ההרשאות והמסך במקום אחד בטאב „הרשאות ותצוגה”.
        </p>
      </Card>

      <Card className="gold-frame p-4 space-y-2">
        <h3 className="font-display text-lg font-semibold mb-2">תפקידים קיימים</h3>
        <p className="text-xs text-muted-foreground pb-1">
          התפקיד המסומן כברירת מחדל משויך אוטומטית לנרשמים חדשים. אפשר לבחור תפקיד אחר או לנקות את הבחירה.
        </p>
        {roles.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border-2 border-gold/40 bg-card p-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{r.name}</span>
                {r.is_system && <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" /> מובנה</Badge>}
                {r.is_default_for_signup && <Badge className="gap-1"><Star className="h-3 w-3 fill-current" /> ברירת מחדל להרשמה</Badge>}
              </div>
              {r.description && <div className="text-xs text-muted-foreground mt-0.5">{r.description}</div>}
            </div>
            <div className="flex items-center gap-1">
              {r.is_default_for_signup ? (
                <Button variant="outline" size="sm" onClick={() => setSignupDefault(null)} disabled={busy}>
                  <X className="h-4 w-4" /> נקה ברירת מחדל
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setSignupDefault(r.id)} disabled={busy}>
                  <Star className="h-4 w-4" /> קבע כברירת מחדל
                </Button>
              )}
              {!r.is_system && (
                <Button variant="ghost" size="icon" onClick={() => remove(r.id)} className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
        {!roles.length && <div className="text-center text-sm text-muted-foreground py-4">אין תפקידים</div>}
      </Card>
    </div>
  );
}
