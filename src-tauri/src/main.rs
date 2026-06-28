#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use thiserror::Error;

mod app_log;
mod data_bundle;
mod device;
mod rag;
mod single_instance;

#[derive(Debug, Error)]
enum WorkShadowError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("lancedb error: {0}")]
    Lance(#[from] lancedb::Error),
    #[error("arrow error: {0}")]
    Arrow(#[from] arrow_schema::ArrowError),
    #[error("rag error: {0}")]
    Rag(String),
    #[error("application data directory is unavailable")]
    MissingDataDir,
}

impl Serialize for WorkShadowError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelConfig {
    #[serde(default = "default_model_provider")]
    provider: String,
    base_url: String,
    api_key: String,
    model: String,
}

fn default_model_provider() -> String {
    "openaiCompatible".into()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ShortcutBinding {
    code: String,
    #[serde(rename = "mod")]
    mod_kind: String,
    shift: bool,
    alt: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ShortcutMap {
    new_log: ShortcutBinding,
    #[serde(default = "default_global_new_log_shortcut")]
    global_new_log: ShortcutBinding,
    lightbox_close: ShortcutBinding,
    lightbox_prev: ShortcutBinding,
    lightbox_next: ShortcutBinding,
    tree_menu_close: ShortcutBinding,
    #[serde(default = "default_text_completion_prev_shortcut")]
    text_completion_prev: ShortcutBinding,
    #[serde(default = "default_text_completion_next_shortcut")]
    text_completion_next: ShortcutBinding,
}

fn default_shortcut(code: &str, mod_kind: &str) -> ShortcutBinding {
    ShortcutBinding {
        code: code.to_string(),
        mod_kind: mod_kind.to_string(),
        shift: false,
        alt: false,
    }
}

fn default_text_completion_prev_shortcut() -> ShortcutBinding {
    ShortcutBinding {
        code: "ArrowUp".into(),
        mod_kind: "ctrl".into(),
        shift: false,
        alt: false,
    }
}

fn default_text_completion_next_shortcut() -> ShortcutBinding {
    ShortcutBinding {
        code: "ArrowDown".into(),
        mod_kind: "ctrl".into(),
        shift: false,
        alt: false,
    }
}

fn default_global_new_log_shortcut() -> ShortcutBinding {
    ShortcutBinding {
        code: "KeyN".into(),
        mod_kind: "ctrlOrMeta".into(),
        shift: true,
        alt: false,
    }
}

fn default_shortcuts() -> ShortcutMap {
    ShortcutMap {
        new_log: default_shortcut("KeyN", "ctrlOrMeta"),
        global_new_log: default_global_new_log_shortcut(),
        lightbox_close: default_shortcut("Escape", "none"),
        lightbox_prev: default_shortcut("ArrowLeft", "none"),
        lightbox_next: default_shortcut("ArrowRight", "none"),
        tree_menu_close: default_shortcut("Escape", "none"),
        text_completion_prev: default_text_completion_prev_shortcut(),
        text_completion_next: default_text_completion_next_shortcut(),
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppSettings {
    language: String,
    theme: String,
    log_directory: String,
    temp_directory: String,
    media_strategy: String,
    llm: ModelConfig,
    #[serde(default)]
    llm_profiles: HashMap<String, ModelConfig>,
    vlm: ModelConfig,
    embedding: ModelConfig,
    #[serde(default)]
    embedding_profiles: HashMap<String, ModelConfig>,
    #[serde(default = "default_semantic_min_similarity")]
    semantic_min_similarity: f32,
    #[serde(default = "default_search_result_order")]
    search_result_order: String,
    #[serde(default = "default_shortcuts")]
    shortcuts: ShortcutMap,
    #[serde(default = "default_text_completion_enabled", alias = "askSuggestionsEnabled")]
    text_completion_enabled: bool,
}

fn default_text_completion_enabled() -> bool {
    true
}

fn default_search_result_order() -> String {
    "combined".into()
}

fn default_semantic_min_similarity() -> f32 {
    0.55
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LogNode {
    id: String,
    parent_id: Option<String>,
    title: String,
    kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sort_order: Option<i64>,
    created_at: String,
    updated_at: String,
    tiptap_json: serde_json::Value,
    markdown: String,
    markdown_path: Option<String>,
    json_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexStatus {
    log_id: String,
    indexed_at: String,
    chunk_count: u32,
    status: String,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MemoryEntry {
    id: String,
    title: String,
    body: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DocumentGenerationPref {
    doc_kind: String,
    focus: String,
    style: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompletionUsageStat {
    phrase: String,
    accept_count: u32,
    last_accepted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppState {
    settings: AppSettings,
    nodes: Vec<LogNode>,
    expanded_node_ids: Vec<String>,
    index_status: Vec<IndexStatus>,
    #[serde(default)]
    memory_entries: Vec<MemoryEntry>,
    #[serde(default)]
    document_generation_prefs: Vec<DocumentGenerationPref>,
    #[serde(default, alias = "askQuestionHistory")]
    completion_personal_snippets: Vec<String>,
    #[serde(default)]
    completion_usage_stats: Vec<CompletionUsageStat>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedPaths {
    markdown_path: String,
    json_path: String,
}

/// 将路径转为用户可读字符串（去掉 Windows 扩展路径前缀 `\\?\`）。
pub(crate) fn path_to_user_string(path: &Path) -> String {
    let s = path.to_string_lossy();
    #[cfg(windows)]
    {
        let s = s.as_ref();
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{rest}");
        }
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
    }
    s.into_owned()
}

/// 安装目录：与可执行文件同目录（便携/绿色部署时日志与临时文件跟程序走）。
fn install_data_root(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .executable_dir()
        .ok()
        .or_else(|| app.path().resource_dir().ok())
        .unwrap_or_else(|| {
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
        })
}

fn default_log_directory(app: &tauri::AppHandle) -> PathBuf {
    install_data_root(app).join("logs")
}

fn default_temp_directory(app: &tauri::AppHandle) -> PathBuf {
    install_data_root(app).join("temp")
}

pub(crate) fn resolve_log_directory(app: &tauri::AppHandle, settings: &AppSettings) -> PathBuf {
    if settings.log_directory.trim().is_empty() {
        default_log_directory(app)
    } else {
        PathBuf::from(settings.log_directory.trim())
    }
}

/// 路径留空时写入安装目录下的 logs / temp，并创建目录。
pub(crate) fn apply_default_path_settings(app: &tauri::AppHandle, settings: &mut AppSettings) -> Result<(), WorkShadowError> {
    if settings.log_directory.trim().is_empty() {
        settings.log_directory = path_to_user_string(&default_log_directory(app));
    } else {
        settings.log_directory = path_to_user_string(Path::new(settings.log_directory.trim()));
    }
    if settings.temp_directory.trim().is_empty() {
        settings.temp_directory = path_to_user_string(&default_temp_directory(app));
    } else {
        settings.temp_directory = path_to_user_string(Path::new(settings.temp_directory.trim()));
    }
    for path in [&settings.log_directory, &settings.temp_directory] {
        if !path.trim().is_empty() {
            fs::create_dir_all(path)?;
        }
    }
    Ok(())
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, WorkShadowError> {
    let dir = app.path().app_data_dir().map_err(|_| WorkShadowError::MissingDataDir)?;
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub(crate) fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, WorkShadowError> {
    Ok(app_data_dir(app)?.join("workshadow.db"))
}

#[tauri::command]
fn app_db_get_directory(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "application data directory is unavailable".to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(path_to_user_string(&dir))
}

#[tauri::command]
fn app_db_open_directory(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "application data directory is unavailable".to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app_log::open_path_in_shell(&dir)
}

pub(crate) fn connection(app: &tauri::AppHandle) -> Result<Connection, WorkShadowError> {
    let conn = Connection::open(db_path(app)?)?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            parent_id TEXT,
            title TEXT NOT NULL,
            kind TEXT NOT NULL,
            sort_order INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            tiptap_json TEXT NOT NULL,
            markdown TEXT NOT NULL,
            markdown_path TEXT,
            json_path TEXT
        );
        CREATE TABLE IF NOT EXISTS index_status (
            log_id TEXT PRIMARY KEY,
            indexed_at TEXT NOT NULL,
            chunk_count INTEGER NOT NULL,
            status TEXT NOT NULL,
            error TEXT
        );
        CREATE TABLE IF NOT EXISTS document_generation_prefs (
            doc_kind TEXT PRIMARY KEY,
            focus TEXT NOT NULL,
            style TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        ",
    )?;
    migrate_nodes_sort_order(&conn)?;
    Ok(conn)
}

/// 为旧库补 `sort_order` 列（侧栏手动排序持久化）。
fn migrate_nodes_sort_order(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_column = conn
        .prepare("PRAGMA table_info(nodes)")?
        .query_map([], |row| {
            let name: String = row.get(1)?;
            Ok(name == "sort_order")
        })?
        .filter_map(Result::ok)
        .any(|v| v);
    if !has_column {
        conn.execute("ALTER TABLE nodes ADD COLUMN sort_order INTEGER", [])?;
    }
    Ok(())
}

pub(crate) fn read_app_state_from_conn(conn: &Connection) -> Result<AppState, WorkShadowError> {
    let settings_json: String = conn
        .query_row("SELECT value FROM settings WHERE key = 'app'", [], |row| row.get(0))
        .map_err(|_| WorkShadowError::Rag("database has no app settings".into()))?;
    let settings: AppSettings = serde_json::from_str(&settings_json)?;
    let mut nodes_stmt = conn.prepare(
        "SELECT id, parent_id, title, kind, sort_order, created_at, updated_at, tiptap_json, markdown, markdown_path, json_path FROM nodes",
    )?;
    let nodes = nodes_stmt
        .query_map([], |row| {
            let json: String = row.get(7)?;
            Ok(LogNode {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                title: row.get(2)?,
                kind: row.get(3)?,
                sort_order: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                tiptap_json: serde_json::from_str(&json).unwrap_or(serde_json::json!({"type":"doc","content":[]})),
                markdown: row.get(8)?,
                markdown_path: row.get(9)?,
                json_path: row.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let expanded_node_ids: Vec<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'expandedNodeIds'", [], |row| row.get::<_, String>(0))
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default();

    let mut index_stmt = conn.prepare(
        "SELECT log_id, indexed_at, chunk_count, status, error FROM index_status",
    )?;
    let index_status = index_stmt
        .query_map([], |row| {
            Ok(IndexStatus {
                log_id: row.get(0)?,
                indexed_at: row.get(1)?,
                chunk_count: row.get::<_, i64>(2)? as u32,
                status: row.get(3)?,
                error: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let memory_entries: Vec<MemoryEntry> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'memoryEntries'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default();

    let mut pref_stmt = conn.prepare(
        "SELECT doc_kind, focus, style, updated_at FROM document_generation_prefs ORDER BY doc_kind",
    )?;
    let document_generation_prefs = pref_stmt
        .query_map([], |row| {
            Ok(DocumentGenerationPref {
                doc_kind: row.get(0)?,
                focus: row.get(1)?,
                style: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let completion_personal_snippets: Vec<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'completionPersonalSnippets'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .or_else(|| {
            conn.query_row(
                "SELECT value FROM settings WHERE key = 'askQuestionHistory'",
                [],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .and_then(|value| serde_json::from_str(&value).ok())
        })
        .unwrap_or_default();

    let completion_usage_stats: Vec<CompletionUsageStat> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'completionUsageStats'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default();

    Ok(AppState {
        settings,
        nodes,
        expanded_node_ids,
        index_status,
        memory_entries,
        document_generation_prefs,
        completion_personal_snippets,
        completion_usage_stats,
    })
}

pub(crate) fn load_app_state_from_path(path: &Path) -> Result<AppState, WorkShadowError> {
    let conn = Connection::open(path)?;
    read_app_state_from_conn(&conn)
}

#[tauri::command]
fn load_app_state(app: tauri::AppHandle) -> Result<AppState, WorkShadowError> {
    let conn = connection(&app)?;
    let settings_json: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'app'", [], |row| row.get(0))
        .ok();

    if settings_json.is_none() {
        let mut state = default_state();
        apply_default_path_settings(&app, &mut state.settings)?;
        return Ok(state);
    }

    let mut state = read_app_state_from_conn(&conn)?;
    apply_default_path_settings(&app, &mut state.settings)?;
    Ok(state)
}

#[tauri::command]
fn save_app_state(app: tauri::AppHandle, state: AppState) -> Result<(), WorkShadowError> {
    let mut conn = connection(&app)?;
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('app', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![serde_json::to_string(&state.settings)?],
    )?;
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('expandedNodeIds', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![serde_json::to_string(&state.expanded_node_ids)?],
    )?;
    tx.execute("DELETE FROM nodes", [])?;
    for node in state.nodes {
        tx.execute(
            "INSERT INTO nodes
            (id, parent_id, title, kind, sort_order, created_at, updated_at, tiptap_json, markdown, markdown_path, json_path)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                node.id,
                node.parent_id,
                node.title,
                node.kind,
                node.sort_order,
                node.created_at,
                node.updated_at,
                serde_json::to_string(&node.tiptap_json)?,
                node.markdown,
                node.markdown_path,
                node.json_path
            ],
        )?;
    }
    tx.execute("DELETE FROM index_status", [])?;
    for status in state.index_status {
        tx.execute(
            "INSERT INTO index_status (log_id, indexed_at, chunk_count, status, error) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![status.log_id, status.indexed_at, status.chunk_count, status.status, status.error],
        )?;
    }
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('memoryEntries', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![serde_json::to_string(&state.memory_entries)?],
    )?;
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('completionPersonalSnippets', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![serde_json::to_string(&state.completion_personal_snippets)?],
    )?;
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('completionUsageStats', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![serde_json::to_string(&state.completion_usage_stats)?],
    )?;
    tx.execute("DELETE FROM document_generation_prefs", [])?;
    for pref in state.document_generation_prefs {
        tx.execute(
            "INSERT INTO document_generation_prefs (doc_kind, focus, style, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![pref.doc_kind, pref.focus, pref.style, pref.updated_at],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), WorkShadowError> {
    let target = PathBuf::from(path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&target, content)?;
    Ok(())
}

#[tauri::command]
fn write_log_files(
    app: tauri::AppHandle,
    settings: AppSettings,
    node: LogNode,
    relative_path: String,
) -> Result<SavedPaths, WorkShadowError> {
    let base_dir = resolve_log_directory(&app, &settings);

    let stem = Path::new(&relative_path);
    let markdown_path = base_dir.join(stem).with_extension("md");
    let json_path = base_dir.join(stem).with_extension("tiptap.json");

    if let Some(parent) = markdown_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if let Some(parent) = json_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(&markdown_path, node.markdown)?;
    fs::write(&json_path, serde_json::to_string_pretty(&node.tiptap_json)?)?;

    Ok(SavedPaths {
        markdown_path: path_to_user_string(&markdown_path),
        json_path: path_to_user_string(&json_path),
    })
}

fn default_state() -> AppState {
    let now = "2026-01-01T00:00:00.000Z".to_string();
    let empty_doc = serde_json::json!({
        "type": "doc",
        "content": [{
            "type": "paragraph",
            "content": [{ "type": "text", "text": "开始记录今天的工作..." }]
        }]
    });
    let settings = AppSettings {
        language: "system".into(),
        theme: "light".into(),
        log_directory: "".into(),
        temp_directory: "".into(),
        media_strategy: "reference".into(),
        llm: ModelConfig { provider: default_model_provider(), base_url: "".into(), api_key: "".into(), model: "".into() },
        llm_profiles: HashMap::new(),
        vlm: ModelConfig { provider: default_model_provider(), base_url: "".into(), api_key: "".into(), model: "".into() },
        embedding: ModelConfig { provider: default_model_provider(), base_url: "".into(), api_key: "".into(), model: "".into() },
        embedding_profiles: HashMap::new(),
        semantic_min_similarity: default_semantic_min_similarity(),
        search_result_order: default_search_result_order(),
        shortcuts: default_shortcuts(),
        text_completion_enabled: default_text_completion_enabled(),
    };
    AppState {
        settings,
        nodes: vec![
            LogNode {
                id: "root-work".into(),
                parent_id: None,
                title: "工作".into(),
                kind: "log".into(),
                sort_order: None,
                created_at: now.clone(),
                updated_at: now.clone(),
                tiptap_json: empty_doc.clone(),
                markdown: "## 工作\n\n记录项目、会议和日常推进。".into(),
                markdown_path: None,
                json_path: None,
            },
            LogNode {
                id: "demo-log".into(),
                parent_id: Some("root-work".into()),
                title: "第一篇日志".into(),
                kind: "log".into(),
                sort_order: None,
                created_at: now.clone(),
                updated_at: now,
                tiptap_json: empty_doc,
                markdown: "## 第一篇日志\n\n开始使用 WorkShadow 记录工作上下文。".into(),
                markdown_path: None,
                json_path: None,
            },
        ],
        expanded_node_ids: vec!["root-work".into()],
        index_status: vec![],
        memory_entries: vec![],
        document_generation_prefs: vec![],
        completion_personal_snippets: vec![],
        completion_usage_stats: vec![],
    }
}

fn main() {
    single_instance::guard();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            app_log::init(app.handle());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.center();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            device::get_device_fingerprint,
            load_app_state,
            save_app_state,
            write_text_file,
            write_log_files,
            app_log::app_timezone_init,
            app_log::app_log_write,
            app_log::app_log_list_files,
            app_log::app_log_read_file,
            app_log::app_log_get_directory,
            app_log::app_log_get_policy,
            app_log::app_log_open_directory,
            app_db_get_directory,
            app_db_open_directory,
            rag::rag_sync_index,
            rag::rag_search,
            rag::rag_delete_logs,
            rag::rag_rebuild_index,
            rag::rag_inspect,
            rag::rag_open_lance_directory,
            data_bundle::export_data_bundle,
            data_bundle::import_data_bundle
        ])
        .run(tauri::generate_context!())
        .expect("error while running WorkShadow");
}
