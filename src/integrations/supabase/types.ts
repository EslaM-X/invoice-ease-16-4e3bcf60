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
      app_updates: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_email: string | null
          download_url: string
          id: string
          is_mandatory: boolean
          platform: Database["public"]["Enums"]["app_platform"]
          release_notes: string | null
          released_at: string
          updated_at: string
          version: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          download_url: string
          id?: string
          is_mandatory?: boolean
          platform: Database["public"]["Enums"]["app_platform"]
          release_notes?: string | null
          released_at?: string
          updated_at?: string
          version: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          download_url?: string
          id?: string
          is_mandatory?: boolean
          platform?: Database["public"]["Enums"]["app_platform"]
          release_notes?: string | null
          released_at?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
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
      bulk_receipt_ops: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          back_deducted_dri_ids: string[]
          batch_count: number
          created_at: string
          id: string
          payload: Json
          po_count: number
          receipt_ids: string[]
          result: Json | null
          revert_reason: string | null
          reverted_at: string | null
          reverted_by_email: string | null
          total_qty: number
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          back_deducted_dri_ids?: string[]
          batch_count?: number
          created_at?: string
          id?: string
          payload: Json
          po_count?: number
          receipt_ids?: string[]
          result?: Json | null
          revert_reason?: string | null
          reverted_at?: string | null
          reverted_by_email?: string | null
          total_qty?: number
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          back_deducted_dri_ids?: string[]
          batch_count?: number
          created_at?: string
          id?: string
          payload?: Json
          po_count?: number
          receipt_ids?: string[]
          result?: Json | null
          revert_reason?: string | null
          reverted_at?: string | null
          reverted_by_email?: string | null
          total_qty?: number
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
          invoice_id: string | null
          invoice_number: string | null
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
          invoice_id?: string | null
          invoice_number?: string | null
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
          invoice_id?: string | null
          invoice_number?: string | null
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
          {
            foreignKeyName: "call_logs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_message_reads: {
        Row: {
          message_id: string
          read_at: string
          room_id: string
          user_id: string
        }
        Insert: {
          message_id: string
          read_at?: string
          room_id: string
          user_id: string
        }
        Update: {
          message_id?: string
          read_at?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_reads_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          attachments: Json
          body: string | null
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          message_type: string
          reply_to_id: string | null
          room_id: string
          sender_email: string | null
          sender_id: string
          voice_duration_seconds: number | null
          voice_note_url: string | null
        }
        Insert: {
          attachments?: Json
          body?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          message_type?: string
          reply_to_id?: string | null
          room_id: string
          sender_email?: string | null
          sender_id: string
          voice_duration_seconds?: number | null
          voice_note_url?: string | null
        }
        Update: {
          attachments?: Json
          body?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          message_type?: string
          reply_to_id?: string | null
          room_id?: string
          sender_email?: string | null
          sender_id?: string
          voice_duration_seconds?: number | null
          voice_note_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_presence: {
        Row: {
          last_seen_at: string
          status: string
          typing_at: string | null
          typing_room_id: string | null
          updated_at: string
          user_email: string | null
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          status?: string
          typing_at?: string | null
          typing_room_id?: string | null
          updated_at?: string
          user_email?: string | null
          user_id: string
        }
        Update: {
          last_seen_at?: string
          status?: string
          typing_at?: string | null
          typing_room_id?: string | null
          updated_at?: string
          user_email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      chat_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_room_members: {
        Row: {
          id: string
          is_admin: boolean
          joined_at: string
          last_read_at: string
          muted: boolean
          role: string
          room_id: string
          user_email: string | null
          user_id: string
        }
        Insert: {
          id?: string
          is_admin?: boolean
          joined_at?: string
          last_read_at?: string
          muted?: boolean
          role?: string
          room_id: string
          user_email?: string | null
          user_id: string
        }
        Update: {
          id?: string
          is_admin?: boolean
          joined_at?: string
          last_read_at?: string
          muted?: boolean
          role?: string
          room_id?: string
          user_email?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_rooms: {
        Row: {
          avatar_url: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          last_message_at: string
          last_message_preview: string | null
          name: string | null
          type: string
          updated_at: string
          wallpaper: Json | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          name?: string | null
          type?: string
          updated_at?: string
          wallpaper?: Json | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          name?: string | null
          type?: string
          updated_at?: string
          wallpaper?: Json | null
        }
        Relationships: []
      }
      collections: {
        Row: {
          code: string
          color_hex: string
          created_at: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
          updated_at: string
          updated_by_email: string | null
        }
        Insert: {
          code: string
          color_hex?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          updated_at?: string
          updated_by_email?: string | null
        }
        Update: {
          code?: string
          color_hex?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          updated_at?: string
          updated_by_email?: string | null
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
          category: string | null
          company_name: string | null
          contact_person: string | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          id: string
          name: string
          phone: string | null
          sales_channel: string | null
          sales_event_id: string | null
          source_notes: string | null
          updated_at: string
          updated_by: string | null
          updated_by_email: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          category?: string | null
          company_name?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          name: string
          phone?: string | null
          sales_channel?: string | null
          sales_event_id?: string | null
          source_notes?: string | null
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          category?: string | null
          company_name?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          name?: string
          phone?: string | null
          sales_channel?: string | null
          sales_event_id?: string | null
          source_notes?: string | null
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_sales_event_id_fkey"
            columns: ["sales_event_id"]
            isOneToOne: false
            referencedRelation: "sales_events"
            referencedColumns: ["id"]
          },
        ]
      }
      defective_item_returns: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          created_at: string
          defective_item_id: string
          id: string
          notes: string | null
          quantity: number
          user_id: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          defective_item_id: string
          id?: string
          notes?: string | null
          quantity: number
          user_id: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          defective_item_id?: string
          id?: string
          notes?: string | null
          quantity?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "defective_item_returns_defective_item_id_fkey"
            columns: ["defective_item_id"]
            isOneToOne: false
            referencedRelation: "defective_items"
            referencedColumns: ["id"]
          },
        ]
      }
      defective_items: {
        Row: {
          color: string | null
          created_at: string
          id: string
          item_type: string
          notes: string | null
          product_id: string
          product_name: string
          quantity: number
          reason: string
          registered_by: string | null
          registered_by_email: string | null
          returned_quantity: number
          serial_number: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          item_type?: string
          notes?: string | null
          product_id: string
          product_name: string
          quantity: number
          reason: string
          registered_by?: string | null
          registered_by_email?: string | null
          returned_quantity?: number
          serial_number?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          item_type?: string
          notes?: string | null
          product_id?: string
          product_name?: string
          quantity?: number
          reason?: string
          registered_by?: string | null
          registered_by_email?: string | null
          returned_quantity?: number
          serial_number?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "defective_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
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
          back_deducted_at: string | null
          back_deducted_by_email: string | null
          back_deducted_from_po: string | null
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
          back_deducted_at?: string | null
          back_deducted_by_email?: string | null
          back_deducted_from_po?: string | null
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
          back_deducted_at?: string | null
          back_deducted_by_email?: string | null
          back_deducted_from_po?: string | null
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
          archived_at: string | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          delivered_at: string
          delivered_to_id_number: string | null
          delivered_to_name: string | null
          delivered_to_phone: string | null
          id: string
          invoice_id: string
          layout_version: number
          manager_name: string | null
          notes: string | null
          receipt_number: string
          shipping_fees: number | null
          signature_accountant: string | null
          signature_customer: string | null
          signature_manager: string | null
          status: string
          status_reason: string | null
          tax_enabled: boolean
          tax_rate: number
          updated_at: string
          updated_by: string | null
          updated_by_email: string | null
          user_id: string
        }
        Insert: {
          accountant_name?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          delivered_at?: string
          delivered_to_id_number?: string | null
          delivered_to_name?: string | null
          delivered_to_phone?: string | null
          id?: string
          invoice_id: string
          layout_version?: number
          manager_name?: string | null
          notes?: string | null
          receipt_number: string
          shipping_fees?: number | null
          signature_accountant?: string | null
          signature_customer?: string | null
          signature_manager?: string | null
          status?: string
          status_reason?: string | null
          tax_enabled?: boolean
          tax_rate?: number
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id: string
        }
        Update: {
          accountant_name?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          delivered_at?: string
          delivered_to_id_number?: string | null
          delivered_to_name?: string | null
          delivered_to_phone?: string | null
          id?: string
          invoice_id?: string
          layout_version?: number
          manager_name?: string | null
          notes?: string | null
          receipt_number?: string
          shipping_fees?: number | null
          signature_accountant?: string | null
          signature_customer?: string | null
          signature_manager?: string | null
          status?: string
          status_reason?: string | null
          tax_enabled?: boolean
          tax_rate?: number
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
      distributor_payouts: {
        Row: {
          amount: number
          created_at: string
          distributor_id: string
          id: string
          notes: string | null
          paid_at: string
          paid_by: string | null
          paid_by_email: string | null
          payout_method: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          distributor_id: string
          id?: string
          notes?: string | null
          paid_at?: string
          paid_by?: string | null
          paid_by_email?: string | null
          payout_method?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          distributor_id?: string
          id?: string
          notes?: string | null
          paid_at?: string
          paid_by?: string | null
          paid_by_email?: string | null
          payout_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "distributor_payouts_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributor_balances"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "distributor_payouts_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
        ]
      }
      distributor_stock_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          distributor_id: string
          id: string
          notes: string | null
          product_id: string | null
          updated_at: string
          visible_pct: number | null
          visible_qty: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          distributor_id: string
          id?: string
          notes?: string | null
          product_id?: string | null
          updated_at?: string
          visible_pct?: number | null
          visible_qty?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          distributor_id?: string
          id?: string
          notes?: string | null
          product_id?: string | null
          updated_at?: string
          visible_pct?: number | null
          visible_qty?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "distributor_stock_overrides_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributor_balances"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "distributor_stock_overrides_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_stock_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      distributors: {
        Row: {
          address: string | null
          branches_count: number
          city: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          is_active: boolean
          location: string | null
          name: string
          notes: string | null
          phone: string | null
          showroom_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          branches_count?: number
          city?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          showroom_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          branches_count?: number
          city?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          showroom_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      fulfillment_audit_log: {
        Row: {
          action: string
          confidence: number
          created_at: string
          id: string
          invoice_id: string
          invoice_number: string
          manual_count: number
          mode: string
          needs: Json
          note: string | null
          reasons: Json
          tier: string
          total_from_incoming: number
          total_from_stock: number
          total_needed: number
          total_shortfall: number
          user_id: string
        }
        Insert: {
          action: string
          confidence?: number
          created_at?: string
          id?: string
          invoice_id: string
          invoice_number: string
          manual_count?: number
          mode: string
          needs?: Json
          note?: string | null
          reasons?: Json
          tier: string
          total_from_incoming?: number
          total_from_stock?: number
          total_needed?: number
          total_shortfall?: number
          user_id: string
        }
        Update: {
          action?: string
          confidence?: number
          created_at?: string
          id?: string
          invoice_id?: string
          invoice_number?: string
          manual_count?: number
          mode?: string
          needs?: Json
          note?: string | null
          reasons?: Json
          tier?: string
          total_from_incoming?: number
          total_from_stock?: number
          total_needed?: number
          total_shortfall?: number
          user_id?: string
        }
        Relationships: []
      }
      inventory_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
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
      invoice_po_reservations: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_email: string | null
          fulfilled_at: string | null
          id: string
          invoice_id: string
          invoice_item_id: string | null
          po_id: string | null
          po_item_id: string | null
          product_id: string
          quantity: number
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          fulfilled_at?: string | null
          id?: string
          invoice_id: string
          invoice_item_id?: string | null
          po_id?: string | null
          po_item_id?: string | null
          product_id: string
          quantity: number
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          fulfilled_at?: string | null
          id?: string
          invoice_id?: string
          invoice_item_id?: string | null
          po_id?: string | null
          po_item_id?: string | null
          product_id?: string
          quantity?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_po_reservations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_po_reservations_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: false
            referencedRelation: "invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_po_reservations_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_po_reservations_po_item_id_fkey"
            columns: ["po_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_po_reservations_product_id_fkey"
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
          approval_discount_pct: number
          approval_notes: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          customer_address: string | null
          customer_category: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          delivery_days: number | null
          delivery_status: string
          discount: number
          distributor_commission_amount: number
          distributor_id: string | null
          id: string
          invoice_number: string
          language: string
          notes: string | null
          paid_amount: number | null
          receipt_number: number | null
          rejected_at: string | null
          rejected_by: string | null
          sales_channel: string | null
          sales_event_id: string | null
          shipping_address: string | null
          source: string
          status: string
          subject: string | null
          subtotal: number
          system_notes: string | null
          tax_enabled: boolean
          tax_rate: number
          total: number
          updated_at: string
          updated_by: string | null
          updated_by_email: string | null
          user_id: string
        }
        Insert: {
          approval_discount_pct?: number
          approval_notes?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          customer_address?: string | null
          customer_category?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivery_days?: number | null
          delivery_status?: string
          discount?: number
          distributor_commission_amount?: number
          distributor_id?: string | null
          id?: string
          invoice_number: string
          language?: string
          notes?: string | null
          paid_amount?: number | null
          receipt_number?: number | null
          rejected_at?: string | null
          rejected_by?: string | null
          sales_channel?: string | null
          sales_event_id?: string | null
          shipping_address?: string | null
          source?: string
          status?: string
          subject?: string | null
          subtotal?: number
          system_notes?: string | null
          tax_enabled?: boolean
          tax_rate?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id: string
        }
        Update: {
          approval_discount_pct?: number
          approval_notes?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          customer_address?: string | null
          customer_category?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivery_days?: number | null
          delivery_status?: string
          discount?: number
          distributor_commission_amount?: number
          distributor_id?: string | null
          id?: string
          invoice_number?: string
          language?: string
          notes?: string | null
          paid_amount?: number | null
          receipt_number?: number | null
          rejected_at?: string | null
          rejected_by?: string | null
          sales_channel?: string | null
          sales_event_id?: string | null
          shipping_address?: string | null
          source?: string
          status?: string
          subject?: string | null
          subtotal?: number
          system_notes?: string | null
          tax_enabled?: boolean
          tax_rate?: number
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
          {
            foreignKeyName: "invoices_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributor_balances"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "invoices_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_sales_event_id_fkey"
            columns: ["sales_event_id"]
            isOneToOne: false
            referencedRelation: "sales_events"
            referencedColumns: ["id"]
          },
        ]
      }
      leadership_card_viewers: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          id: string
          note: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          id?: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: []
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
      payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          created_by_email: string | null
          id: string
          invoice_id: string
          method: string
          notes: string | null
          paid_at: string
          reference: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          invoice_id: string
          method?: string
          notes?: string | null
          paid_at?: string
          reference?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          invoice_id?: string
          method?: string
          notes?: string | null
          paid_at?: string
          reference?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
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
          discount_amount: number
          id: string
          notes: string | null
          po_id: string
          receipt_code: string | null
          receipt_date: string
          receipt_number: number
          total_qty: number
          user_id: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          discount_amount?: number
          id?: string
          notes?: string | null
          po_id: string
          receipt_code?: string | null
          receipt_date?: string
          receipt_number: number
          total_qty?: number
          user_id: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          discount_amount?: number
          id?: string
          notes?: string | null
          po_id?: string
          receipt_code?: string | null
          receipt_date?: string
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
      price_list_items: {
        Row: {
          category: string
          collection: string
          color: string | null
          color_hex: string | null
          created_at: string
          currency: string
          id: string
          image_url: string | null
          is_active: boolean
          name_ar: string | null
          name_en: string
          price: number
          qr_payload: string
          sku: string
          sort_order: number
          updated_at: string
          updated_by: string | null
          updated_by_email: string | null
        }
        Insert: {
          category: string
          collection: string
          color?: string | null
          color_hex?: string | null
          created_at?: string
          currency?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          name_ar?: string | null
          name_en: string
          price?: number
          qr_payload: string
          sku: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
        }
        Update: {
          category?: string
          collection?: string
          color?: string | null
          color_hex?: string | null
          created_at?: string
          currency?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          name_ar?: string | null
          name_en?: string
          price?: number
          qr_payload?: string
          sku?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
        }
        Relationships: []
      }
      price_list_price_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          changed_by_email: string | null
          id: string
          item_id: string
          new_price: number | null
          old_price: number | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          id?: string
          item_id: string
          new_price?: number | null
          old_price?: number | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          id?: string
          item_id?: string
          new_price?: number | null
          old_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "price_list_price_history_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "price_list_items"
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
          is_spare_part: boolean
          low_stock_threshold: number
          name: string
          parent_product_id: string | null
          price: number
          qr_code: string | null
          safety_margin: number
          serial_number: string | null
          stock_quantity: number
          updated_at: string
          updated_by: string | null
          updated_by_email: string | null
          user_id: string
          weight_grams: number | null
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
          is_spare_part?: boolean
          low_stock_threshold?: number
          name: string
          parent_product_id?: string | null
          price?: number
          qr_code?: string | null
          safety_margin?: number
          serial_number?: string | null
          stock_quantity?: number
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id: string
          weight_grams?: number | null
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
          is_spare_part?: boolean
          low_stock_threshold?: number
          name?: string
          parent_product_id?: string | null
          price?: number
          qr_code?: string | null
          safety_margin?: number
          serial_number?: string | null
          stock_quantity?: number
          updated_at?: string
          updated_by?: string | null
          updated_by_email?: string | null
          user_id?: string
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
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
          hide_from_leadership_card: boolean
          hide_job_title: boolean
          id: string
          job_title: string | null
          job_title_color: string | null
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
          hide_from_leadership_card?: boolean
          hide_job_title?: boolean
          id?: string
          job_title?: string | null
          job_title_color?: string | null
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
          hide_from_leadership_card?: boolean
          hide_job_title?: boolean
          id?: string
          job_title?: string | null
          job_title_color?: string | null
          theme_preference?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profit_cost_overrides: {
        Row: {
          cost_egp: number
          created_at: string
          note: string | null
          product_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cost_egp?: number
          created_at?: string
          note?: string | null
          product_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cost_egp?: number
          created_at?: string
          note?: string | null
          product_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profit_cost_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      profit_cost_overrides_history: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          changed_by_email: string | null
          id: string
          new_cost_egp: number | null
          new_note: string | null
          old_cost_egp: number | null
          old_note: string | null
          product_id: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          id?: string
          new_cost_egp?: number | null
          new_note?: string | null
          old_cost_egp?: number | null
          old_note?: string | null
          product_id: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          id?: string
          new_cost_egp?: number | null
          new_note?: string | null
          old_cost_egp?: number | null
          old_note?: string | null
          product_id?: string
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
          unit_weight_grams: number | null
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
          unit_weight_grams?: number | null
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
          unit_weight_grams?: number | null
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
          received_without_payment: boolean
          shipment_code: string | null
          shipment_date: string
          shipment_type: string
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
          received_without_payment?: boolean
          shipment_code?: string | null
          shipment_date?: string
          shipment_type?: string
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
          received_without_payment?: boolean
          shipment_code?: string | null
          shipment_date?: string
          shipment_type?: string
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
      sales_events: {
        Row: {
          created_at: string
          created_by: string | null
          ends_at: string | null
          event_type: string
          id: string
          is_active: boolean
          location: string | null
          name: string
          notes: string | null
          starts_at: string | null
          updated_at: string
          year: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          event_type?: string
          id?: string
          is_active?: boolean
          location?: string | null
          name: string
          notes?: string | null
          starts_at?: string | null
          updated_at?: string
          year?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          event_type?: string
          id?: string
          is_active?: boolean
          location?: string | null
          name?: string
          notes?: string | null
          starts_at?: string | null
          updated_at?: string
          year?: number | null
        }
        Relationships: []
      }
      sample_return_items: {
        Row: {
          created_at: string
          defective_item_id: string
          id: string
          quantity: number
          return_id: string
        }
        Insert: {
          created_at?: string
          defective_item_id: string
          id?: string
          quantity: number
          return_id: string
        }
        Update: {
          created_at?: string
          defective_item_id?: string
          id?: string
          quantity?: number
          return_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sample_return_items_defective_item_id_fkey"
            columns: ["defective_item_id"]
            isOneToOne: false
            referencedRelation: "defective_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sample_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "sample_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      sample_returns: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          registered_by: string | null
          registered_by_email: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          registered_by?: string | null
          registered_by_email?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          registered_by?: string | null
          registered_by_email?: string | null
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
          dashboard_usd_rate: number
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
          dashboard_usd_rate?: number
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
          dashboard_usd_rate?: number
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
      shipment_counters: {
        Row: {
          last_seq: number
          shipment_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          last_seq?: number
          shipment_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          last_seq?: number
          shipment_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shortage_requests: {
        Row: {
          created_at: string
          id: string
          invoice_id: string | null
          notes: string | null
          po_id: string | null
          product_id: string
          quantity: number
          requested_by: string
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          po_id?: string | null
          product_id: string
          quantity: number
          requested_by: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          po_id?: string | null
          product_id?: string
          quantity?: number
          requested_by?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shortage_requests_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shortage_requests_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shortage_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
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
      support_tickets: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          assigned_to_email: string | null
          category: string
          conversation_id: string | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          description: string | null
          id: string
          invoice_id: string | null
          meta: Json
          priority: string
          resolved_at: string | null
          source: string
          status: string
          subject: string
          ticket_number: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          assigned_to_email?: string | null
          category: string
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          meta?: Json
          priority?: string
          resolved_at?: string | null
          source?: string
          status?: string
          subject: string
          ticket_number: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          assigned_to_email?: string | null
          category?: string
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          meta?: Json
          priority?: string
          resolved_at?: string | null
          source?: string
          status?: string
          subject?: string
          ticket_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
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
      task_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          task_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          task_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_by: string
          assignee_id: string
          completed_at: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          delivery_receipt_ids: string[]
          description: string | null
          due_date: string | null
          id: string
          invoice_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_by: string
          assignee_id: string
          completed_at?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          delivery_receipt_ids?: string[]
          description?: string | null
          due_date?: string | null
          id?: string
          invoice_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_by?: string
          assignee_id?: string
          completed_at?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          delivery_receipt_ids?: string[]
          description?: string | null
          due_date?: string | null
          id?: string
          invoice_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
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
          chat_push_enabled: boolean
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
          chat_push_enabled?: boolean
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
          chat_push_enabled?: boolean
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
      user_ui_preferences: {
        Row: {
          cards_hidden: Json
          cards_order: Json
          chat_density: string
          chat_wallpaper: Json
          created_at: string
          mobile_tabs: Json
          nav_hidden: Json
          nav_order: Json
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          cards_hidden?: Json
          cards_order?: Json
          chat_density?: string
          chat_wallpaper?: Json
          created_at?: string
          mobile_tabs?: Json
          nav_hidden?: Json
          nav_order?: Json
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          cards_hidden?: Json
          cards_order?: Json
          chat_density?: string
          chat_wallpaper?: Json
          created_at?: string
          mobile_tabs?: Json
          nav_hidden?: Json
          nav_order?: Json
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      warranty_outbox_events: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          event: string
          id: string
          last_error: string | null
          last_status: number | null
          next_retry_at: string
          payload: Json
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event: string
          id?: string
          last_error?: string | null
          last_status?: number | null
          next_retry_at?: string
          payload: Json
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event?: string
          id?: string
          last_error?: string | null
          last_status?: number | null
          next_retry_at?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_conversations: {
        Row: {
          assigned_to: string | null
          assigned_to_email: string | null
          bot_enabled: boolean
          created_at: string
          customer_id: string | null
          customer_name: string | null
          customer_phone: string
          id: string
          last_message_at: string
          last_message_preview: string | null
          meta: Json
          status: string
          unread_count: number
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          assigned_to_email?: string | null
          bot_enabled?: boolean
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone: string
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          meta?: Json
          status?: string
          unread_count?: number
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          assigned_to_email?: string | null
          bot_enabled?: boolean
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          meta?: Json
          status?: string
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          body: string | null
          conversation_id: string
          created_at: string
          direction: string
          error_message: string | null
          id: string
          is_bot: boolean
          media_filename: string | null
          media_mime: string | null
          media_url: string | null
          message_type: string
          raw: Json
          sent_by: string | null
          sent_by_email: string | null
          status: string
          wa_message_id: string | null
        }
        Insert: {
          body?: string | null
          conversation_id: string
          created_at?: string
          direction: string
          error_message?: string | null
          id?: string
          is_bot?: boolean
          media_filename?: string | null
          media_mime?: string | null
          media_url?: string | null
          message_type?: string
          raw?: Json
          sent_by?: string | null
          sent_by_email?: string | null
          status?: string
          wa_message_id?: string | null
        }
        Update: {
          body?: string | null
          conversation_id?: string
          created_at?: string
          direction?: string
          error_message?: string | null
          id?: string
          is_bot?: boolean
          media_filename?: string | null
          media_mime?: string | null
          media_url?: string | null
          message_type?: string
          raw?: Json
          sent_by?: string | null
          sent_by_email?: string | null
          status?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          body: string
          category: string
          created_at: string
          id: string
          language: string
          name: string
          status: string
          updated_at: string
          variables: Json
        }
        Insert: {
          body: string
          category?: string
          created_at?: string
          id?: string
          language?: string
          name: string
          status?: string
          updated_at?: string
          variables?: Json
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          id?: string
          language?: string
          name?: string
          status?: string
          updated_at?: string
          variables?: Json
        }
        Relationships: []
      }
      x_activity_log: {
        Row: {
          action_type: string
          actor_job_title: string | null
          actor_name: string
          actor_user_id: string
          created_at: string
          description: string
          id: string
          metadata: Json
          route: string | null
        }
        Insert: {
          action_type: string
          actor_job_title?: string | null
          actor_name: string
          actor_user_id: string
          created_at?: string
          description: string
          id?: string
          metadata?: Json
          route?: string | null
        }
        Update: {
          action_type?: string
          actor_job_title?: string | null
          actor_name?: string
          actor_user_id?: string
          created_at?: string
          description?: string
          id?: string
          metadata?: Json
          route?: string | null
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
          job_title: string | null
          message_count: number
          nickname: string | null
          preferences: Json
          summary: string | null
          tone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          frequent_topics?: Json
          job_title?: string | null
          message_count?: number
          nickname?: string | null
          preferences?: Json
          summary?: string | null
          tone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          frequent_topics?: Json
          job_title?: string | null
          message_count?: number
          nickname?: string | null
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
      distributor_balances: {
        Row: {
          approved_invoice_count: number | null
          balance_owed: number | null
          commission_earned: number | null
          distributor_id: string | null
          distributor_name: string | null
          payouts_total: number | null
          total_sales: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_payment: {
        Args: {
          _amount: number
          _invoice_id: string
          _method?: string
          _notes?: string
          _paid_at?: string
          _reference?: string
        }
        Returns: string
      }
      adjust_stock: {
        Args: { _change: number; _product_id: string; _reason: string }
        Returns: string
      }
      apply_back_deductions: {
        Args: { p_actor_email: string; p_dri_ids: string[]; p_from_po: string }
        Returns: Json
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
      apply_po_receipt_with_back_deduct: {
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
      approve_distributor_invoice: {
        Args: {
          _customer_category?: string
          _discount_pct?: number
          _invoice_id: string
          _notes?: string
          _sales_event_id?: string
        }
        Returns: {
          approval_discount_pct: number
          approval_notes: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          customer_address: string | null
          customer_category: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          delivery_days: number | null
          delivery_status: string
          discount: number
          distributor_commission_amount: number
          distributor_id: string | null
          id: string
          invoice_number: string
          language: string
          notes: string | null
          paid_amount: number | null
          receipt_number: number | null
          rejected_at: string | null
          rejected_by: string | null
          sales_channel: string | null
          sales_event_id: string | null
          shipping_address: string | null
          source: string
          status: string
          subject: string | null
          subtotal: number
          system_notes: string | null
          tax_enabled: boolean
          tax_rate: number
          total: number
          updated_at: string
          updated_by: string | null
          updated_by_email: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_user_account: {
        Args: { _notes?: string; _user_id: string }
        Returns: undefined
      }
      back_deduction_report: {
        Args: never
        Returns: {
          applied_at: string
          applied_by_email: string
          color: string
          current_stock: number
          customer_name: string
          dri_id: string
          invoice_id: string
          invoice_number: string
          po_id: string
          po_number: string
          product_id: string
          product_name: string
          quantity: number
          receipt_delivered_at: string
          receipt_id: string
          serial_number: string
          shipment_code: string
          shipment_date: string
        }[]
      }
      bulk_apply_po_receipts: {
        Args: { p_actor_email: string; p_payload: Json }
        Returns: Json
      }
      can_access_call_center: { Args: never; Returns: boolean }
      can_access_user_data: { Args: { _owner_id: string }; Returns: boolean }
      change_delivery_receipt_status: {
        Args: { _new_status: string; _reason?: string; _receipt_id: string }
        Returns: string
      }
      chat_is_room_admin: {
        Args: { _room_id: string; _user_id: string }
        Returns: boolean
      }
      chat_remove_member: {
        Args: { _room_id: string; _target_user: string }
        Returns: undefined
      }
      chat_set_member_role: {
        Args: { _role: string; _room_id: string; _target_user: string }
        Returns: undefined
      }
      chat_set_room_wallpaper: {
        Args: { _room_id: string; _wallpaper: Json }
        Returns: undefined
      }
      chat_update_room_profile: {
        Args: {
          _avatar_url?: string
          _clear_avatar?: boolean
          _name?: string
          _room_id: string
        }
        Returns: undefined
      }
      consume_needs_order_for_product: {
        Args: { _delta: number; _product_id: string }
        Returns: undefined
      }
      convert_invoice_to_draft: {
        Args: { _invoice_id: string }
        Returns: string
      }
      cover_invoice_item: {
        Args: {
          _actor_email: string
          _actor_id: string
          _invoice_id: string
          _invoice_item_id: string
          _invoice_number: string
          _product_id: string
          _qty: number
          _reason: string
        }
        Returns: undefined
      }
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
              _tax_enabled?: boolean
            }
            Returns: string
          }
      create_distributor_invoice: {
        Args: {
          _customer_address: string
          _customer_category: string
          _customer_name: string
          _customer_phone: string
          _items: Json
          _language: string
          _notes: string
          _sales_event_id: string
          _shipping_address: string
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
              _system_notes?: string
            }
            Returns: string
          }
        | {
            Args: {
              _customer_category?: string
              _customer_id: string
              _discount: number
              _items: Json
              _language: string
              _notes: string
              _paid_amount?: number
              _sales_channel?: string
              _sales_event_id?: string
              _system_notes?: string
            }
            Returns: string
          }
      current_user_email: { Args: never; Returns: string }
      delete_distributor_invoice: {
        Args: { _invoice_id: string; _notes?: string }
        Returns: undefined
      }
      delete_distributor_payout: {
        Args: { _payout_id: string }
        Returns: undefined
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_invoice: { Args: { _invoice_id: string }; Returns: string }
      delete_po_receipt_batch: {
        Args: { p_actor_email: string; p_receipt_id: string }
        Returns: Json
      }
      delete_po_with_inventory_rollback: {
        Args: { p_actor_email: string; p_force?: boolean; p_po_id: string }
        Returns: Json
      }
      delivery_item_effective_qty: {
        Args: { _invoice_item_id: string; _mode?: string }
        Returns: number
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      fulfill_reservations_for_po_item: {
        Args: { _po_item_id: string; _quantity: number }
        Returns: number
      }
      get_active_invoice_reservations: {
        Args: never
        Returns: {
          created_at: string
          customer_name: string
          invoice_id: string
          invoice_item_id: string
          invoice_number: string
          product_id: string
          product_name: string
          reserved_qty: number
        }[]
      }
      get_delivered_qty_by_product: {
        Args: never
        Returns: {
          delivered_qty: number
          product_id: string
        }[]
      }
      get_inventory_shortage_alerts: {
        Args: never
        Returns: {
          collection: string
          color: string
          from_incoming: number
          from_stock: number
          image_url: string
          incoming_pos: Json
          incoming_qty: number
          is_spare_part: boolean
          needed_qty: number
          net_shortage: number
          product_id: string
          product_name: string
          serial_number: string
          severity: string
          sources: Json
          stock_quantity: number
        }[]
      }
      get_my_approval_state: {
        Args: never
        Returns: {
          account_type: string
          approval_notes: string
          approval_status: string
        }[]
      }
      get_my_role: { Args: never; Returns: string }
      get_product_cost_book: {
        Args: { p_fy_end?: string; p_fy_start?: string }
        Returns: Json
      }
      get_profile_approval_admin: {
        Args: { _user_id: string }
        Returns: {
          approval_notes: string
          approval_status: string
          approved_at: string
          approved_by: string
        }[]
      }
      get_public_price_list: {
        Args: never
        Returns: {
          collection: string
          color: string
          id: string
          image_url: string
          low_stock_threshold: number
          name: string
          price: number
          qr_code: string
          serial_number: string
          stock_quantity: number
          updated_at: string
        }[]
      }
      get_reserved_invoices_summary: {
        Args: never
        Returns: {
          created_at: string
          customer_name: string
          invoice_id: string
          invoice_number: string
          reserved_lines: number
          reserved_units: number
        }[]
      }
      get_reserved_qty_by_product: {
        Args: never
        Returns: {
          product_id: string
          reserved_qty: number
        }[]
      }
      get_sold_qty_by_product: {
        Args: never
        Returns: {
          product_id: string
          sold_qty: number
        }[]
      }
      get_stock_shortages: {
        Args: never
        Returns: {
          collection: string
          color: string
          image_url: string
          incoming_qty: number
          invoices: Json
          is_spare_part: boolean
          needed_qty: number
          net_shortage: number
          product_id: string
          product_name: string
          serial_number: string
          stock_quantity: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      inventory_discrepancy_report: {
        Args: never
        Returns: {
          delivered_counted: number
          delivered_excluded_by_invoice_status: number
          delta: number
          expected_stock: number
          product_id: string
          product_name: string
          received: number
          serial_number: string
          sold: number
          stock_quantity_now: number
        }[]
      }
      invoice_uncovered_shortage: {
        Args: { _invoice_id: string }
        Returns: {
          color: string
          image_url: string
          incoming_qty: number
          product_id: string
          product_name: string
          quantity: number
          serial_number: string
          stock_quantity: number
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      is_allowed_company_email: { Args: { _email: string }; Returns: boolean }
      is_chat_room_member: {
        Args: { _room_id: string; _user_id: string }
        Returns: boolean
      }
      is_company_member: { Args: never; Returns: boolean }
      is_distributor: { Args: { _user_id?: string }; Returns: boolean }
      is_inventory_admin: { Args: never; Returns: boolean }
      is_invoice_shortage_eligible: {
        Args: { _delivery_status: string; _status: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin_email: { Args: { _email: string }; Returns: boolean }
      is_task_manager: { Args: never; Returns: boolean }
      list_distributor_products: {
        Args: never
        Returns: {
          available_stock: number
          collection: string
          color: string
          created_at: string
          id: string
          image_url: string
          is_spare_part: boolean
          low_stock_threshold: number
          name: string
          parent_product_id: string
          price: number
          serial_number: string
          updated_at: string
        }[]
      }
      list_pending_back_deductions: {
        Args: { p_po_id: string }
        Returns: {
          color: string
          current_stock: number
          customer_name: string
          dri_id: string
          invoice_id: string
          invoice_number: string
          product_id: string
          product_name: string
          quantity: number
          receipt_delivered_at: string
          receipt_id: string
          serial_number: string
        }[]
      }
      manual_reconcile_stock: {
        Args: { _new_qty: number; _product_id: string; _reason: string }
        Returns: number
      }
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
      orphan_delivery_items_report: {
        Args: never
        Returns: {
          color: string
          created_at: string
          dri_id: string
          match_status: string
          matched_product_id: string
          product_name: string
          quantity: number
          receipt_id: string
          receipt_number: string
          receipt_status: string
          serial_number: string
        }[]
      }
      pair_scan_session: { Args: { _pair_code: string }; Returns: string }
      preview_bulk_apply_po_receipts: {
        Args: { p_payload: Json }
        Returns: Json
      }
      preview_inventory_reset: { Args: never; Returns: Json }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reassign_po_numbers_by_shipment_date: { Args: never; Returns: Json }
      reassign_shipment_codes_for_user: {
        Args: { _user_id: string }
        Returns: undefined
      }
      reassign_shipment_codes_global: { Args: never; Returns: undefined }
      rebuild_inventory_from_source_of_truth: {
        Args: never
        Returns: {
          products_changed: number
          products_zeroed: number
          shortages_created: number
          total_delivered: number
          total_received: number
        }[]
      }
      rebuild_product_stock: { Args: { p_product_id?: string }; Returns: Json }
      recalc_invoice_delivery_status: {
        Args: { _invoice_id: string }
        Returns: undefined
      }
      recalc_invoice_paid_amount: {
        Args: { _invoice_id: string }
        Returns: undefined
      }
      recalculate_po_receipt_state: { Args: { p_po_id: string }; Returns: Json }
      recompute_missing_shortages: { Args: never; Returns: number }
      record_historical_po_receipt: {
        Args: {
          _apply_to_inventory?: boolean
          _items: Json
          _notes: string
          _po_id: string
          _receipt_date: string
        }
        Returns: string
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
      register_defective_item:
        | {
            Args: {
              _color?: string
              _notes?: string
              _product_id: string
              _quantity: number
              _reason: string
              _serial_number?: string
            }
            Returns: string
          }
        | {
            Args: {
              _color?: string
              _item_type?: string
              _notes?: string
              _product_id: string
              _quantity: number
              _reason: string
              _serial_number?: string
            }
            Returns: string
          }
      reject_distributor_invoice: {
        Args: { _invoice_id: string; _notes?: string }
        Returns: {
          approval_discount_pct: number
          approval_notes: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          customer_address: string | null
          customer_category: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          delivery_days: number | null
          delivery_status: string
          discount: number
          distributor_commission_amount: number
          distributor_id: string | null
          id: string
          invoice_number: string
          language: string
          notes: string | null
          paid_amount: number | null
          receipt_number: number | null
          rejected_at: string | null
          rejected_by: string | null
          sales_channel: string | null
          sales_event_id: string | null
          shipping_address: string | null
          source: string
          status: string
          subject: string | null
          subtotal: number
          system_notes: string | null
          tax_enabled: boolean
          tax_rate: number
          total: number
          updated_at: string
          updated_by: string | null
          updated_by_email: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reject_user_account: {
        Args: { _notes?: string; _user_id: string }
        Returns: undefined
      }
      renumber_purchase_orders: { Args: never; Returns: Json }
      reset_all_inventory: { Args: { p_actor_email: string }; Returns: Json }
      return_defective_item: {
        Args: { _defective_id: string; _notes?: string; _quantity: number }
        Returns: undefined
      }
      revert_back_deductions: {
        Args: { p_actor_email: string; p_dri_ids: string[]; p_reason: string }
        Returns: Json
      }
      revert_po_inventory: {
        Args: { p_actor_email: string; p_po_id: string }
        Returns: undefined
      }
      revert_profit_cost_override: {
        Args: { p_history_id: string }
        Returns: undefined
      }
      stock_reconciliation_report: {
        Args: never
        Returns: {
          color: string
          current_stock: number
          diff: number
          logs_sum: number
          product_id: string
          product_name: string
          serial_number: string
        }[]
      }
      undo_bulk_receipt_op: {
        Args: { p_actor_email: string; p_op_id: string; p_reason: string }
        Returns: Json
      }
      undo_last_po_receipt: {
        Args: { p_actor_email: string; p_po_id: string }
        Returns: Json
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
              _tax_enabled?: boolean
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
        | {
            Args: {
              _customer_category?: string
              _customer_id: string
              _discount: number
              _invoice_id: string
              _items: Json
              _language: string
              _notes: string
              _paid_amount?: number
              _sales_channel?: string
              _sales_event_id?: string
              _system_notes?: string
            }
            Returns: string
          }
      update_po_receipt_batch: {
        Args: {
          p_actor_email: string
          p_items: Json
          p_receipt_date: string
          p_receipt_id: string
        }
        Returns: Json
      }
      update_po_shipment: {
        Args: { _new_date: string; _new_type: string; _po_id: string }
        Returns: Json
      }
      void_invoice: { Args: { _invoice_id: string }; Returns: string }
      warranty_enqueue: {
        Args: { _event: string; _payload: Json }
        Returns: undefined
      }
    }
    Enums: {
      app_platform: "android" | "ios" | "windows" | "macos" | "web"
      app_role:
        | "admin"
        | "user"
        | "manager"
        | "cashier"
        | "call_center"
        | "purchasing"
        | "cfo"
        | "task_manager"
        | "po_deleter"
      task_priority: "low" | "normal" | "high" | "urgent"
      task_status: "pending" | "in_progress" | "done" | "cancelled"
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
      app_platform: ["android", "ios", "windows", "macos", "web"],
      app_role: [
        "admin",
        "user",
        "manager",
        "cashier",
        "call_center",
        "purchasing",
        "cfo",
        "task_manager",
        "po_deleter",
      ],
      task_priority: ["low", "normal", "high", "urgent"],
      task_status: ["pending", "in_progress", "done", "cancelled"],
    },
  },
} as const
