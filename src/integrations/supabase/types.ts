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
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      company_counters: {
        Row: {
          id: string
          receipt_seq: number
          updated_at: string
        }
        Insert: {
          id: string
          receipt_seq?: number
          updated_at?: string
        }
        Update: {
          id?: string
          receipt_seq?: number
          updated_at?: string
        }
        Relationships: []
      }
      company_members: {
        Row: {
          added_at: string
          email: string
          user_id: string
        }
        Insert: {
          added_at?: string
          email: string
          user_id: string
        }
        Update: {
          added_at?: string
          email?: string
          user_id?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string
          updated_by: string | null
          updated_by_email: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      inventory_logs: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          change: number
          created_at: string
          id: string
          invoice_id: string | null
          product_id: string
          reason: string | null
          user_id: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          change: number
          created_at?: string
          id?: string
          invoice_id?: string | null
          product_id: string
          reason?: string | null
          user_id: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          change?: number
          created_at?: string
          id?: string
          invoice_id?: string | null
          product_id?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_logs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_events: {
        Row: {
          created_at: string
          details: Json | null
          event_type: string
          id: string
          invoice_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          event_type: string
          id?: string
          invoice_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          event_type?: string
          id?: string
          invoice_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          color: string | null
          created_at: string
          discount: number
          id: string
          invoice_id: string
          line_total: number
          product_id: string | null
          product_name: string
          quantity: number
          serial_number: string | null
          unit_price: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          discount?: number
          id?: string
          invoice_id: string
          line_total?: number
          product_id?: string | null
          product_name: string
          quantity?: number
          serial_number?: string | null
          unit_price?: number
        }
        Update: {
          color?: string | null
          created_at?: string
          discount?: number
          id?: string
          invoice_id?: string
          line_total?: number
          product_id?: string | null
          product_name?: string
          quantity?: number
          serial_number?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_email: string | null
          customer_address: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          discount: number
          id: string
          invoice_number: string
          language: string
          notes: string | null
          paid_amount: number | null
          receipt_number: number | null
          status: string
          subtotal: number
          total: number
          updated_at: string
          updated_by: string | null
          updated_by_email: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          customer_address?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number
          id?: string
          invoice_number: string
          language?: string
          notes?: string | null
          paid_amount?: number | null
          receipt_number?: number | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          customer_address?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number
          id?: string
          invoice_number?: string
          language?: string
          notes?: string | null
          paid_amount?: number | null
          receipt_number?: number | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          id: string
          image_url: string | null
          low_stock_threshold: number
          name: string
          price: number
          qr_code: string | null
          serial_number: string | null
          stock_quantity: number
          updated_at: string
          updated_by: string | null
          updated_by_email: string | null
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          image_url?: string | null
          low_stock_threshold?: number
          name: string
          price?: number
          qr_code?: string | null
          serial_number?: string | null
          stock_quantity?: number
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          image_url?: string | null
          low_stock_threshold?: number
          name?: string
          price?: number
          qr_code?: string | null
          serial_number?: string | null
          stock_quantity?: number
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          company_address: string | null
          company_email: string | null
          company_name: string | null
          company_phone: string | null
          created_at: string
          currency: string
          default_language: string
          delivery_terms: string | null
          id: string
          logo_url: string | null
          payment_terms: string | null
          social_facebook: string | null
          social_instagram: string | null
          social_twitter: string | null
          social_website: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company_address?: string | null
          company_email?: string | null
          company_name?: string | null
          company_phone?: string | null
          created_at?: string
          currency?: string
          default_language?: string
          delivery_terms?: string | null
          id?: string
          logo_url?: string | null
          payment_terms?: string | null
          social_facebook?: string | null
          social_instagram?: string | null
          social_twitter?: string | null
          social_website?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          company_address?: string | null
          company_email?: string | null
          company_name?: string | null
          company_phone?: string | null
          created_at?: string
          currency?: string
          default_language?: string
          delivery_terms?: string | null
          id?: string
          logo_url?: string | null
          payment_terms?: string | null
          social_facebook?: string | null
          social_instagram?: string | null
          social_twitter?: string | null
          social_website?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_counters: {
        Row: {
          receipt_seq: number
          updated_at: string
          user_id: string
        }
        Insert: {
          receipt_seq?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          receipt_seq?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_user_data: { Args: { _owner_id: string }; Returns: boolean }
      create_invoice: {
        Args: {
          _customer_id: string
          _discount: number
          _items: Json
          _language: string
          _notes: string
          _paid_amount?: number
        }
        Returns: string
      }
      delete_invoice: { Args: { _invoice_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_allowed_company_email: { Args: { _email: string }; Returns: boolean }
      is_company_member: { Args: never; Returns: boolean }
      update_invoice: {
        Args: {
          _customer_id: string
          _discount: number
          _invoice_id: string
          _items: Json
          _language: string
          _notes: string
          _paid_amount?: number
        }
        Returns: string
      }
      void_invoice: { Args: { _invoice_id: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "user"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "user"],
    },
  },
} as const
