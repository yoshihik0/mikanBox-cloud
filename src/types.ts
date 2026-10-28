// ==========================================
// mikanBox Cloudflare Worker - Type Definitions
// ==========================================

export interface PageData {
  title: string;
  category?: string;
  status: 'public' | 'public_dynamic' | 'public_static' | 'pending' | 'draft' | 'db';
  memo?: string;
  js?: string;
  is_html?: boolean;
  preview_token?: string;
  revision_tag?: string;
  description?: string;
  keywords?: string;
  ogp_image?: string;
  content_md?: string;
  css?: string;
  wrapper_comp?: string;
  exclude_tracking?: boolean;
  sort_order?: number;
  updated_at?: string;
}

export interface ComponentData {
  html: string;
  css?: string;
  is_global?: boolean;
  is_wrapper?: boolean;
  is_ai_doc?: boolean;
  memo?: string;
  js?: string;
}

export interface Settings {
  [key: string]: unknown;
  site_id?: string;
  site_url?: string;
  site_environment?: string;
  category_candidates?: string;
  pages_per_page?: number;
  media_per_page?: number;
  site_name?: string;
  description?: string;
  keywords?: string;
  ogp_image?: string;
  memo?: string;
  ai_prompt?: string;
  registered_categories?: string;
  password_hash?: string;
  system_lang?: string;
  ssg_structure?: string;
  ssg_root_url?: string;
  _site_base?: string;
  demo_mode?: boolean;
}

export interface Env {
  DB: D1Database;
  MEDIA?: R2Bucket;
  JWT_SECRET: string;
  SETUP_TOKEN: string;
  SITE_ENVIRONMENT?: string;
  ASSETS?: Fetcher;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_WORKER_NAME?: string;
  CLOUDFLARE_PUBLIC_WORKER_NAME?: string;
  PUBLIC_SITE_URL?: string;
  CLOUDFLARE_D1_ID?: string;
  CLOUD_RELEASE_MANIFEST_URL?: string;
  CLOUD_UPDATE_REPOSITORY?: string;
}

export interface MediaMeta {
  width?: string;
  height?: string;
  size?: string;
  uploaded?: string;
}

export interface AdminContext {
  env: Env;
  settings: Settings;
  lang: string;
  csrfToken: string;
  message: string;
  view: string;
  editId: string | null;
  editData: PageData | ComponentData | null;
  request: Request;
}
