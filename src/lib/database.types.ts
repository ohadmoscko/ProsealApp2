// Auto-generated types for Supabase — update when schema changes

export type UserRole = 'admin' | 'viewer_commenter' | 'contributor' | 'readonly';
export type WeekStatus = 'draft' | 'sent' | 'read' | 'responded';
export type ItemImportance = 'normal' | 'medium' | 'high';
// [Req #157, #222, #240] - Extended quote statuses
export type QuoteStatus = 'new' | 'open' | 'waiting' | 'follow_up' | 'won' | 'lost' | 'dormant' | 'verbal_approval' | 'in_production' | 'shipped';
export type InteractionType = 'call' | 'whatsapp' | 'email' | 'note' | 'system';
export type CaptureStatus = 'pending' | 'processed' | 'in_report' | 'dismissed';
export type InteractionOutcome = 'reached' | 'no_answer' | 'unavailable';
export type DeferReasonCategory = 'client_abroad' | 'awaiting_technical' | 'price_objection' | 'busy_period' | 'other';
export type ReleaseStatus = 'immediate' | 'pending' | 'released';
export type TelemetryAction = 'expand' | 'collapse' | 'pin' | 'unpin' | 'refresh' | 'drill_down';

// [Req #204] CEO feedback-to-action conversion
export type CeoFeedbackType = 'action' | 'note' | 'dismiss' | 'escalate';
export type CeoActionStatus = 'open' | 'in_progress' | 'done' | 'cancelled';

// [Req #105] - Preferred communication channel
export type PreferredChannel = 'whatsapp' | 'email' | 'phone';

// [Req #101] - Customer tenure/style
export type CustomerStyle = 'new' | 'recurring' | 'veteran' | 'one_time';

// [Req #178] - Interaction direction (push=we initiated, pull=client initiated)
export type InteractionDirection = 'push' | 'pull';

// [Req #65] - Audit log action types
export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE' | 'SOFT_DELETE';

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  vacation_mode: boolean;         // [Req #138] Vacation mode flag
  vacation_until: string | null;  // [Req #138] Auto-disable vacation after date
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  key: string;
  label: string;
  position: number;
  is_active: boolean;
  created_at: string;
}

export interface Week {
  id: string;
  start_date: string;
  end_date: string;
  status: WeekStatus;
  ceo_goals: string;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Item {
  id: string;
  week_id: string;
  category_id: string;
  text: string;
  note: string;
  importance: ItemImportance;
  tags: string[];
  is_complete: boolean;
  position: number;
  carried_from: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: string;
  week_id: string;
  item_id: string | null;
  user_id: string;
  content: string;
  created_at: string;
}

export interface Client {
  id: string;
  code: string;
  erp_number: string | null;
  initials: string | null;
  temperature: number;
  tags: string[];
  phone: string | null;
  notes: string | null;
  is_vip: boolean;
  vip_set_at: string | null;
  vip_set_by: string | null;
  preferred_channel: PreferredChannel;  // [Req #105]
  customer_style: CustomerStyle;         // [Req #101]
  relationship_strength: number;         // [Req #104] 0-100
  is_new_customer: boolean;              // [Req #170]
  deleted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Quote {
  id: string;
  quote_number: string;
  client_id: string;
  unified_id: string | null;
  status: QuoteStatus;
  temperature: number;
  local_file_path: string | null;
  is_lead: boolean; // [Req #139] Pre-sale lead flag
  follow_up_date: string | null;
  follow_up_rule: string | null;
  loss_reason: string | null;
  win_reason: string | null;              // [Req #121] mandatory close documentation on won deals
  strategic_rank: number | null;          // 1=critical, 2=important, 3=routine
  sales_ammo: string[];
  ai_summary: string | null;
  ai_summary_at: string | null;
  owner_id: string | null;               // [Req #146] case owner for multi-user
  temp_override: boolean;                 // [Req #268] manual temp supersedes auto-decay
  opened_at: string;
  last_contact_at: string | null;
  days_since_contact: number | null;
  deleted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Interaction {
  id: string;
  quote_id: string;
  type: InteractionType;
  content: string;
  outcome: InteractionOutcome | null;
  ice_breaker_tag: string | null;
  defer_reason: string | null;
  defer_category: DeferReasonCategory | null;
  direction: InteractionDirection;         // [Req #178] push=we initiated, pull=client initiated
  micro_text: string | null;               // [Req #239] 1-2 keyword memory anchor
  is_milestone: boolean;                   // [Req #112] highlighted timeline events
  release_status: ReleaseStatus;
  release_at: string | null;
  deleted_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AiTrainingTelemetry {
  id: string;
  quote_id: string;
  user_id: string | null;
  action_type: TelemetryAction;
  metadata: Record<string, unknown>;
  created_at: string;
}

// [Req #65] - Full audit log
export interface AuditLog {
  id: string;
  table_name: string;
  record_id: string;
  action: AuditAction;
  changed_by: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_at: string;
}

export interface Capture {
  id: string;
  raw_text: string;
  ai_parsed: Record<string, unknown> | null;
  ai_response: string | null;
  linked_quote_id: string | null;
  linked_report_week_id: string | null;
  status: CaptureStatus;
  created_by: string | null;
  created_at: string;
}

// Helper: Pick required fields for Insert, rest optional (mirrors Supabase codegen)
type InsertRow<T, RequiredKeys extends keyof T> = Pick<T, RequiredKeys> & Partial<Omit<T, RequiredKeys>>;

// Supabase client generic — matches @supabase/supabase-js v2.100+
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: InsertRow<Profile, 'id' | 'email' | 'display_name' | 'role'>;
        Update: Partial<Profile>;
        Relationships: [];
      };
      // [Req #204] CEO feedback-to-action conversion
      ceo_feedback: {
        Row: CeoFeedback;
        Insert: InsertRow<CeoFeedback, 'report_week' | 'category_key' | 'item_index' | 'feedback_type' | 'content' | 'created_by'>;
        Update: Partial<CeoFeedback>;
        Relationships: [];
      };
      categories: {
        Row: Category;
        Insert: InsertRow<Category, 'key' | 'label' | 'position'>;
        Update: Partial<Category>;
        Relationships: [];
      };
      weeks: {
        Row: Week;
        Insert: InsertRow<Week, 'start_date' | 'end_date' | 'status' | 'ceo_goals'>;
        Update: Partial<Week>;
        Relationships: [];
      };
      items: {
        Row: Item;
        Insert: InsertRow<Item, 'week_id' | 'category_id' | 'text'>;
        Update: Partial<Item>;
        Relationships: [];
      };
      comments: {
        Row: Comment;
        Insert: InsertRow<Comment, 'week_id' | 'user_id' | 'content'>;
        Update: Partial<Comment>;
        Relationships: [];
      };
      clients: {
        Row: Client;
        Insert: InsertRow<Client, 'code'>;
        Update: Partial<Client>;
        Relationships: [];
      };
      quotes: {
        Row: Quote;
        Insert: InsertRow<Quote, 'quote_number' | 'client_id' | 'status' | 'opened_at'>;
        Update: Partial<Quote>;
        Relationships: [];
      };
      interactions: {
        Row: Interaction;
        Insert: InsertRow<Interaction, 'quote_id' | 'type' | 'content'>;
        Update: Partial<Interaction>;
        Relationships: [];
      };
      captures: {
        Row: Capture;
        Insert: InsertRow<Capture, 'raw_text'>;
        Update: Partial<Capture>;
        Relationships: [];
      };
      ai_training_telemetry: {
        Row: AiTrainingTelemetry;
        Insert: InsertRow<AiTrainingTelemetry, 'quote_id' | 'action_type'>;
        Update: Partial<AiTrainingTelemetry>;
        Relationships: [];
      };
      // [Req #65] - Audit log (admin-only read)
      audit_log: {
        Row: AuditLog;
        Insert: InsertRow<AuditLog, 'table_name' | 'record_id' | 'action'>;
        Update: Partial<AuditLog>;
        Relationships: [];
      };
    };
    Views: {
      quotes_with_triage: {
        Row: Quote & {
          effective_temperature: number;
          auto_temperature: number;
          staleness: string;
          ui_opacity: number;                    // [Req #275] visual degradation opacity
          latest_defer_reason: DeferReasonCategory | null; // [Req #161] waiting sub-reason
        };
        Relationships: [];
      };
    };
    Functions: {
      find_quote_by_unified_id: {
        Args: { p_erp_number: string; p_initials: string; p_quote_number: string };
        Returns: string | null;
        SetofOptions: { isOneToOne: true }; // Required by GenericFunction
      };
    };
    Enums: {
      user_role: UserRole;
      week_status: WeekStatus;
      item_importance: ItemImportance;
      quote_status: QuoteStatus;
      interaction_type: InteractionType;
      capture_status: CaptureStatus;
      defer_reason_category: DeferReasonCategory;
      release_status: ReleaseStatus;
      ceo_feedback_type: CeoFeedbackType;
      ceo_action_status: CeoActionStatus;
    };
  };
}

// [Req #204] CEO feedback record
export interface CeoFeedback {
  id: string;
  report_week: string;
  category_key: string;
  item_index: number;
  feedback_type: CeoFeedbackType;
  content: string;
  action_status: CeoActionStatus;
  assigned_to: string | null;
  due_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}
