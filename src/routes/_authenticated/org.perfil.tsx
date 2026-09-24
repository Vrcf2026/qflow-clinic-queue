import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-qflow";
export const Route = createFileRoute("/_authenticated/org/perfil")({
  head: () => ({ meta: [{ title: "O meu perfil | QFlow" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Perfil,
});
function Perfil() {
  const session = useSession();
  const [name, setName] = useState(session.profile?.name ?? "");
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [busyName, setBusyName] = useState(false);
  const [busyPw, setBusyPw] = useState(false);
  const saveName = async () => {
    if (!name.trim() || name === session.profile?.name) return;
    setBusyName(true);
    const { error } = await supabase.from("profiles").update({ name: name.trim() }).eq("id", session.user?.id ?? "");
    setBusyName(false);
    if (error) { toast.error("Não foi possível guardar o nome."); return; }
    toast.success("Nome actualizado."); session.reload();
  };
  const savePw = async () => {
    if (pw.next !== pw.confirm) { toast.error("As palavras-passe não coincidem."); return; }
    if (pw.next.length < 8) { toast.error("Mínimo 8 caracteres."); return; }
    setBusyPw(true);
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: session.user?.email ?? "", password: pw.current });
    if (signInErr) { setBusyPw(false); toast.error("Palavra-passe actual incorrecta."); return; }
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setBusyPw(false);
    if (error) { toast.error("Não foi possível alterar a palavra-passe."); return; }
    toast.success("Palavra-passe alterada."); setPw({ current: "", next: "", confirm: "" });
  };
  return (
    <AppShell title="O meu perfil" subtitle={session.org?.name ?? ""} roles={session.roles} userName={session.profile?.name} primaryRole={session.primaryRole}>
      <div className="mx-auto max-w-lg space-y-6">
        <section className="rounded-2xl border bg-card p-6 space-y-4">
          <h2 className="text-base font-semibold">Dados pessoais</h2>
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Email</Label><Input value={session.user?.email ?? ""} disabled className="bg-muted" /><p className="text-xs text-muted-foreground">O email não pode ser alterado aqui.</p></div>
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Papel</Label><Input value={session.primaryRole ?? ""} disabled className="bg-muted capitalize" /></div>
          <Button disabled={busyName || !name.trim() || name === session.profile?.name} onClick={saveName}>{busyName ? "A guardar…" : "Guardar nome"}</Button>
        </section>
        <section className="rounded-2xl border bg-card p-6 space-y-4">
          <h2 className="text-base font-semibold">Alterar palavra-passe</h2>
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Palavra-passe actual</Label><Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></div>
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Nova palavra-passe (mín. 8)</Label><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></div>
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Confirmar nova</Label><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" /></div>
          <Button disabled={busyPw || !pw.current || !pw.next || !pw.confirm} onClick={savePw}>{busyPw ? "A alterar…" : "Alterar palavra-passe"}</Button>
        </section>
      </div>
    </AppShell>
  );
}
