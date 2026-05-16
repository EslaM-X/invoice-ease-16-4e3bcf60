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
      biometric_auth_log: {
        Row: {
          created_at: string
          credential_id: string | null
          device_label: string | null
          email: string | null
          error_message: string | null
          id: string
          platform: string | null
          status: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          credential_id?: string | null
          device_label?: string | null
          email?: string | null
          error_message?: string | null
          id?: string
          platform?: string | null
          status: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          credential_id?: string | null
          device_label?: string | null
          email?: string | null
          error_message?: string | null
          id?: string
          platform?: string | null
          status?: string
          user_agent?: string | null
          user_id?: string | null
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
      delivery_receipt_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after_data: Json | null
          before_data: Json | null
          changed_fields: string[] | null
          created_at: string
          id: string
          receipt_id: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          changed_fields?: string[] | null
          created_at?: string
          id?: string
          receipt_id: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          changed_fields?: string[] | null
          created_at?: string
          id?: string
          receipt_id?: string
        }
        Relationships: []
      }
      delivery_receipt_items: {
        Row: {
          color: string | null
          created_at: string
          id: string
          invoice_item_id: string | null
          note: string | null
          product_name: string
          quantity: number
          receipt_id: string
          serial_number: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          invoice_item_id?: string | null
          note?: string | null
          product_name: string
          quantity: number
          receipt_id: string
          serial_number?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          invoice_item_id?: string | null
          note?: string | null
          product_name?: string
          quantity?: number
          receipt_id?: string
          serial_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_receipt_items_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: false
            referencedRelation: "invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_receipt_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "delivery_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_receipts: {
        Row: {
          accountant_name: string | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          delivered_at: string
          delivered_to_id_number: string | null
          delivered_to_name: string | null
          delivered_to_phone: string | null
          id: string
          invoice_id: string
          manager_name: string | null
          notes: string | null
          receipt_number: string
          shipping_fees: number | null
          signature_accountant: string | null
          signature_customer: string | null
          signature_manager: string | null
          status: string
          updated_at: string
          updated_by: string | null
          updated_by_email: string | null
          user_id: string
        }
        Insert: {
          accountant_name?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          delivered_at?: string
          delivered_to_id_number?: string | null
          delivered_to_name?: string | null
          delivered_to_phone?: string | null
          id?: string
          invoice_id: string
          manager_name?: string | null
          notes?: string | null
          receipt_number: string
          shipping_fees?: number | null
          signature_accountant?: string | null
          signature_customer?: string | null
          signature_manager?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id: string
        }
        Update: {
          accountant_name?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          delivered_at?: string
          delivered_to_id_number?: string | null
          delivered_to_name?: string | null
          delivered_to_phone?: string | null
          id?: string
          invoice_id?: string
          manager_name?: string | null
          notes?: string | null
          receipt_number?: string
          shipping_fees?: number | null
          signature_accountant?: string | null
          signature_customer?: string | null
          signature_manager?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_receipts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
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
          delivery_status: string
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
          delivery_status?: string
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
          delivery_status?: string
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
      notification_dispatch_config: {
        Row: {
          dispatch_url: string
          hmac_secret: string
          id: number
          updated_at: string
        }
        Insert: {
          dispatch_url: string
          hmac_secret: string
          id?: number
          updated_at?: string
        }
        Update: {
          dispatch_url?: string
          hmac_secret?: string
          id?: number
          updated_at?: string
        }
        Relationships: []
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
      po_profit_scenarios: {
        Row: {
          created_at: string
          discount_mode: string
          discount_value: number
          id: string
          notes: string | null
          po_id: string
          selling_overrides: Json
          updated_at: string
          updated_by: string | null
          updated_by_email: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          discount_mode?: string
          discount_value?: number
          id?: string
          notes?: string | null
          po_id: string
          selling_overrides?: Json
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          discount_mode?: string
          discount_value?: number
          id?: string
          notes?: string | null
          po_id?: string
          selling_overrides?: Json
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "po_profit_scenarios_po_fk"
            columns: ["po_id"]
            isOneToOne: true
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      po_receipt_items: {
        Row: {
          color: string | null
          created_at: string
          id: string
          po_item_id: string
          product_id: string
          product_name: string
          quantity: number
          receipt_id: string
          serial_number: string | null
          stock_after: number | null
          stock_before: number | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          po_item_id: string
          product_id: string
          product_name: string
          quantity: number
          receipt_id: string
          serial_number?: string | null
          stock_after?: number | null
          stock_before?: number | null
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          po_item_id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          receipt_id?: string
          serial_number?: string | null
          stock_after?: number | null
          stock_before?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "po_receipt_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "po_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      po_receipts: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          created_at: string
          id: string
          notes: string | null
          po_id: string
          receipt_number: number
          total_qty: number
          user_id: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          po_id: string
          receipt_number: number
          total_qty?: number
          user_id: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          po_id?: string
          receipt_number?: number
          total_qty?: number
          user_id?: string
        }
        Relationships: []
      }
      po_status_history: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          created_at: string
          from_status: string | null
          id: string
          note: string | null
          po_id: string
          to_status: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          po_id: string
          to_status: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          po_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "po_status_history_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
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
          cost_price_usd: number
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
          cost_price_usd?: number
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
          cost_price_usd?: number
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
      purchase_order_items: {
        Row: {
          color: string | null
          created_at: string
          id: string
          image_url: string | null
          line_total_usd: number
          po_id: string
          product_id: string
          product_name: string
          quantity: number
          received_qty: number
          serial_number: string | null
          unit_cost_usd: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          line_total_usd?: number
          po_id: string
          product_id: string
          product_name: string
          quantity: number
          received_qty?: number
          serial_number?: string | null
          unit_cost_usd?: number
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          line_total_usd?: number
          po_id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          received_qty?: number
          serial_number?: string | null
          unit_cost_usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          cfo_notes: string | null
          cfo_priced_at: string | null
          cfo_priced_by: string | null
          cfo_priced_by_email: string | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          customs_mode: string | null
          customs_value: number | null
          expected_arrival_at: string | null
          final_discount_mode: string
          final_discount_percent: number
          final_discount_value: number
          id: string
          notes: string | null
          other_mode: string | null
          other_value: number | null
          paid_at: string | null
          paid_by: string | null
          paid_by_email: string | null
          payment_installment_1_amount: number | null
          payment_installment_1_at: string | null
          payment_installment_1_by_email: string | null
          payment_installment_2_amount: number | null
          payment_installment_2_at: string | null
          payment_installment_2_by_email: string | null
          po_number: string
          received_at: string | null
          received_by: string | null
          received_by_email: string | null
          shipped_at: string | null
          shipping_mode: string | null
          shipping_value: number | null
          status: string
          stock_applied_at: string | null
          supplier_name: string | null
          taxes_mode: string | null
          taxes_value: number | null
          total_egp: number | null
          total_qty: number
          total_usd: number
          updated_at: string
          usd_rate: number | null
          user_id: string
        }
        Insert: {
          cfo_notes?: string | null
          cfo_priced_at?: string | null
          cfo_priced_by?: string | null
          cfo_priced_by_email?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          customs_mode?: string | null
          customs_value?: number | null
          expected_arrival_at?: string | null
          final_discount_mode?: string
          final_discount_percent?: number
          final_discount_value?: number
          id?: string
          notes?: string | null
          other_mode?: string | null
          other_value?: number | null
          paid_at?: string | null
          paid_by?: string | null
          paid_by_email?: string | null
          payment_installment_1_amount?: number | null
          payment_installment_1_at?: string | null
          payment_installment_1_by_email?: string | null
          payment_installment_2_amount?: number | null
          payment_installment_2_at?: string | null
          payment_installment_2_by_email?: string | null
          po_number: string
          received_at?: string | null
          received_by?: string | null
          received_by_email?: string | null
          shipped_at?: string | null
          shipping_mode?: string | null
          shipping_value?: number | null
          status?: string
          stock_applied_at?: string | null
          supplier_name?: string | null
          taxes_mode?: string | null
          taxes_value?: number | null
          total_egp?: number | null
          total_qty?: number
          total_usd?: number
          updated_at?: string
          usd_rate?: number | null
          user_id: string
        }
        Update: {
          cfo_notes?: string | null
          cfo_priced_at?: string | null
          cfo_priced_by?: string | null
          cfo_priced_by_email?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          customs_mode?: string | null
          customs_value?: number | null
          expected_arrival_at?: string | null
          final_discount_mode?: string
          final_discount_percent?: number
          final_discount_value?: number
          id?: string
          notes?: string | null
          other_mode?: string | null
          other_value?: number | null
          paid_at?: string | null
          paid_by?: string | null
          paid_by_email?: string | null
          payment_installment_1_amount?: number | null
          payment_installment_1_at?: string | null
          payment_installment_1_by_email?: string | null
          payment_installment_2_amount?: number | null
          payment_installment_2_at?: string | null
          payment_installment_2_by_email?: string | null
          po_number?: string
          received_at?: string | null
          received_by?: string | null
          received_by_email?: string | null
          shipped_at?: string | null
          shipping_mode?: string | null
          shipping_value?: number | null
          status?: string
          stock_applied_at?: string | null
          supplier_name?: string | null
          taxes_mode?: string | null
          taxes_value?: number | null
          total_egp?: number | null
          total_qty?: number
          total_usd?: number
          updated_at?: string
          usd_rate?: number | null
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
      stock_intake_items: {
        Row: {
          color: string | null
          created_at: string
          id: string
          intake_id: string
          line_total: number
          new_avg_cost: number | null
          previous_cost: number | null
          previous_stock: number | null
          product_id: string
          product_name: string
          quantity: number
          serial_number: string | null
          unit_cost: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          intake_id: string
          line_total?: number
          new_avg_cost?: number | null
          previous_cost?: number | null
          previous_stock?: number | null
          product_id: string
          product_name: string
          quantity: number
          serial_number?: string | null
          unit_cost?: number
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          intake_id?: string
          line_total?: number
          new_avg_cost?: number | null
          previous_cost?: number | null
          previous_stock?: number | null
          product_id?: string
          product_name?: string
          quantity?: number
          serial_number?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_intake_items_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "stock_intakes"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_intakes: {
        Row: {
          bulk_total: number | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          id: string
          intake_number: string
          invoice_reference: string | null
          notes: string | null
          pricing_mode: string
          supplier_name: string | null
          total_cost: number
          total_qty: number
          user_id: string
        }
        Insert: {
          bulk_total?: number | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          intake_number: string
          invoice_reference?: string | null
          notes?: string | null
          pricing_mode?: string
          supplier_name?: string | null
          total_cost?: number
          total_qty?: number
          user_id: string
        }
        Update: {
          bulk_total?: number | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          intake_number?: string
          invoice_reference?: string | null
          notes?: string | null
          pricing_mode?: string
          supplier_name?: string | null
          total_cost?: number
          total_qty?: number
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
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
      user_notification_preferences: {
        Row: {
          created_at: string
          custom_sound_name: string | null
          custom_sound_url: string | null
          push_enabled: boolean
          sound: string
          updated_at: string
          user_id: string
          vibration: string
        }
        Insert: {
          created_at?: string
          custom_sound_name?: string | null
          custom_sound_url?: string | null
          push_enabled?: boolean
          sound?: string
          updated_at?: string
          user_id: string
          vibration?: string
        }
        Update: {
          created_at?: string
          custom_sound_name?: string | null
          custom_sound_url?: string | null
          push_enabled?: boolean
          sound?: string
          updated_at?: string
          user_id?: string
          vibration?: string
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
      x_calendar_events: {
        Row: {
          all_day: boolean
          company_id: string | null
          created_at: string
          ends_at: string | null
          id: string
          kind: string
          location: string | null
          metadata: Json
          notes: string | null
          remind_before_minutes: number[]
          starts_at: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          all_day?: boolean
          company_id?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          kind?: string
          location?: string | null
          metadata?: Json
          notes?: string | null
          remind_before_minutes?: number[]
          starts_at: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          all_day?: boolean
          company_id?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          kind?: string
          location?: string | null
          metadata?: Json
          notes?: string | null
          remind_before_minutes?: number[]
          starts_at?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      x_conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      x_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          tool_call_id: string | null
          tool_calls: Json | null
          user_id: string
        }
        Insert: {
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          tool_call_id?: string | null
          tool_calls?: Json | null
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          tool_call_id?: string | null
          tool_calls?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "x_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "x_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      x_notifications: {
        Row: {
          body: string | null
          created_at: string
          delivered_at: string | null
          event_id: string | null
          id: string
          kind: string
          metadata: Json
          read_at: string | null
          scheduled_for: string
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          delivered_at?: string | null
          event_id?: string | null
          id?: string
          kind?: string
          metadata?: Json
          read_at?: string | null
          scheduled_for: string
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          delivered_at?: string | null
          event_id?: string | null
          id?: string
          kind?: string
          metadata?: Json
          read_at?: string | null
          scheduled_for?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "x_notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "x_calendar_events"
            referencedColumns: ["id"]
          },
        ]
      }
      x_user_profile: {
        Row: {
          frequent_topics: Json
          message_count: number
          preferences: Json
          summary: string | null
          tone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          frequent_topics?: Json
          message_count?: number
          preferences?: Json
          summary?: string | null
          tone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          frequent_topics?: Json
          message_count?: number
          preferences?: Json
          summary?: string | null
          tone?: string | null
          updated_at?: string
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
      apply_po_receipt: {
        Args: {
          items_in: Json
          p_actor_email: string
          p_notes: string
          p_po_id: string
        }
        Returns: Json
      }
      apply_po_to_inventory: {
        Args: { items_in: Json; p_actor_email: string; p_po_id: string }
        Returns: Json
      }
      can_access_call_center: { Args: never; Returns: boolean }
      can_access_user_data: { Args: { _owner_id: string }; Returns: boolean }
      create_delivery_receipt:
        | {
            Args: {
              _accountant_name: string
              _delivered_to_id_number: string
              _delivered_to_name: string
              _delivered_to_phone: string
              _invoice_id: string
              _items: Json
              _manager_name: string
              _notes: string
              _signature_accountant: string
              _signature_customer: string
              _signature_manager: string
              _status: string
            }
            Returns: string
          }
        | {
            Args: {
              _accountant_name: string
              _delivered_to_id_number: string
              _delivered_to_name: string
              _delivered_to_phone: string
              _invoice_id: string
              _items: Json
              _manager_name: string
              _notes: string
              _shipping_fees?: number
              _signature_accountant: string
              _signature_customer: string
              _signature_manager: string
              _status: string
            }
            Returns: string
          }
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
      current_user_email: { Args: never; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_invoice: { Args: { _invoice_id: string }; Returns: string }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
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
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      notify_company: {
        Args: {
          p_body: string
          p_link: string
          p_meta: Json
          p_only_roles?: Database["public"]["Enums"]["app_role"][]
          p_title: string
          p_type: string
        }
        Returns: undefined
      }
      pair_scan_session: { Args: { _pair_code: string }; Returns: string }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      recalc_invoice_delivery_status: {
        Args: { _invoice_id: string }
        Returns: undefined
      }
      record_stock_intake: {
        Args: {
          _bulk_total: number
          _invoice_reference: string
          _items: Json
          _notes: string
          _pricing_mode: string
          _supplier_name: string
        }
        Returns: string
      }
      revert_po_inventory: {
        Args: { p_actor_email: string; p_po_id: string }
        Returns: undefined
      }
      update_delivery_receipt:
        | {
            Args: {
              _accountant_name: string
              _delivered_to_id_number: string
              _delivered_to_name: string
              _delivered_to_phone: string
              _items: Json
              _manager_name: string
              _notes: string
              _receipt_id: string
              _signature_accountant: string
              _signature_customer: string
              _signature_manager: string
              _status: string
            }
            Returns: string
          }
        | {
            Args: {
              _accountant_name: string
              _delivered_to_id_number: string
              _delivered_to_name: string
              _delivered_to_phone: string
              _items: Json
              _manager_name: string
              _notes: string
              _receipt_id: string
              _shipping_fees?: number
              _signature_accountant: string
              _signature_customer: string
              _signature_manager: string
              _status: string
            }
            Returns: string
          }
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
      app_role:
        | "admin"
        | "user"
        | "manager"
        | "cashier"
        | "call_center"
        | "purchasing"
        | "cfo"
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
      app_role: [
        "admin",
        "user",
        "manager",
        "cashier",
        "call_center",
        "purchasing",
        "cfo",
      ],
    },
  },
} as const
