import { createFileRoute, Link } from "@tanstack/react-router";
import { Monitor, Tv, Users, Stethoscope, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "QFlow — Gestão de senhas para clínicas em Portugal" },
      {
        name: "description",
        content:
          "QFlow organiza o atendimento da sua clínica: quiosque bilingue, painel de TV com chamada por voz, receção, gabinetes e estatísticas em tempo real.",
      },
      { property: "og:title", content: "QFlow — Gestão de senhas para clínicas" },
      {
        property: "og:description",
        content:
          "Quiosque bilingue, painel de TV com voz, receção e gabinetes em tempo real para clínicas em Portugal.",
      },
    ],
  }),
  component: Landing,
});

const features = [
  { icon: Monitor, title: "Quiosque bilingue", text: "Senhas em português ou inglês, com talão de 80 mm e QR para telemóvel." },
  { icon: Tv, title: "Painel de TV", text: "Chamada em ecrã inteiro, anúncio por voz e canais de vídeo em simultâneo." },
  { icon: Users, title: "Receção", text: "Chamar, re-chamar, marcar faltas e registar o doente num só ecrã." },
  { icon: Stethoscope, title: "Gabinetes", text: "Cada médico chama o próximo doente da sua fila, em tempo real." },
];

function Landing() {
  return (
    <main className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="font-display text-2xl font-extrabold tracking-tight text-primary">QFlow</span>
        <Button asChild>
          <Link to="/login">Entrar</Link>
        </Button>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-10 pb-16">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">
          Gestão de filas para clínicas
        </p>
        <h1 className="mt-4 max-w-3xl text-5xl leading-tight font-extrabold text-foreground sm:text-6xl">
          Atendimento organizado, do quiosque ao gabinete.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          O QFlow emite senhas, anuncia chamadas por voz no painel de TV e mantém receção,
          gabinetes e administração sincronizados ao segundo. Feito para clínicas em Portugal.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/login">
              Entrar na plataforma <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/quiosque" search={{ token: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }}>
              Ver quiosque de demonstração
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/tv" search={{ token: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }}>
              Ver painel de TV
            </Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => (
          <article key={f.title} className="rounded-2xl border bg-card p-6 shadow-sm">
            <f.icon className="size-6 text-primary" />
            <h2 className="mt-4 text-lg font-semibold text-card-foreground">{f.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
