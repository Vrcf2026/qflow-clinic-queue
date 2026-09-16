import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useOrgLive, useSession } from "@/hooks/use-qflow";
import {
  MODULE_LABELS,
  ROLE_LABELS,
  modules,
  queueIds,
  timeLisbon,
  tvConfig,
  waitingColor,
  type AppRole,
  type Device,
  type Modules,
  type Profile,
  type TvConfig,
} from "@/lib/qflow";

export const Route = createFileRoute("/_authenticated/org/dashboard")({
  head: () => ({
    meta: [
      { title: "Administração da clínica | QFlow" },
      { name: "description", content: "Gestão de filas, balcões, gabinetes, equipa, dispositivos e TV da clínica." },
      { property: "og:title", content: "Administração da clínica | QFlow" },
      { property: "og:description", content: "Configure filas, equipa, dispositivos e painel de TV do QFlow." },
    ],
  }),
  component: Dashboard;
});
