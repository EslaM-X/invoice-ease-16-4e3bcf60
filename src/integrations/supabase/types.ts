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
      backups_log: {
        Row: {
          created_at: string
          error: string | null
          id: string
          rows_count: number | null
          size_bytes: number | null
          status: string
          storage_path: string | null
          tables_count: number | null
          triggered_by: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          rows_count?: number | null
          size_bytes?: number | null
          status?: string
          storage_path?: string | null
          tables_count?: number | null
          triggered_by?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          rows_count?: number | null
          size_bytes?: number | null
          status?: string
          storage_path?: string | null
          tables_count?: number | null
          triggered_by?: string | null
        }
        Relationships: []
      }
      biometric_credentials: {
        Row: {
          created_at: string
          credential_id: string
          device_label: string | null
          id: string
          last_used_at: string | null
          platform: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          credential_id: string
          device_label?: string | null
          id?: string
          last_used_at?: string | null
          platform?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          credential_id?: string
          device_label?: string | null
          id?: string
          last_used_at?: string | null
          platform?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      call_logs: {
        Row: {
          agent_email: string | null
          agent_id: string
          call_type: string
          called_at: string
          created_at: string
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          duration_seconds: number | null
          id: string
          notes: string | null
          outcome: string | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          agent_email?: string | null
          agent_id: string
          call_type?: string
          called_at?: string
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          duration_seconds?: number | null
          id?: string
          notes?: string | null
          outcome?: string | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          agent_email?: string | null
          agent_id?: string
          call_type?: string
          called_at?: string
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          duration_seconds?: number | null
          id?: string
          notes?: string | null
          outcome?: string | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
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
      customer_ratings: {
        Row: {
          call_log_id: string | null
          comment: string | null
          created_at: string
          customer_id: string | null
          customer_name: string | null
          id: string
          rated_by: string
          rated_by_email: string | null
          rating: number
        }
        Insert: {
          call_log_id?: string | null
          comment?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          id?: string
          rated_by: string
          rated_by_email?: string | null
          rating: number
        }
        Update: {
          call_log_id?: string | null
          comment?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          id?: string
          rated_by?: string
          rated_by_email?: string | null
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_ratings_call_log_id_fkey"
            columns: ["call_log_id"]
            isOneToOne: false
            referencedRelation: "call_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_ratings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
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
      invoice_system_notes_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          changed_by_email: string | null
          id: string
          invoice_id: string
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          id?: string
          invoice_id: string
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          id?: string
          invoice_id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: []
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
          system_notes: string | null
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
          system_notes?: string | null
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
          system_notes?: string | null
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
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          meta: Json | null
          read_at: string | null
          recipient_role: Database["public"]["Enums"]["app_role"] | null
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          meta?: Json | null
          read_at?: string | null
          recipient_role?: Database["public"]["Enums"]["app_role"] | null
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          meta?: Json | null
          read_at?: string | null
          recipient_role?: Database["public"]["Enums"]["app_role"] | null
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      product_price_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          changed_by_email: string | null
          field: string
          id: string
          new_value: number | null
          old_value: number | null
          product_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          field: string
          id?: string
          new_value?: number | null
          old_value?: number | null
          product_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          field?: string
          id?: string
          new_value?: number | null
          old_value?: number | null
          product_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          collection: string | null
          color: string | null
          cost_price: number
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
          collection?: string | null
          color?: string | null
          cost_price?: number
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
          collection?: string | null
          color?: string | null
          cost_price?: number
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
          accent_preference: string | null
          account_type: string | null
          approval_notes: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          theme_preference: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accent_preference?: string | null
          account_type?: string | null
          approval_notes?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          theme_preference?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accent_preference?: string | null
          account_type?: string | null
          approval_notes?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          theme_preference?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          device_label: string | null
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          device_label?: string | null
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          device_label?: string | null
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      scan_events: {
        Row: {
          color: string | null
          created_at: string
          error_message: string | null
          id: string
          product_id: string | null
          product_name: string
          quantity: number
          serial_number: string | null
          session_id: string
          status: string
          unit_price: number
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          product_id?: string | null
          product_name: string
          quantity?: number
          serial_number?: string | null
          session_id: string
          status?: string
          unit_price?: number
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          serial_number?: string | null
          session_id?: string
          status?: string
          unit_price?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "scan_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          invoice_id: string | null
          mode: string
          pair_code: string
          paired_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          invoice_id?: string | null
          mode?: string
          pair_code: string
          paired_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          invoice_id?: string | null
          mode?: string
          pair_code?: string
          paired_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      service_reviews: {
        Row: {
          call_log_id: string | null
          created_at: string
          feedback: string | null
          flags: string[] | null
          id: string
          quality_score: number | null
          reviewer_email: string | null
          reviewer_id: string
        }
        Insert: {
          call_log_id?: string | null
          created_at?: string
          feedback?: string | null
          flags?: string[] | null
          id?: string
          quality_score?: number | null
          reviewer_email?: string | null
          reviewer_id: string
        }
        Update: {
          call_log_id?: string | null
          created_at?: string
          feedback?: string | null
          flags?: string[] | null
          id?: string
          quality_score?: number | null
          reviewer_email?: string | null
          reviewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_reviews_call_log_id_fkey"
            columns: ["call_log_id"]
            isOneToOne: false
            referencedRelation: "call_logs"
            referencedColumns: ["id"]
          },
        ]
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
      zoho_items: {
        Row: {
          available_stock: number
          color: string | null
          created_at: string
          deleted_from_zoho: boolean
          description: string | null
          hash: string | null
          image_document_id: string | null
          image_url: string | null
          item_id: string
          last_synced_at: string
          name: string
          rate_aed: number
          rate_egp: number
          raw: Json
          serial_number: string | null
          sku: string | null
          status: string
          stock_on_hand: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          available_stock?: number
          color?: string | null
          created_at?: string
          deleted_from_zoho?: boolean
          description?: string | null
          hash?: string | null
          image_document_id?: string | null
          image_url?: string | null
          item_id: string
          last_synced_at?: string
          name: string
          rate_aed?: number
          rate_egp?: number
          raw?: Json
          serial_number?: string | null
          sku?: string | null
          status?: string
          stock_on_hand?: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          available_stock?: number
          color?: string | null
          created_at?: string
          deleted_from_zoho?: boolean
          description?: string | null
          hash?: string | null
          image_document_id?: string | null
          image_url?: string | null
          item_id?: string
          last_synced_at?: string
          name?: string
          rate_aed?: number
          rate_egp?: number
          raw?: Json
          serial_number?: string | null
          sku?: string | null
          status?: string
          stock_on_hand?: number
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      zoho_settings: {
        Row: {
          aed_to_egp_rate: number
          id: string
          updated_at: string
          updated_by: string | null
          updated_by_email: string | null
        }
        Insert: {
          aed_to_egp_rate?: number
          id?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
        }
        Update: {
          aed_to_egp_rate?: number
          id?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
        }
        Relationships: []
      }
      zoho_sync_state: {
        Row: {
          id: string
          is_running: boolean
          items_added: number
          items_marked_deleted: number
          items_synced: number
          items_updated: number
          last_error: string | null
          last_error_at: string | null
          last_run_at: string | null
          last_success_at: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          is_running?: boolean
          items_added?: number
          items_marked_deleted?: number
          items_synced?: number
          items_updated?: number
          last_error?: string | null
          last_error_at?: string | null
          last_run_at?: string | null
          last_success_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          is_running?: boolean
          items_added?: number
          items_marked_deleted?: number
          items_synced?: number
          items_updated?: number
          last_error?: string | null
          last_error_at?: string | null
          last_run_at?: string | null
          last_success_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_stock: {
        Args: { _change: number; _product_id: string; _reason: string }
        Returns: string
      }
      can_access_call_center: { Args: never; Returns: boolean }
      can_access_user_data: { Args: { _owner_id: string }; Returns: boolean }
      create_invoice:
        | {
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
        | {
            Args: {
              _customer_id: string
              _discount: number
              _items: Json
              _language: string
              _notes: string
              _paid_amount?: number
              _system_notes?: string
            }
            Returns: string
          }
      delete_invoice: { Args: { _invoice_id: string }; Returns: string }
      get_my_role: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_allowed_company_email: { Args: { _email: string }; Returns: boolean }
      is_company_member: { Args: never; Returns: boolean }
      is_super_admin_email: { Args: { _email: string }; Returns: boolean }
      pair_scan_session: { Args: { _pair_code: string }; Returns: string }
      update_invoice:
        | {
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
        | {
            Args: {
              _customer_id: string
              _discount: number
              _invoice_id: string
              _items: Json
              _language: string
              _notes: string
              _paid_amount?: number
              _system_notes?: string
            }
            Returns: string
          }
      void_invoice: { Args: { _invoice_id: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "user" | "manager" | "cashier" | "call_center"
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
      app_role: ["admin", "user", "manager", "cashier", "call_center"],
    },
  },
} as const
