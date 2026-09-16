import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-qflow";
import { ROLE_HOME } from "@/lib/qflow";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Entrar no QFlow" },
      { name: "description", content: "Acesso da equipa da clínica ao QFlow: receção, gabinetes, turno e administração." },
      { property: "og:title", content: "Entrar no QFlow" },
      { property: "og:description", content: "Acesso da equipa da clínica à gestão de senhas QFlow." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const session = useSession();
  const [mode, setMode] = useState<"entrar" | "criar">("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.loading || !session.user) return;
    const go = async () => {
      if (!session.primaryRole) {
        await supabase.rpc("bootstrap_access");
        session.reload();
        return;
      }
      void navigate({ to: ROLE_HOME[session.primaryRole], replace: true });
    };
    void go();
  }, [session.loading, session.user, session.primaryRole, navigate, session]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (mode === "criar") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo: `${window.location.origin}/login`,
        },
      });
      setBusy(false);
      if (error) return toast.error(error.message);
      toast.success("Conta criada. Verifique o email para confirmar o acesso.");
      setMode("entrar");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error("Email ou palavra-passe incorretos.");
  };

  const google = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/login",
    });
    if (result.error) toast.error("Não foi possível entrar com Google.");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border bg-card p-8 shadow-sm">
        <span className="font-display text-3xl font-extrabold tracking-tight text-primary">QFlow</span>
        <h1 className="mt-6 text-2xl font-bold text-card-foreground">
          {mode === "entrar" ? "Entrar na plataforma" : "Criar conta"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Acesso reservado à equipa da clínica.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "criar" && (
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Palavra-passe</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "entrar" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <Button type="submit" className="w-full" size="lg" disabled={busy}>
            {mode === "entrar" ? "Entrar" : "Criar conta"}
          </Button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          ou
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button variant="outline" className="w-full" size="lg" onClick={google}>
          Entrar com Google
        </Button>

        <button
          type="button"
          className="mt-6 w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => setMode(mode === "entrar" ? "criar" : "entrar")}
        >
          {mode === "entrar" ? "Não tem conta? Criar conta" : "Já tem conta? Entrar"}
        </button>
      </div>
    </main>
  );
}
