import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFirstAdmin } from "@/lib/bootstrap.functions";

export const Route = createFileRoute("/setup")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Configuração inicial | QFlow" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Criação da primeira conta de administração da plataforma QFlow." },
      { property: "og:title", content: "Configuração inicial | QFlow" },
      { property: "og:description", content: "Criar a primeira conta de administração do QFlow." },
    ],
  }),
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await createFirstAdmin({ data: form }).catch(
      () => ({ error: "create_failed" }) as { error: string },
    );
    setBusy(false);
    if ("error" in result && result.error) {
      toast.error(
        result.error === "already_initialised"
          ? "A plataforma já tem administrador. Entre em /login."
          : "Não foi possível criar a conta.",
      );
      return;
    }
    toast.success("Conta de administração criada. Pode entrar agora.");
    void navigate({ to: "/login" });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-3xl border bg-card p-8">
        <span className="font-display text-3xl font-extrabold tracking-tight text-primary">QFlow</span>
        <h1 className="text-2xl font-bold">Configuração inicial</h1>
        <p className="text-sm text-muted-foreground">
          Crie a primeira conta de administração da plataforma. Esta página deixa de funcionar depois
          disso — a partir daí, as contas são criadas dentro da aplicação.
        </p>
        <div className="space-y-2">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Palavra-passe (mín. 8)</Label>
          <Input
            id="password"
            type="password"
            minLength={8}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </div>
        <Button type="submit" className="w-full" size="lg" disabled={busy}>
          Criar administrador
        </Button>
      </form>
    </main>
  );
}
