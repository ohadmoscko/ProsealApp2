// Auto-generated types for Supabase — update when schema changes

export type UserRole = 'admin' | 'viewer_commenter' | 'contributor' | 'readonly';
export type WeekStatus = 'draft' | 'sent' | 'read' | 'responded';
export type ItemImportance = 'normal' | 'medium' | 'high';
export type QuoteStatus = 'new' | 'open' | 'waiting' | 'follow_up' | 'won' | 'lost' | 'dormant';
export type InteractionType = 'call' | 'whatsapp' | 'email' | 'note' | 'system';
export type CaptureStatus = 'pending' | 'processed' | 'in_report' | 'dismissed';
export type InteractionOutcome = 'reached' | 'no_answer' | 'unavailable';

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
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
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Quote {
  id: string;
  quote_number: string;
  client_id: string;
  status: QuoteStatus;
  temperature: number;
  local_file_path: string | null;
  follow_up_date: string | null;
  follow_up_rule: string | null;
  loss_reason: string | null;
  sales_ammo: string[];
  opened_at: string;
  last_contact_at: string | null;
  days_since_contact: number | null;
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
  created_by: string | null;
  created_at: string;
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

// Supabase client generic — minimal for now
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: InsertRow<Profile, 'id' | 'email' | 'display_name' | 'role'>;
        Update: Partial<Profile>;
      };
      categories: {
        Row: Category;
        Insert: InsertRow<Category, 'key' | 'label' | 'position'>;
        Update: Partial<Category>;
      };
      weeks: {
        Row: Week;
        Insert: InsertRow<Week, 'start_date' | 'end_date' | 'status' | 'ceo_goals'>;
        Update: Partial<Week>;
      };
      items: {
        Row: Item;
        Insert: InsertRow<Item, 'week_id' | 'category_id' | 'text'>;
        Update: Partial<Item>;
      };
      comments: {
        Row: Comment;
        Insert: InsertRow<Comment, 'week_id' | 'user_id' | 'content'>;
        Update: Partial<Comment>;
      };
      clients: {
        Row: Client;
        Insert: InsertRow<Client, 'code'>;
        Update: Partial<Client>;
      };
      quotes: {
        Row: Quote;
        Insert: InsertRow<Quote, 'quote_number' | 'client_id' | 'status' | 'opened_at'>;
        Update: Partial<Quote>;
      };
      interactions: {
        Row: Interaction;
        Insert: InsertRow<Interaction, 'quote_id' | 'type' | 'content'>;
        Update: Partial<Interaction>;
      };
      captures: {
        Row: Capture;
        Insert: InsertRow<Capture, 'raw_text'>;
        Update: Partial<Capture>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
      week_status: WeekStatus;
      item_importance: ItemImportance;
      quote_status: QuoteStatus;
      interaction_type: InteractionType;
      capture_status: CaptureStatus;
    };
  };
}
