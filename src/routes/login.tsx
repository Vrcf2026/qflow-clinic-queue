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
      { name: "robots", content: "noindex, nofollow" },
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
  const [email, setEmail] = useState("");
  const [orgBrand, setOrgBrand] = useState<{ name: string; logo_url: string | null; primary_color: string } | null>(null);

  // Carregar marca da clínica se vier ?org=slug no URL
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("org");
    if (!slug) return;
    void supabase
      .from("organizations")
      .select("name, logo_url, primary_color")
      .eq("slug", slug)
      .single()
      .then(({ data }) => { if (data) setOrgBrand(data as typeof orgBrand); });
  }, []);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (session.loading || !session.user) return;
    if (session.primaryRole) {
      void navigate({ to: ROLE_HOME[session.primaryRole], replace: true });
    }
  }, [session.loading, session.user, session.primaryRole, navigate]);

  const blocked = !session.loading && !!session.user && !session.primaryRole;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error("Email ou palavra-passe incorretos.");
  };

  const sendReset = async () => {
    if (!email.trim()) { toast.error("Introduza o seu email."); return; }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/login",
    });
    setBusy(false);
    if (error) { toast.error("Não foi possível enviar o email."); return; }
    setResetSent(true);
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
        {orgBrand ? (
          <div className="flex flex-col gap-2">
            {orgBrand.logo_url && (
              <img src={orgBrand.logo_url} alt={orgBrand.name} className="h-12 w-auto max-w-[160px] object-contain" />
            )}
            <span className="font-display text-2xl font-bold" style={{ color: orgBrand.primary_color }}>
              {orgBrand.name}
            </span>
          </div>
        ) : (
          <span className="font-display text-3xl font-extrabold tracking-tight text-primary">QFlow</span>
        )}
        <h1 className="mt-6 text-2xl font-bold text-card-foreground">Entrar na plataforma</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Acesso reservado à equipa da clínica. As contas são criadas pela administração.
        </p>

        {blocked && (
          <div className="mt-5 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p className="font-semibold text-destructive">Conta sem acesso</p>
            <p className="mt-1 text-muted-foreground">
              Esta conta ainda não foi autorizada por uma administração. Peça à administração da sua
              clínica para criar o seu acesso.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={async () => {
                await supabase.auth.signOut();
                session.reload();
              }}
            >
              Sair
            </Button>
          </div>
        )}

        {resetMode ? (
          <div className="mt-6 space-y-4">
            {resetSent ? (
              <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                <p className="font-semibold">Email enviado</p>
                <p className="mt-1">Verifique a sua caixa de entrada e siga o link para redefinir a palavra-passe.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Introduza o seu email e enviaremos um link para redefinir a palavra-passe.</p>
                <div className="space-y-2">
                  <Label htmlFor="email-reset">Email</Label>
                  <Input
                    id="email-reset"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <Button className="w-full" size="lg" disabled={busy || !email.trim()} onClick={sendReset}>
                  {busy ? "A enviar…" : "Enviar link de recuperação"}
                </Button>
              </>
            )}
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors"
              onClick={() => { setResetMode(false); setResetSent(false); }}
            >
              ← Voltar ao login
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={submit} className="mt-6 space-y-4">
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
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" className="w-full" size="lg" disabled={busy}>
                {busy ? "A entrar…" : "Entrar"}
              </Button>
            </form>
            <button
              type="button"
              className="mt-3 w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors"
              onClick={() => setResetMode(true)}
            >
              Esqueci a palavra-passe
            </button>
          </>
        )}

        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          ou
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button variant="outline" className="w-full" size="lg" onClick={google}>
          Entrar com Google
        </Button>
      </div>
    </main>
  );
}
