import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import {
  ROLE_PRIORITY,
  type AppRole,
  type Cabinet,
  type Desk,
  type Org,
  type Profile,
  type Queue,
  type Ticket,
} from "@/lib/qflow";

export type SessionState = {
  loading: boolean;
  user: User | null;
  profile: Profile | null;
  org: Org | null;
  roles: AppRole[];
  primaryRole: AppRole | null;
  /** Start of the current service day, computed on the server in the org timezone. */
  dayStart: string | null;
  /** serverNow - clientNow, in ms. Used so screens never trust the local clock. */
  offsetMs: number;
  /** Signed in but without an active profile / role. */
  noAccess: boolean;
};

const emptySession: SessionState = {
  loading: true,
  user: null,
  profile: null,
  org: null,
  roles: [],
  primaryRole: null,
  dayStart: null,
  offsetMs: 0,
  noAccess: false,
};

type AccessPayload = {
  error?: string;
  profile?: Profile;
  org?: Org | null;
  roles?: string[];
  server_now?: string;
  day_start?: string | null;
};

export function useSession(): SessionState & { reload: () => void; now: () => Date } {
  const [state, setState] = useState<SessionState>(emptySession);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const sentAt = Date.now();
      const { data } = await supabase.auth.getUser();
      const user = data.user ?? null;
      if (!user) {
        if (!cancelled) setState({ ...emptySession, loading: false });
        return;
      }
      const { data: raw } = await supabase.rpc("my_access");
      const access = (raw ?? {}) as AccessPayload;
      const offsetMs = access.server_now
        ? new Date(access.server_now).getTime() - (sentAt + Date.now()) / 2
        : 0;
      const roles = (access.roles ?? []) as AppRole[];
      if (cancelled) return;
      setState({
        loading: false,
        user,
        profile: access.profile ?? null,
        org: access.org ?? null,
        roles,
        primaryRole: ROLE_PRIORITY.find((r) => roles.includes(r)) ?? null,
        dayStart: access.day_start ?? null,
        offsetMs,
        noAccess: Boolean(access.error) || !access.profile,
      });
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        setTick((t) => t + 1);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const now = useCallback(() => new Date(Date.now() + state.offsetMs), [state.offsetMs]);

  return { ...state, reload: () => setTick((t) => t + 1), now };
}

/** Ticking clock aligned with the server (offset in ms). */
export function useClock(offsetMs: number, intervalMs = 1000): Date {
  const [value, setValue] = useState(() => new Date(Date.now() + offsetMs));
  useEffect(() => {
    setValue(new Date(Date.now() + offsetMs));
    const id = setInterval(() => setValue(new Date(Date.now() + offsetMs)), intervalMs);
    return () => clearInterval(id);
  }, [offsetMs, intervalMs]);
  return value;
}

export type OrgLive = {
  loading: boolean;
  queues: Queue[];
  desks: Desk[];
  cabinets: Cabinet[];
  tickets: Ticket[];
  refresh: () => void;
  lastCall: Ticket | null;
};

/**
 * Loads the org state for the current service day (boundary computed on the server)
 * and keeps it in sync through realtime ticket changes.
 */
export function useOrgLive(orgId?: string | null, dayStart?: string | null): OrgLive {
  const [loading, setLoading] = useState(true);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [desks, setDesks] = useState<Desk[]>([]);
  const [cabinets, setCabinets] = useState<Cabinet[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [lastCall, setLastCall] = useState<Ticket | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !dayStart) return;
    const [q, d, c, t] = await Promise.all([
      supabase.from("queues").select("*").eq("org_id", orgId).order("order"),
      supabase.from("desks").select("*").eq("org_id", orgId).order("name"),
      supabase.from("cabinets").select("*").eq("org_id", orgId).order("name"),
      supabase
        .from("tickets")
        .select("*")
        .eq("org_id", orgId)
        .gte("created_at", dayStart)
        .order("created_at", { ascending: true }),
    ]);
    setQueues(q.data ?? []);
    setDesks(d.data ?? []);
    setCabinets(c.data ?? []);
    setTickets(t.data ?? []);
    setLoading(false);
  }, [orgId, dayStart]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`org:${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tickets", filter: `org_id=eq.${orgId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as Ticket | undefined;
          if (!row) return;
          setTickets((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((x) => x.id !== row.id);
            const exists = prev.some((x) => x.id === row.id);
            const next = exists ? prev.map((x) => (x.id === row.id ? row : x)) : [...prev, row];
            return next.sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
            );
          });
          if (
            payload.eventType === "UPDATE" &&
            row.status === "chamado" &&
            (payload.old as Ticket | undefined)?.status !== "chamado"
          ) {
            setLastCall(row);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queues", filter: `org_id=eq.${orgId}` },
        () => void load(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orgId, load]);

  return useMemo(
    () => ({ loading, queues, desks, cabinets, tickets, refresh: () => void load(), lastCall }),
    [loading, queues, desks, cabinets, tickets, load, lastCall],
  );
}
