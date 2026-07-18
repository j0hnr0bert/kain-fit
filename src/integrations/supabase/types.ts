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
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      brands: {
        Row: {
          country_code: string | null
          created_at: string
          id: string
          name: string
          normalized_name: string
          updated_at: string
          verification_status: Database["public"]["Enums"]["food_verification_status"]
          website: string | null
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          id?: string
          name: string
          normalized_name: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["food_verification_status"]
          website?: string | null
        }
        Update: {
          country_code?: string | null
          created_at?: string
          id?: string
          name?: string
          normalized_name?: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["food_verification_status"]
          website?: string | null
        }
        Relationships: []
      }
      demo_usage: {
        Row: {
          count: number
          created_at: string
          last_reason: string | null
          last_success_at: string | null
          session_id: string
          updated_at: string
        }
        Insert: {
          count?: number
          created_at?: string
          last_reason?: string | null
          last_success_at?: string | null
          session_id: string
          updated_at?: string
        }
        Update: {
          count?: number
          created_at?: string
          last_reason?: string | null
          last_success_at?: string | null
          session_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      feedback_submissions: {
        Row: {
          accuracy_rating: number | null
          acquisition_source: string | null
          allow_contact: boolean
          anonymous_session_id: string | null
          comment: string | null
          confusing: string | null
          created_at: string
          ease_rating: number | null
          id: string
          missed_food: string | null
          user_id: string | null
          would_use_tomorrow: string | null
        }
        Insert: {
          accuracy_rating?: number | null
          acquisition_source?: string | null
          allow_contact?: boolean
          anonymous_session_id?: string | null
          comment?: string | null
          confusing?: string | null
          created_at?: string
          ease_rating?: number | null
          id?: string
          missed_food?: string | null
          user_id?: string | null
          would_use_tomorrow?: string | null
        }
        Update: {
          accuracy_rating?: number | null
          acquisition_source?: string | null
          allow_contact?: boolean
          anonymous_session_id?: string | null
          comment?: string | null
          confusing?: string | null
          created_at?: string
          ease_rating?: number | null
          id?: string
          missed_food?: string | null
          user_id?: string | null
          would_use_tomorrow?: string | null
        }
        Relationships: []
      }
      food_aliases: {
        Row: {
          alias: string
          alias_type: string
          created_at: string
          food_record_id: string
          id: string
          language: string
          normalized_alias: string
          priority: number
          region: string | null
        }
        Insert: {
          alias: string
          alias_type?: string
          created_at?: string
          food_record_id: string
          id?: string
          language?: string
          normalized_alias: string
          priority?: number
          region?: string | null
        }
        Update: {
          alias?: string
          alias_type?: string
          created_at?: string
          food_record_id?: string
          id?: string
          language?: string
          normalized_alias?: string
          priority?: number
          region?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "food_aliases_food_record_id_fkey"
            columns: ["food_record_id"]
            isOneToOne: false
            referencedRelation: "food_records"
            referencedColumns: ["id"]
          },
        ]
      }
      food_entries: {
        Row: {
          calories: number
          carbs_g: number
          client_request_id: string | null
          confidence: number | null
          created_at: string
          data_source: string
          display_name: string
          fat_g: number
          id: string
          is_estimate: boolean
          logged_at: string
          meal_type: string
          normalized_name: string | null
          original_input: string | null
          preparation: string | null
          protein_g: number
          quantity: number
          unit: string
          updated_at: string
          user_id: string
        }
        Insert: {
          calories?: number
          carbs_g?: number
          client_request_id?: string | null
          confidence?: number | null
          created_at?: string
          data_source?: string
          display_name: string
          fat_g?: number
          id?: string
          is_estimate?: boolean
          logged_at?: string
          meal_type?: string
          normalized_name?: string | null
          original_input?: string | null
          preparation?: string | null
          protein_g?: number
          quantity?: number
          unit?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          calories?: number
          carbs_g?: number
          client_request_id?: string | null
          confidence?: number | null
          created_at?: string
          data_source?: string
          display_name?: string
          fat_g?: number
          id?: string
          is_estimate?: boolean
          logged_at?: string
          meal_type?: string
          normalized_name?: string | null
          original_input?: string | null
          preparation?: string | null
          protein_g?: number
          quantity?: number
          unit?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      food_match_cache: {
        Row: {
          confidence_score: number | null
          database_version: number
          hit_count: number
          id: string
          last_used_at: string
          match_type: string | null
          matched_food_id: string | null
          normalized_query: string
          preparation_state: string | null
        }
        Insert: {
          confidence_score?: number | null
          database_version?: number
          hit_count?: number
          id?: string
          last_used_at?: string
          match_type?: string | null
          matched_food_id?: string | null
          normalized_query: string
          preparation_state?: string | null
        }
        Update: {
          confidence_score?: number | null
          database_version?: number
          hit_count?: number
          id?: string
          last_used_at?: string
          match_type?: string | null
          matched_food_id?: string | null
          normalized_query?: string
          preparation_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "food_match_cache_matched_food_id_fkey"
            columns: ["matched_food_id"]
            isOneToOne: false
            referencedRelation: "food_records"
            referencedColumns: ["id"]
          },
        ]
      }
      food_parse_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          hit_count: number
          input_language: string | null
          items: Json
          last_hit_at: string | null
          meal_hint: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at?: string
          hit_count?: number
          input_language?: string | null
          items: Json
          last_hit_at?: string | null
          meal_hint: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          hit_count?: number
          input_language?: string | null
          items?: Json
          last_hit_at?: string | null
          meal_hint?: string
        }
        Relationships: []
      }
      food_records: {
        Row: {
          active: boolean
          barcode: string | null
          brand_id: string | null
          calories_per_100g: number
          canonical_name: string
          carbs_per_100g: number
          category: string
          confidence_score: number
          country_code: string
          created_at: string
          created_by: string | null
          default_serving_grams: number | null
          display_name: string
          edible_portion: number
          fat_per_100g: number
          fiber_per_100g: number | null
          food_type: string
          id: string
          local_name: string | null
          market_region: string | null
          preparation_state: string
          preparation_variant: string | null
          protein_per_100g: number
          restaurant_id: string | null
          sodium_mg_per_100g: number | null
          source_food_id: string | null
          source_id: string | null
          sugar_per_100g: number | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["food_verification_status"]
          verified_at: string | null
          verified_by: string | null
          version: number
        }
        Insert: {
          active?: boolean
          barcode?: string | null
          brand_id?: string | null
          calories_per_100g: number
          canonical_name: string
          carbs_per_100g?: number
          category: string
          confidence_score?: number
          country_code?: string
          created_at?: string
          created_by?: string | null
          default_serving_grams?: number | null
          display_name: string
          edible_portion?: number
          fat_per_100g?: number
          fiber_per_100g?: number | null
          food_type?: string
          id?: string
          local_name?: string | null
          market_region?: string | null
          preparation_state?: string
          preparation_variant?: string | null
          protein_per_100g?: number
          restaurant_id?: string | null
          sodium_mg_per_100g?: number | null
          source_food_id?: string | null
          source_id?: string | null
          sugar_per_100g?: number | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["food_verification_status"]
          verified_at?: string | null
          verified_by?: string | null
          version?: number
        }
        Update: {
          active?: boolean
          barcode?: string | null
          brand_id?: string | null
          calories_per_100g?: number
          canonical_name?: string
          carbs_per_100g?: number
          category?: string
          confidence_score?: number
          country_code?: string
          created_at?: string
          created_by?: string | null
          default_serving_grams?: number | null
          display_name?: string
          edible_portion?: number
          fat_per_100g?: number
          fiber_per_100g?: number | null
          food_type?: string
          id?: string
          local_name?: string | null
          market_region?: string | null
          preparation_state?: string
          preparation_variant?: string | null
          protein_per_100g?: number
          restaurant_id?: string | null
          sodium_mg_per_100g?: number | null
          source_food_id?: string | null
          source_id?: string | null
          sugar_per_100g?: number | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["food_verification_status"]
          verified_at?: string | null
          verified_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "food_records_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_records_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_chains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_records_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "food_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      food_revisions: {
        Row: {
          change_reason: string | null
          created_at: string
          food_record_id: string
          id: string
          previous_values: Json
          proposed_values: Json
          review_status: Database["public"]["Enums"]["food_verification_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          source_id: string | null
          submitted_by: string | null
        }
        Insert: {
          change_reason?: string | null
          created_at?: string
          food_record_id: string
          id?: string
          previous_values: Json
          proposed_values: Json
          review_status?: Database["public"]["Enums"]["food_verification_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string | null
          submitted_by?: string | null
        }
        Update: {
          change_reason?: string | null
          created_at?: string
          food_record_id?: string
          id?: string
          previous_values?: Json
          proposed_values?: Json
          review_status?: Database["public"]["Enums"]["food_verification_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string | null
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "food_revisions_food_record_id_fkey"
            columns: ["food_record_id"]
            isOneToOne: false
            referencedRelation: "food_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_revisions_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "food_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      food_sources: {
        Row: {
          attribution_text: string | null
          created_at: string
          enabled: boolean
          id: string
          import_method: string | null
          last_imported_at: string | null
          license_name: string | null
          license_url: string | null
          source_name: string
          source_type: string
          source_url: string | null
          source_version: string | null
          updated_at: string
        }
        Insert: {
          attribution_text?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          import_method?: string | null
          last_imported_at?: string | null
          license_name?: string | null
          license_url?: string | null
          source_name: string
          source_type?: string
          source_url?: string | null
          source_version?: string | null
          updated_at?: string
        }
        Update: {
          attribution_text?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          import_method?: string | null
          last_imported_at?: string | null
          license_name?: string | null
          license_url?: string | null
          source_name?: string
          source_type?: string
          source_url?: string | null
          source_version?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      food_submissions: {
        Row: {
          barcode: string | null
          brand: string | null
          created_at: string
          duplicate_candidate_id: string | null
          extracted_values: Json | null
          front_image_path: string | null
          id: string
          nutrition_label_image_path: string | null
          product_name: string | null
          review_status: Database["public"]["Enums"]["food_verification_status"]
          serving_size: string | null
          submitting_user_id: string | null
        }
        Insert: {
          barcode?: string | null
          brand?: string | null
          created_at?: string
          duplicate_candidate_id?: string | null
          extracted_values?: Json | null
          front_image_path?: string | null
          id?: string
          nutrition_label_image_path?: string | null
          product_name?: string | null
          review_status?: Database["public"]["Enums"]["food_verification_status"]
          serving_size?: string | null
          submitting_user_id?: string | null
        }
        Update: {
          barcode?: string | null
          brand?: string | null
          created_at?: string
          duplicate_candidate_id?: string | null
          extracted_values?: Json | null
          front_image_path?: string | null
          id?: string
          nutrition_label_image_path?: string | null
          product_name?: string | null
          review_status?: Database["public"]["Enums"]["food_verification_status"]
          serving_size?: string | null
          submitting_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "food_submissions_duplicate_candidate_id_fkey"
            columns: ["duplicate_candidate_id"]
            isOneToOne: false
            referencedRelation: "food_records"
            referencedColumns: ["id"]
          },
        ]
      }
      macro_reports: {
        Row: {
          corrected_values: Json | null
          created_at: string
          explanation: string | null
          food_entry_id: string | null
          id: string
          issue_type: string
          original_values: Json
          resolution_status: string
          user_id: string
        }
        Insert: {
          corrected_values?: Json | null
          created_at?: string
          explanation?: string | null
          food_entry_id?: string | null
          id?: string
          issue_type: string
          original_values?: Json
          resolution_status?: string
          user_id: string
        }
        Update: {
          corrected_values?: Json | null
          created_at?: string
          explanation?: string | null
          food_entry_id?: string | null
          id?: string
          issue_type?: string
          original_values?: Json
          resolution_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "macro_reports_food_entry_id_fkey"
            columns: ["food_entry_id"]
            isOneToOne: false
            referencedRelation: "food_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_audit_log: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          key: string
          new_value: Json | null
          old_value: Json | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          key: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          key?: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Relationships: []
      }
      product_events: {
        Row: {
          acquisition_source: string | null
          anonymous_session_id: string | null
          created_at: string
          event_name: string
          event_properties: Json
          id: string
          user_id: string | null
        }
        Insert: {
          acquisition_source?: string | null
          anonymous_session_id?: string | null
          created_at?: string
          event_name: string
          event_properties?: Json
          id?: string
          user_id?: string | null
        }
        Update: {
          acquisition_source?: string | null
          anonymous_session_id?: string | null
          created_at?: string
          event_name?: string
          event_properties?: Json
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          activity_level: string | null
          age: number | null
          created_at: string
          display_name: string | null
          height_cm: number | null
          id: string
          manual_targets_enabled: boolean
          onboarded: boolean
          preferred_language: string | null
          preferred_units: string | null
          profile_details_updated_at: string | null
          sex: string | null
          target_calories: number | null
          target_carbs_g: number | null
          target_fat_g: number | null
          target_protein_g: number | null
          updated_at: string
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          activity_level?: string | null
          age?: number | null
          created_at?: string
          display_name?: string | null
          height_cm?: number | null
          id?: string
          manual_targets_enabled?: boolean
          onboarded?: boolean
          preferred_language?: string | null
          preferred_units?: string | null
          profile_details_updated_at?: string | null
          sex?: string | null
          target_calories?: number | null
          target_carbs_g?: number | null
          target_fat_g?: number | null
          target_protein_g?: number | null
          updated_at?: string
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          activity_level?: string | null
          age?: number | null
          created_at?: string
          display_name?: string | null
          height_cm?: number | null
          id?: string
          manual_targets_enabled?: boolean
          onboarded?: boolean
          preferred_language?: string | null
          preferred_units?: string | null
          profile_details_updated_at?: string | null
          sex?: string | null
          target_calories?: number | null
          target_carbs_g?: number | null
          target_fat_g?: number | null
          target_protein_g?: number | null
          updated_at?: string
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: []
      }
      recipe_profiles: {
        Row: {
          canonical_food_id: string
          confidence_score: number
          cooked_yield_grams: number | null
          created_at: string
          id: string
          ingredient_json: Json
          oil_absorption_assumption: number | null
          preparation_method: string | null
          recipe_name: string
          region: string | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["food_verification_status"]
        }
        Insert: {
          canonical_food_id: string
          confidence_score?: number
          cooked_yield_grams?: number | null
          created_at?: string
          id?: string
          ingredient_json?: Json
          oil_absorption_assumption?: number | null
          preparation_method?: string | null
          recipe_name: string
          region?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["food_verification_status"]
        }
        Update: {
          canonical_food_id?: string
          confidence_score?: number
          cooked_yield_grams?: number | null
          created_at?: string
          id?: string
          ingredient_json?: Json
          oil_absorption_assumption?: number | null
          preparation_method?: string | null
          recipe_name?: string
          region?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["food_verification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "recipe_profiles_canonical_food_id_fkey"
            columns: ["canonical_food_id"]
            isOneToOne: false
            referencedRelation: "food_records"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_chains: {
        Row: {
          country_code: string | null
          created_at: string
          id: string
          name: string
          normalized_name: string
          official_nutrition_url: string | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["food_verification_status"]
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          id?: string
          name: string
          normalized_name: string
          official_nutrition_url?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["food_verification_status"]
        }
        Update: {
          country_code?: string | null
          created_at?: string
          id?: string
          name?: string
          normalized_name?: string
          official_nutrition_url?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["food_verification_status"]
        }
        Relationships: []
      }
      saved_foods: {
        Row: {
          calories: number
          carbs_g: number
          created_at: string
          default_quantity: number
          default_unit: string
          fat_g: number
          food_name: string
          id: string
          last_used_at: string | null
          normalized_name: string | null
          protein_g: number
          source: string | null
          usage_count: number
          user_id: string
        }
        Insert: {
          calories?: number
          carbs_g?: number
          created_at?: string
          default_quantity?: number
          default_unit?: string
          fat_g?: number
          food_name: string
          id?: string
          last_used_at?: string | null
          normalized_name?: string | null
          protein_g?: number
          source?: string | null
          usage_count?: number
          user_id: string
        }
        Update: {
          calories?: number
          carbs_g?: number
          created_at?: string
          default_quantity?: number
          default_unit?: string
          fat_g?: number
          food_name?: string
          id?: string
          last_used_at?: string | null
          normalized_name?: string | null
          protein_g?: number
          source?: string | null
          usage_count?: number
          user_id?: string
        }
        Relationships: []
      }
      serving_options: {
        Row: {
          created_at: string
          food_record_id: string
          grams: number
          household_measure: string | null
          id: string
          local_measure: string | null
          serving_name: string
          verified: boolean
        }
        Insert: {
          created_at?: string
          food_record_id: string
          grams: number
          household_measure?: string | null
          id?: string
          local_measure?: string | null
          serving_name: string
          verified?: boolean
        }
        Update: {
          created_at?: string
          food_record_id?: string
          grams?: number
          household_measure?: string | null
          id?: string
          local_measure?: string | null
          serving_name?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "serving_options_food_record_id_fkey"
            columns: ["food_record_id"]
            isOneToOne: false
            referencedRelation: "food_records"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      verified_foods: {
        Row: {
          aliases: string[]
          canonical_name: string
          carbs_per_100g: number
          category: string
          created_at: string
          created_by: string | null
          default_serving_grams: number | null
          fat_per_100g: number
          id: string
          is_active: boolean
          kcal_per_100g: number
          name: string
          preparation_state: string
          protein_per_100g: number
          raw_to_cooked_ratio: number | null
          source: string
          source_notes: string | null
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          canonical_name: string
          carbs_per_100g?: number
          category: string
          created_at?: string
          created_by?: string | null
          default_serving_grams?: number | null
          fat_per_100g?: number
          id?: string
          is_active?: boolean
          kcal_per_100g: number
          name: string
          preparation_state?: string
          protein_per_100g?: number
          raw_to_cooked_ratio?: number | null
          source?: string
          source_notes?: string | null
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          canonical_name?: string
          carbs_per_100g?: number
          category?: string
          created_at?: string
          created_by?: string | null
          default_serving_grams?: number | null
          fat_per_100g?: number
          id?: string
          is_active?: boolean
          kcal_per_100g?: number
          name?: string
          preparation_state?: string
          protein_per_100g?: number
          raw_to_cooked_ratio?: number | null
          source?: string
          source_notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_food_parse_cache: {
        Args: { _key: string }
        Returns: {
          input_language: string
          items: Json
        }[]
      }
      get_food_parse_cache_stats: {
        Args: never
        Returns: {
          hits_last_24h: number
          live_entries: number
          total_entries: number
          total_hits: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_allowed_event_name: { Args: { _name: string }; Returns: boolean }
      log_product_event: {
        Args: {
          _acquisition_source: string
          _anonymous_session_id: string
          _event_name: string
          _event_properties: Json
        }
        Returns: undefined
      }
      mark_demo_success: { Args: { _sid: string }; Returns: undefined }
      put_food_parse_cache: {
        Args: {
          _input_language: string
          _items: Json
          _key: string
          _meal_hint: string
        }
        Returns: undefined
      }
      release_demo_slot: {
        Args: { _reason: string; _sid: string }
        Returns: undefined
      }
      reserve_demo_slot: {
        Args: { _limit: number; _sid: string }
        Returns: number
      }
      submit_feedback: {
        Args: {
          _accuracy_rating: number
          _acquisition_source: string
          _allow_contact: boolean
          _anonymous_session_id: string
          _comment: string
          _confusing: string
          _ease_rating: number
          _missed_food: string
          _would_use_tomorrow: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user" | "founder"
      food_verification_status:
        | "unverified"
        | "pending"
        | "verified"
        | "rejected"
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
      app_role: ["admin", "user", "founder"],
      food_verification_status: [
        "unverified",
        "pending",
        "verified",
        "rejected",
      ],
    },
  },
} as const
