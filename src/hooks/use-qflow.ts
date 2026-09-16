import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import {
  dayStart,
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
};

const emptySession: SessionState = {
  loading: true,
  user: null,
  profile: null,
  org: null,
  roles: [],
  primaryRole: null,
};

export function useSession(): SessionState & { reload: () => void } {
  const [state, setState] = useState<SessionState>(emptySession);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user ?? null;
      if (!user) {
        if (!cancelled) setState({ ...emptySession, loading: false });
        return;
      }
      const [{ data: profile }, { data: roleRows }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      let org: Org | null = null;
      if (profile?.org_id) {
        const { data: orgRow } = await supabase
          .from("organizations")
          .select("*")
          .eq("id", profile.org_id)
          .maybeSingle();
        org = orgRow ?? null;
      }
      const roles = (roleRows ?? []).map((r) => r.role as AppRole);
      const primaryRole = ROLE_PRIORITY.find((r) => roles.includes(r)) ?? null;
      if (!cancelled) setState({ loading: false, user, profile: profile ?? null, org, roles, primaryRole });
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

  return { ...state, reload: () => setTick((t) => t + 1) };
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

/** Loads today's org state and keeps it in sync with realtime ticket changes. */
export function useOrgLive(orgId?: string | null, resetTime = "08:00"): OrgLive {
  const [loading, setLoading] = useState(true);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [desks, setDesks] = useState<Desk[]>([]);
  const [cabinets, setCabinets] = useState<Cabinet[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [lastCall, setLastCall] = useState<Ticket | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    const since = dayStart(resetTime).toISOString();
    const [q, d, c, t] = await Promise.all([
      supabase.from("queues").select("*").eq("org_id", orgId).order("order"),
      supabase.from("desks").select("*").eq("org_id", orgId).order("name"),
      supabase.from("cabinets").select("*").eq("org_id", orgId).order("name"),
      supabase
        .from("tickets")
        .select("*")
        .eq("org_id", orgId)
        .gte("created_at", since)
        .order("created_at", { ascending: true }),
    ]);
    setQueues(q.data ?? []);
    setDesks(d.data ?? []);
    setCabinets(c.data ?? []);
    setTickets(t.data ?? []);
    setLoading(false);
  }, [orgId, resetTime]);

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

  return { loading, queues, desks, cabinets, tickets, refresh: () => void load(), lastCall };
}
