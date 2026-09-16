import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Volume2, VolumeX, Tv as TvIcon } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { parseM3U, speakCall, timeLisbon, tvConfig, type Org } from "@/lib/qflow";

type TvQueue = { id: string; name: string; name_en: string | null; prefix: string; color: string };
type TvTicket = {
  id: string;
  queue_id: string;
  full_ticket: string;
  priority: boolean;
  status: string;
  desk_id: string | null;
  cabinet_id: string | null;
  lang_used: string;
  created_at: string;
  called_at: string | null;
};

const TICKET_COLUMNS =
  "id,queue_id,full_ticket,priority,status,desk_id,cabinet_id,lang_used,created_at,called_at";

export const Route = createFileRoute("/tv")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({ token: String(search.token ?? "") }),
  head: () => ({
    meta: [
      { title: "Painel de chamadas | QFlow" },
      { name: "description", content: "Painel de TV com chamadas de senhas, voz e vídeo para salas de espera." },
      { property: "og:title", content: "Painel de chamadas QFlow" },
      { property: "og:description", content: "Chamadas de senhas em ecrã inteiro com anúncio por voz." },
    ],
  }),
  component: TvPanel;
});

function TvPanel() {
  return null;
}
