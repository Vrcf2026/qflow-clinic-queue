export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      cabinets: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          org_id: string
          priority_ratio: Json | null
          queue_ids: Json
          queue_strategy: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          org_id: string
          priority_ratio?: Json | null
          queue_ids?: Json
          queue_strategy?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          priority_ratio?: Json | null
          queue_ids?: Json
          queue_strategy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cabinets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_log: {
        Row: {
          cabinet_name: string | null
          called_at: string
          called_by_device_id: string | null
          called_by_user_id: string | null
          desk_name: string | null
          full_ticket: string
          id: string
          org_id: string
          ticket_id: string | null
        }
        Insert: {
          cabinet_name?: string | null
          called_at?: string
          called_by_device_id?: string | null
          called_by_user_id?: string | null
          desk_name?: string | null
          full_ticket: string
          id?: string
          org_id: string
          ticket_id?: string | null
        }
        Update: {
          cabinet_name?: string | null
          called_at?: string
          called_by_device_id?: string | null
          called_by_user_id?: string | null
          desk_name?: string | null
          full_ticket?: string
          id?: string
          org_id?: string
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_log_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      desks: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          org_id: string
          priority_ratio: Json | null
          queue_ids: Json
          queue_strategy: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          org_id: string
          priority_ratio?: Json | null
          queue_ids?: Json
          queue_strategy?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          priority_ratio?: Json | null
          queue_ids?: Json
          queue_strategy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "desks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          org_id: string
          token: string
          type: Database["public"]["Enums"]["device_type"]
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          org_id: string
          token?: string
          type: Database["public"]["Enums"]["device_type"]
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          token?: string
          type?: Database["public"]["Enums"]["device_type"]
        }
        Relationships: [
          {
            foreignKeyName: "devices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          kiosk_languages: Json
          logo_url: string | null
          max_skips: number
          missed_recovery_minutes: number
          modules_enabled: Json
          name: string
          plan: Database["public"]["Enums"]["org_plan"]
          primary_color: string
          priority_ratio: Json
          queue_strategy: string
          reset_time: string
          secondary_color: string
          skip_reinsert_after: number
          slug: string
          timezone: string
          tv_config: Json
          voice_lang: string
        }
        Insert: {
          created_at?: string
          id?: string
          kiosk_languages?: Json
          logo_url?: string | null
          max_skips?: number
          missed_recovery_minutes?: number
          modules_enabled?: Json
          name: string
          plan?: Database["public"]["Enums"]["org_plan"]
          primary_color?: string
          priority_ratio?: Json
          queue_strategy?: string
          reset_time?: string
          secondary_color?: string
          skip_reinsert_after?: number
          slug: string
          timezone?: string
          tv_config?: Json
          voice_lang?: string
        }
        Update: {
          created_at?: string
          id?: string
          kiosk_languages?: Json
          logo_url?: string | null
          max_skips?: number
          missed_recovery_minutes?: number
          modules_enabled?: Json
          name?: string
          plan?: Database["public"]["Enums"]["org_plan"]
          primary_color?: string
          priority_ratio?: Json
          queue_strategy?: string
          reset_time?: string
          secondary_color?: string
          skip_reinsert_after?: number
          slug?: string
          timezone?: string
          tv_config?: Json
          voice_lang?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          cabinet_id: string | null
          created_at: string
          desk_id: string | null
          email: string
          id: string
          name: string
          org_id: string | null
        }
        Insert: {
          active?: boolean
          cabinet_id?: string | null
          created_at?: string
          desk_id?: string | null
          email?: string
          id: string
          name?: string
          org_id?: string | null
        }
        Update: {
          active?: boolean
          cabinet_id?: string | null
          created_at?: string
          desk_id?: string | null
          email?: string
          id?: string
          name?: string
          org_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      queues: {
        Row: {
          active: boolean
          avg_duration_minutes: number
          color: string
          created_at: string
          icon: string
          id: string
          name: string
          name_en: string | null
          order: number
          org_id: string
          prefix: string
          priority_enabled: boolean
        }
        Insert: {
          active?: boolean
          avg_duration_minutes?: number
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name: string
          name_en?: string | null
          order?: number
          org_id: string
          prefix: string
          priority_enabled?: boolean
        }
        Update: {
          active?: boolean
          avg_duration_minutes?: number
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name?: string
          name_en?: string | null
          order?: number
          org_id?: string
          prefix?: string
          priority_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "queues_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          detail: Json
          device_id: string | null
          event: string
          full_ticket: string
          id: string
          org_id: string
          ticket_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          device_id?: string | null
          event: string
          full_ticket: string
          id?: string
          org_id: string
          ticket_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          device_id?: string | null
          event?: string
          full_ticket?: string
          id?: string
          org_id?: string
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          cabinet_id: string | null
          called_at: string | null
          created_at: string
          desk_id: string | null
          device_origin: string
          done_at: string | null
          full_ticket: string
          id: string
          lang_used: string
          last_skipped_at: string | null
          number: number
          org_id: string
          patient_name: string | null
          patient_utente: string | null
          priority: boolean
          queue_id: string
          recall_count: number
          skip_count: number
          sort_at: string
          status: Database["public"]["Enums"]["ticket_status"]
        }
        Insert: {
          cabinet_id?: string | null
          called_at?: string | null
          created_at?: string
          desk_id?: string | null
          device_origin?: string
          done_at?: string | null
          full_ticket: string
          id?: string
          lang_used?: string
          last_skipped_at?: string | null
          number: number
          org_id: string
          patient_name?: string | null
          patient_utente?: string | null
          priority?: boolean
          queue_id: string
          recall_count?: number
          skip_count?: number
          sort_at?: string
          status?: Database["public"]["Enums"]["ticket_status"]
        }
        Update: {
          cabinet_id?: string | null
          called_at?: string | null
          created_at?: string
          desk_id?: string | null
          device_origin?: string
          done_at?: string | null
          full_ticket?: string
          id?: string
          lang_used?: string
          last_skipped_at?: string | null
          number?: number
          org_id?: string
          patient_name?: string | null
          patient_utente?: string | null
          priority?: boolean
          queue_id?: string
          recall_count?: number
          skip_count?: number
          sort_at?: string
          status?: Database["public"]["Enums"]["ticket_status"]
        }
        Relationships: [
          {
            foreignKeyName: "tickets_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "cabinets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_desk_id_fkey"
            columns: ["desk_id"]
            isOneToOne: false
            referencedRelation: "desks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "queues"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          org_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          org_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admit_ticket: {
        Args: { p_name: string; p_ticket_id: string; p_utente?: string }
        Returns: Json
      }
      call_ticket: {
        Args: {
          p_cabinet_id?: string
          p_desk_id?: string
          p_recall?: boolean
          p_ticket_id: string
        }
        Returns: Json
      }
      device_context: { Args: { p_token: string }; Returns: Json }
      finish_ticket: { Args: { p_ticket_id: string }; Returns: Json }
      issue_ticket: {
        Args: {
          p_lang?: string
          p_priority?: boolean
          p_queue_id: string
          p_token: string
        }
        Returns: Json
      }
      miss_ticket: { Args: { p_ticket_id: string }; Returns: Json }
      my_access: { Args: never; Returns: Json }
      next_ticket_for_desk:
        | { Args: { p_desk_id: string }; Returns: Json }
        | { Args: { p_cabinet_id?: string; p_desk_id: string }; Returns: Json }
      org_clock: { Args: never; Returns: Json }
      org_stats: {
        Args: { p_from: string; p_org?: string; p_to: string }
        Returns: Json
      }
      platform_stats: { Args: { p_from: string; p_to: string }; Returns: Json }
      recover_ticket: { Args: { p_ticket_id: string }; Returns: Json }
      reset_service_day: { Args: never; Returns: Json }
      set_queue_strategy: {
        Args: { p_ratio?: Json; p_strategy: string }
        Returns: Json
      }
      skip_ticket: { Args: { p_ticket_id: string }; Returns: Json }
      start_service: { Args: { p_ticket_id: string }; Returns: Json }
      ticket_status: { Args: { p_ticket_id: string }; Returns: Json }
      tv_state: { Args: { p_token: string }; Returns: Json }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "org_admin"
        | "chefe_turno"
        | "rececionista"
        | "medico"
      device_type: "quiosque" | "tv"
      org_plan: "starter" | "pro" | "enterprise"
      ticket_status:
        | "em_espera"
        | "chamado"
        | "em_atendimento"
        | "concluido"
        | "faltou"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "super_admin",
        "org_admin",
        "chefe_turno",
        "rececionista",
        "medico",
      ],
      device_type: ["quiosque", "tv"],
      org_plan: ["starter", "pro", "enterprise"],
      ticket_status: [
        "em_espera",
        "chamado",
        "em_atendimento",
        "concluido",
        "faltou",
      ],
    },
  },
} as const
