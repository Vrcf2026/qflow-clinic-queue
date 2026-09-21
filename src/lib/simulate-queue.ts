/**
 * Simulação de chamadas (pré-visualização).
 *
 * Gera um conjunto de senhas fictícias para as filas propostas e reproduz, passo
 * a passo, a ordem pela qual cada balcão/gabinete as chamaria com as regras
 * sugeridas. Serve só para o gestor perceber o efeito da configuração antes de a
 * aplicar — nada é gravado.
 */

export type SimQueue = {
  prefix: string;
  name: string;
  color: string;
  avg_duration_minutes: number;
  priority_enabled: boolean;
};

export type SimPost = {
  name: string;
  tipo: "balcao" | "gabinete";
  filas: string[];
  strategy: string | null;
  priority: number | null;
  normal: number | null;
};

export type SimRule = { strategy: string; priority: number; normal: number };

export type SimCall = {
  step: number;
  post: string;
  tipo: "balcao" | "gabinete";
  ticket: string;
  queue: string;
  color: string;
  priority: boolean;
  waitSteps: number;
};

export type SimResult = {
  calls: SimCall[];
  tickets: { ticket: string; queue: string; priority: boolean; color: string }[];
  notes: string[];
  maxWaitNormal: number;
  maxWaitPriority: number;
};

type Ticket = {
  ticket: string;
  queue: string;
  color: string;
  priority: boolean;
  arrival: number;
  avg: number;
  called: boolean;
};

const PER_QUEUE = 4;

export function simulateCalls(
  queues: SimQueue[],
  posts: SimPost[],
  clinic: SimRule,
  perQueue = PER_QUEUE,
): SimResult {
  const notes: string[] = [];
  const tickets: Ticket[] = [];

  // senhas fictícias: intercaladas entre filas, 1 em cada 3 prioritária
  let arrival = 0;
  for (let i = 1; i <= perQueue; i += 1) {
    queues.forEach((q) => {
      const priority = q.priority_enabled && i % 3 === 0;
      tickets.push({
        ticket: `${q.prefix}-${String(i).padStart(3, "0")}`,
        queue: q.prefix,
        color: q.color,
        priority,
        arrival: arrival++,
        avg: q.avg_duration_minutes,
        called: false,
      });
    });
  }

  const active = posts.filter((p) => p.filas.length > 0);
  if (active.length === 0) {
    notes.push("Nenhum balcão ou gabinete tem filas atribuídas: ninguém poderia chamar senhas.");
    return { calls: [], tickets: view(tickets), notes, maxWaitNormal: 0, maxWaitPriority: 0 };
  }

  const covered = new Set(active.flatMap((p) => p.filas));
  queues
    .filter((q) => !covered.has(q.prefix))
    .forEach((q) =>
      notes.push(`A fila ${q.prefix} (${q.name}) não está atribuída a nenhum posto: ficaria à espera.`),
    );

  const counters = new Map<string, { priority: number; normal: number }>();
  const calls: SimCall[] = [];
  let step = 0;
  let guard = 0;

  while (tickets.some((t) => !t.called) && guard < 500) {
    guard += 1;
    let progressed = false;
    for (const post of active) {
      const pool = tickets.filter((t) => !t.called && post.filas.includes(t.queue));
      if (pool.length === 0) continue;
      const rule = effectiveRule(post, clinic);
      const counter = counters.get(post.name) ?? { priority: 0, normal: 0 };
      const picked = pick(pool, post.filas, rule, counter);
      picked.called = true;
      if (picked.priority) counter.priority += 1;
      else counter.normal += 1;
      if (rule.strategy === "alternado" && counter.priority >= rule.priority && counter.normal >= rule.normal) {
        counter.priority = 0;
        counter.normal = 0;
      }
      counters.set(post.name, counter);
      step += 1;
      calls.push({
        step,
        post: post.name,
        tipo: post.tipo,
        ticket: picked.ticket,
        queue: picked.queue,
        color: picked.color,
        priority: picked.priority,
        waitSteps: step - 1 - picked.arrival < 0 ? 0 : step - 1 - picked.arrival,
      });
      progressed = true;
    }
    if (!progressed) break;
  }

  const waits = (priority: boolean) =>
    calls.filter((c) => c.priority === priority).reduce((max, c) => Math.max(max, c.waitSteps), 0);

  return {
    calls,
    tickets: view(tickets),
    notes,
    maxWaitNormal: waits(false),
    maxWaitPriority: waits(true),
  };
}

export function effectiveRule(post: SimPost, clinic: SimRule): SimRule {
  if (!post.strategy) return clinic;
  return {
    strategy: post.strategy,
    priority: post.priority ?? clinic.priority,
    normal: post.normal ?? clinic.normal,
  };
}

function view(tickets: Ticket[]) {
  return tickets.map((t) => ({
    ticket: t.ticket,
    queue: t.queue,
    priority: t.priority,
    color: t.color,
  }));
}

function pick(
  pool: Ticket[],
  order: string[],
  rule: SimRule,
  counter: { priority: number; normal: number },
): Ticket {
  const byArrival = (a: Ticket, b: Ticket) => a.arrival - b.arrival;
  const queueIndex = (t: Ticket) => {
    const i = order.indexOf(t.queue);
    return i < 0 ? order.length : i;
  };

  if (rule.strategy === "chegada") {
    return [...pool].sort(byArrival)[0]!;
  }
  if (rule.strategy === "duracao") {
    return [...pool].sort((a, b) => a.avg - b.avg || byArrival(a, b))[0]!;
  }
  if (rule.strategy === "alternado") {
    const wantPriority = counter.priority < rule.priority;
    const group = pool.filter((t) => t.priority === wantPriority);
    const chosen = group.length > 0 ? group : pool;
    return [...chosen].sort((a, b) => queueIndex(a) - queueIndex(b) || byArrival(a, b))[0]!;
  }
  // prioridade (predefinição): prioritários primeiro, depois ordem das filas do posto
  return [...pool].sort(
    (a, b) =>
      Number(b.priority) - Number(a.priority) || queueIndex(a) - queueIndex(b) || byArrival(a, b),
  )[0]!;
}
