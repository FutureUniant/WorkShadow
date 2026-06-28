//! WorkShadow `.ws` 数据包：SQLite、LanceDB、用户日志与临时目录等打包迁移。

use crate::{
    load_app_state, load_app_state_from_path, save_app_state, AppSettings, AppState,
    DocumentGenerationPref, IndexStatus, LogNode, MemoryEntry, ModelConfig, ShortcutMap,
    WorkShadowError,
};
use std::collections::{HashMap, HashSet};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tar::{Archive, Builder};
use tauri::Manager;

const MAGIC: &[u8; 4] = b"WSDT";
const FORMAT_VERSION_EXPORT: u32 = 2;

const ENTRY_MANIFEST: &str = "manifest.json";
const ENTRY_SQLITE: &str = "sqlite/workshadow.db";
const DATA_LOGS: &str = "data/logs.json";
const DATA_MEMORY: &str = "data/memory.json";
const DATA_GENERAL: &str = "data/general-settings.json";
const DATA_MODELS: &str = "data/models.json";
const DATA_SHORTCUTS: &str = "data/shortcuts.json";
const DATA_WORKSPACE_PERSONAL: &str = "data/workspace-personal.json";
const LANCE_PREFIX: &str = "lance/";
const LOGS_PREFIX: &str = "user/logs/";
const TEMP_PREFIX: &str = "user/temp/";

/// 与前端一致的导出/导入勾选（manifest 内会记录实际包含项）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataBundleExportOptions {
    pub logs: bool,
    pub memory: bool,
    pub general_settings: bool,
    pub model_config: bool,
    pub shortcuts: bool,
    #[serde(default)]
    pub workspace_personal: bool,
    /// 旧版 .ws 可能单独勾选；导入时与 `logs` 一并处理向量索引，新版导出不再写入。
    #[serde(default, rename = "logChunks", skip_serializing)]
    pub log_chunks: bool,
}

impl DataBundleExportOptions {
    pub fn any_selected(&self) -> bool {
        self.logs
            || self.memory
            || self.general_settings
            || self.model_config
            || self.shortcuts
            || self.workspace_personal
    }

    /// 是否合并/导出语义检索向量（随日志一并处理）。
    fn includes_lance_index(&self) -> bool {
        self.logs || self.log_chunks
    }

    fn legacy_full() -> Self {
        Self {
            logs: true,
            memory: true,
            general_settings: true,
            model_config: true,
            shortcuts: true,
            workspace_personal: true,
            log_chunks: false,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundleManifest {
    format_version: u32,
    app_version: String,
    exported_at: String,
    log_directory: String,
    temp_directory: String,
    #[serde(default)]
    sections: Option<DataBundleExportOptions>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogsPayload {
    nodes: Vec<LogNode>,
    expanded_node_ids: Vec<String>,
    index_status: Vec<IndexStatus>,
    document_generation_prefs: Vec<DocumentGenerationPref>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryPayload {
    memory_entries: Vec<MemoryEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeneralSettingsPayload {
    language: String,
    theme: String,
    log_directory: String,
    temp_directory: String,
    media_strategy: String,
    #[serde(default = "default_search_result_order")]
    search_result_order: String,
    semantic_min_similarity: f32,
    /// 旧版 .ws 曾写入 general-settings.json，导入时兼容
    #[serde(default, skip_serializing_if = "Option::is_none")]
    text_completion_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    completion_personal_snippets: Option<Vec<String>>,
}

fn default_search_result_order() -> String {
    "combined".into()
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelsPayload {
    llm: ModelConfig,
    vlm: ModelConfig,
    embedding: ModelConfig,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutsPayload {
    shortcuts: ShortcutMap,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePersonalPayload {
    #[serde(default = "default_text_completion_enabled")]
    text_completion_enabled: bool,
    #[serde(default)]
    completion_personal_snippets: Vec<String>,
    #[serde(default)]
    completion_usage_stats: Vec<crate::CompletionUsageStat>,
}

fn default_text_completion_enabled() -> bool {
    true
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataBundleExportResult {
    pub path: String,
    pub file_count: u32,
    pub byte_size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataBundleImportResult {
    pub file_count: u32,
    pub nodes_total: u32,
    pub nodes_imported: u32,
    pub lance_chunks_merged: u32,
}

fn lance_dir(app: &tauri::AppHandle) -> Result<PathBuf, WorkShadowError> {
    let dir = app.path().app_data_dir().map_err(|_| WorkShadowError::MissingDataDir)?;
    Ok(dir.join("workshadow-lancedb"))
}

fn resolve_temp_directory(settings: &AppSettings) -> PathBuf {
    if settings.temp_directory.trim().is_empty() {
        PathBuf::new()
    } else {
        PathBuf::from(settings.temp_directory.trim())
    }
}

fn is_newer_timestamp(imported: &str, existing: &str) -> bool {
    imported > existing
}

fn merge_nodes(local: Vec<LogNode>, mut imported: Vec<LogNode>) -> (Vec<LogNode>, u32) {
    let mut map: HashMap<String, LogNode> = local.into_iter().map(|n| (n.id.clone(), n)).collect();
    let mut added = 0u32;
    for node in imported.drain(..) {
        match map.get(&node.id) {
            None => {
                added += 1;
                map.insert(node.id.clone(), node);
            }
            Some(existing) if is_newer_timestamp(&node.updated_at, &existing.updated_at) => {
                map.insert(node.id.clone(), node);
            }
            Some(_) => {}
        }
    }
    (map.into_values().collect(), added)
}

fn merge_id_records<T, F, G>(
    local: Vec<T>,
    imported: Vec<T>,
    id_of: F,
    updated_at: G,
) -> Vec<T>
where
    F: Fn(&T) -> &str,
    G: Fn(&T) -> &str,
{
    let mut map: HashMap<String, T> = local
        .into_iter()
        .map(|item| (id_of(&item).to_string(), item))
        .collect();
    for item in imported {
        let id = id_of(&item).to_string();
        let replace = match map.get(&id) {
            None => true,
            Some(existing) if is_newer_timestamp(updated_at(&item), updated_at(existing)) => true,
            Some(_) => false,
        };
        if replace {
            map.insert(id, item);
        }
    }
    map.into_values().collect()
}

fn merge_completion_usage_stats(
    local: Vec<crate::CompletionUsageStat>,
    imported: Vec<crate::CompletionUsageStat>,
) -> Vec<crate::CompletionUsageStat> {
    let mut map: HashMap<String, crate::CompletionUsageStat> = local
        .into_iter()
        .map(|s| (s.phrase.clone(), s))
        .collect();
    for item in imported {
        let phrase = item.phrase.trim().to_string();
        if phrase.is_empty() {
            continue;
        }
        match map.get(&phrase) {
            None => {
                map.insert(phrase, item);
            }
            Some(existing) => {
                let replace = item.last_accepted_at > existing.last_accepted_at
                    || item.accept_count > existing.accept_count;
                if replace {
                    map.insert(phrase, item);
                }
            }
        }
    }
    let mut out: Vec<_> = map.into_values().collect();
    out.sort_by(|a, b| b.last_accepted_at.cmp(&a.last_accepted_at));
    out.truncate(200);
    out
}

fn merge_ask_question_history(local: Vec<String>, imported: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for q in imported.into_iter().chain(local) {
        let t = q.trim().to_string();
        if t.is_empty() || seen.contains(&t) {
            continue;
        }
        seen.insert(t.clone());
        out.push(t);
        if out.len() >= 50 {
            break;
        }
    }
    out
}

fn merge_expanded_ids(local: Vec<String>, imported: Vec<String>) -> Vec<String> {
    let mut set: HashSet<String> = local.into_iter().collect();
    for id in imported {
        set.insert(id);
    }
    set.into_iter().collect()
}

fn general_settings_from(s: &AppSettings) -> GeneralSettingsPayload {
    GeneralSettingsPayload {
        language: s.language.clone(),
        theme: s.theme.clone(),
        log_directory: s.log_directory.clone(),
        temp_directory: s.temp_directory.clone(),
        media_strategy: s.media_strategy.clone(),
        search_result_order: s.search_result_order.clone(),
        semantic_min_similarity: s.semantic_min_similarity,
        text_completion_enabled: None,
        completion_personal_snippets: None,
    }
}

fn apply_general_settings(target: &mut AppSettings, imported: &GeneralSettingsPayload) {
    target.language = imported.language.clone();
    target.theme = imported.theme.clone();
    target.log_directory = imported.log_directory.clone();
    target.temp_directory = imported.temp_directory.clone();
    target.media_strategy = imported.media_strategy.clone();
    target.search_result_order = imported.search_result_order.clone();
    target.semantic_min_similarity = imported.semantic_min_similarity;
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, WorkShadowError> {
    let bytes = fs::read(path)?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn write_json_file(path: &Path, value: &impl Serialize) -> Result<(), WorkShadowError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_vec_pretty(value)?)?;
    Ok(())
}

fn append_file_to_tar<W: Write>(
    tar: &mut Builder<W>,
    archive_path: &str,
    file_path: &Path,
    file_count: &mut u32,
) -> Result<(), WorkShadowError> {
    let mut header = tar::Header::new_gnu();
    header.set_path(archive_path)?;
    header.set_size(fs::metadata(file_path)?.len());
    header.set_mode(0o644);
    header.set_cksum();
    let mut file = File::open(file_path)?;
    tar.append(&header, &mut file)?;
    *file_count += 1;
    Ok(())
}

fn manifest_sections(manifest: &BundleManifest) -> DataBundleExportOptions {
    manifest.sections.clone().unwrap_or_else(DataBundleExportOptions::legacy_full)
}

fn is_v2_bundle(staging: &Path, manifest: &BundleManifest) -> bool {
    manifest.format_version >= 2
        || manifest.sections.is_some()
        || staging.join(DATA_LOGS).is_file()
}

fn normalize_path_key(path: &str) -> String {
    path.trim()
        .replace('/', std::path::MAIN_SEPARATOR_STR)
        .trim_end_matches(std::path::MAIN_SEPARATOR)
        .to_lowercase()
}

fn remap_path_under_base(path: &str, old_base: &str, new_base: &Path) -> Option<String> {
    let old_key = normalize_path_key(old_base);
    if old_key.is_empty() || !normalize_path_key(path).starts_with(&old_key) {
        return None;
    }
    let rel = normalize_path_key(path)[old_key.len()..]
        .trim_start_matches(std::path::MAIN_SEPARATOR)
        .to_string();
    if rel.is_empty() {
        return None;
    }
    Some(crate::path_to_user_string(&new_base.join(rel)))
}

fn remap_import_node_paths(nodes: &mut [LogNode], import_log_base: &str, local_log_base: &str) {
    if import_log_base.trim().is_empty() || local_log_base.trim().is_empty() {
        return;
    }
    let new_base = PathBuf::from(local_log_base.trim());
    for node in nodes {
        if let Some(p) = node.markdown_path.clone() {
            node.markdown_path = remap_path_under_base(&p, import_log_base, &new_base).or(Some(p));
        }
        if let Some(p) = node.json_path.clone() {
            node.json_path = remap_path_under_base(&p, import_log_base, &new_base).or(Some(p));
        }
    }
}

fn copy_dir_merge(src: &Path, dst: &Path) -> Result<u32, WorkShadowError> {
    if !src.is_dir() {
        return Ok(0);
    }
    fs::create_dir_all(dst)?;
    let mut count = 0u32;
    for file in walkdir_entries(src)? {
        let rel = file.strip_prefix(src).map_err(|e| WorkShadowError::Rag(e.to_string()))?;
        let target = dst.join(rel);
        if target.exists() {
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&file, &target)?;
        count += 1;
    }
    Ok(count)
}


fn remove_dir_all(path: &Path) -> Result<(), WorkShadowError> {
    if path.exists() {
        fs::remove_dir_all(path)?;
    }
    Ok(())
}

fn add_dir_to_tar<W: Write>(
    tar: &mut Builder<W>,
    src: &Path,
    prefix: &str,
    file_count: &mut u32,
) -> Result<(), WorkShadowError> {
    if !src.is_dir() {
        return Ok(());
    }
    for entry in walkdir_entries(src)? {
        let rel = entry.strip_prefix(src).map_err(|e| WorkShadowError::Rag(e.to_string()))?;
        if rel.as_os_str().is_empty() {
            continue;
        }
        let archive_path = format!("{}{}", prefix, rel.to_string_lossy().replace('\\', "/"));
        if entry.is_dir() {
            continue;
        }
        let mut header = tar::Header::new_gnu();
        header.set_path(&archive_path)?;
        header.set_size(fs::metadata(&entry)?.len());
        header.set_mode(0o644);
        header.set_cksum();
        let mut file = File::open(&entry)?;
        tar.append(&header, &mut file)?;
        *file_count += 1;
    }
    Ok(())
}

fn walkdir_entries(root: &Path) -> Result<Vec<PathBuf>, WorkShadowError> {
    let mut stack = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.is_file() {
                files.push(path);
            }
        }
    }
    Ok(files)
}

fn write_manifest<W: Write>(tar: &mut Builder<W>, manifest: &BundleManifest) -> Result<(), WorkShadowError> {
    let json = serde_json::to_vec(manifest)?;
    let mut header = tar::Header::new_gnu();
    header.set_path(ENTRY_MANIFEST)?;
    header.set_size(json.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    tar.append(&header, &json[..])?;
    Ok(())
}

#[tauri::command]
pub fn export_data_bundle(
    app: tauri::AppHandle,
    dest_path: String,
    options: DataBundleExportOptions,
) -> Result<DataBundleExportResult, WorkShadowError> {
    let dest = PathBuf::from(dest_path.trim());
    if dest.as_os_str().is_empty() {
        return Err(WorkShadowError::Rag("export path is empty".into()));
    }
    if !options.any_selected() {
        return Err(WorkShadowError::Rag("select at least one data category to export".into()));
    }

    let state = load_app_state(app.clone())?;
    let log_dir = crate::resolve_log_directory(&app, &state.settings);
    let temp_dir = resolve_temp_directory(&state.settings);
    let lance = lance_dir(&app)?;

    let manifest = BundleManifest {
        format_version: FORMAT_VERSION_EXPORT,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        log_directory: state.settings.log_directory.clone(),
        temp_directory: state.settings.temp_directory.clone(),
        sections: Some(options.clone()),
    };

    let staging = std::env::temp_dir().join(format!("workshadow-export-{}", uuid_simple()));
    let _ = remove_dir_all(&staging);
    fs::create_dir_all(&staging.join("data"))?;

    if options.logs {
        let logs = LogsPayload {
            nodes: state.nodes,
            expanded_node_ids: state.expanded_node_ids,
            index_status: state.index_status,
            document_generation_prefs: state.document_generation_prefs,
        };
        write_json_file(&staging.join(DATA_LOGS), &logs)?;
    }
    if options.memory {
        write_json_file(
            &staging.join(DATA_MEMORY),
            &MemoryPayload {
                memory_entries: state.memory_entries,
            },
        )?;
    }
    if options.general_settings {
        write_json_file(
            &staging.join(DATA_GENERAL),
            &general_settings_from(&state.settings),
        )?;
    }
    if options.workspace_personal {
        write_json_file(
            &staging.join(DATA_WORKSPACE_PERSONAL),
            &WorkspacePersonalPayload {
                text_completion_enabled: state.settings.text_completion_enabled,
                completion_personal_snippets: state.completion_personal_snippets.clone(),
                completion_usage_stats: state.completion_usage_stats.clone(),
            },
        )?;
    }
    if options.model_config {
        write_json_file(
            &staging.join(DATA_MODELS),
            &ModelsPayload {
                llm: state.settings.llm.clone(),
                vlm: state.settings.vlm.clone(),
                embedding: state.settings.embedding.clone(),
            },
        )?;
    }
    if options.shortcuts {
        write_json_file(
            &staging.join(DATA_SHORTCUTS),
            &ShortcutsPayload {
                shortcuts: state.settings.shortcuts.clone(),
            },
        )?;
    }
    let mut file_count = 0u32;
    let encoder = GzEncoder::new(Vec::new(), Compression::default());
    let mut tar = Builder::new(encoder);
    write_manifest(&mut tar, &manifest)?;
    file_count += 1;

    let data_files = [
        (DATA_LOGS, options.logs),
        (DATA_MEMORY, options.memory),
        (DATA_GENERAL, options.general_settings),
        (DATA_MODELS, options.model_config),
        (DATA_SHORTCUTS, options.shortcuts),
        (DATA_WORKSPACE_PERSONAL, options.workspace_personal),
    ];
    for (name, on) in data_files {
        if !on {
            continue;
        }
        let path = staging.join(name);
        append_file_to_tar(&mut tar, name, &path, &mut file_count)?;
    }

    if options.logs {
        add_dir_to_tar(&mut tar, &lance, LANCE_PREFIX, &mut file_count)?;
        if log_dir.is_dir() {
            add_dir_to_tar(&mut tar, &log_dir, LOGS_PREFIX, &mut file_count)?;
        }
        if temp_dir.is_dir() {
            add_dir_to_tar(&mut tar, &temp_dir, TEMP_PREFIX, &mut file_count)?;
        }
    }

    tar.finish()?;
    let encoder = tar.into_inner()?;
    let compressed = encoder.finish()?;

    let mut out = Vec::with_capacity(8 + compressed.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&FORMAT_VERSION_EXPORT.to_le_bytes());
    out.extend_from_slice(&compressed);

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&dest, &out)?;
    let _ = remove_dir_all(&staging);

    Ok(DataBundleExportResult {
        path: crate::path_to_user_string(&dest),
        file_count,
        byte_size: out.len() as u64,
    })
}

fn read_ws_payload(path: &Path) -> Result<Vec<u8>, WorkShadowError> {
    let bytes = fs::read(path)?;
    if bytes.len() < 8 || &bytes[..4] != MAGIC {
        return Err(WorkShadowError::Rag(
            "invalid WorkShadow data file (missing WSDT header)".into(),
        ));
    }
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    if version != 1 && version != 2 {
        return Err(WorkShadowError::Rag(format!(
            "unsupported bundle format version: {version}"
        )));
    }
    Ok(bytes[8..].to_vec())
}

/// 将 tar 内路径规范为安全的相对路径（只校验归档内路径，不校验解压目标绝对路径）。
fn sanitize_bundle_entry_path(raw: &Path) -> Result<PathBuf, WorkShadowError> {
    let mut parts: Vec<String> = Vec::new();
    for comp in raw.components() {
        match comp {
            Component::Normal(name) => {
                let s = name.to_string_lossy();
                if s == "." || s.is_empty() {
                    continue;
                }
                if s == ".." {
                    return Err(WorkShadowError::Rag("invalid path in bundle".into()));
                }
                parts.push(s.into_owned());
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(WorkShadowError::Rag("invalid path in bundle".into()));
            }
        }
    }
    if parts.is_empty() {
        return Err(WorkShadowError::Rag("invalid path in bundle".into()));
    }
    Ok(parts.iter().collect())
}

fn extract_tar_entry(base: &Path, entry_path: &Path, data: &[u8]) -> Result<(), WorkShadowError> {
    let rel = sanitize_bundle_entry_path(entry_path)?;
    let joined = base.join(rel);
    if let Some(parent) = joined.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&joined, data)?;
    Ok(())
}

struct MergeStagingResult {
    file_count: u32,
    nodes_total: u32,
    nodes_imported: u32,
}

fn merge_log_files_from_bundle(
    app: &tauri::AppHandle,
    staging: &Path,
    sections: &DataBundleExportOptions,
    settings: &AppSettings,
) -> Result<u32, WorkShadowError> {
    if !sections.logs {
        return Ok(0);
    }
    let mut file_count = 0u32;
    let logs_src = staging.join("user/logs");
    if logs_src.is_dir() {
        let log_dest = crate::resolve_log_directory(app, settings);
        fs::create_dir_all(&log_dest)?;
        file_count += copy_dir_merge(&logs_src, &log_dest)?;
    }
    if !settings.temp_directory.trim().is_empty() {
        let temp_dest = PathBuf::from(settings.temp_directory.trim());
        let temp_src = staging.join("user/temp");
        if temp_src.is_dir() {
            fs::create_dir_all(&temp_dest)?;
            file_count += copy_dir_merge(&temp_src, &temp_dest)?;
        }
    }
    Ok(file_count)
}

fn merge_v2_from_staging(
    app: &tauri::AppHandle,
    staging: &Path,
    manifest: &BundleManifest,
) -> Result<MergeStagingResult, WorkShadowError> {
    let sections = manifest_sections(manifest);
    let mut local = load_app_state(app.clone())?;
    let import_log_base = manifest.log_directory.as_str();
    let local_log_base =
        crate::path_to_user_string(&crate::resolve_log_directory(app, &local.settings));
    let mut nodes_imported = 0u32;

    if sections.logs {
        if staging.join(DATA_LOGS).is_file() {
            let mut imported: LogsPayload = read_json_file(&staging.join(DATA_LOGS))?;
            remap_import_node_paths(&mut imported.nodes, import_log_base, &local_log_base);
            let (nodes, added) = merge_nodes(local.nodes, imported.nodes);
            nodes_imported = added;
            local.nodes = nodes;
            local.expanded_node_ids =
                merge_expanded_ids(local.expanded_node_ids, imported.expanded_node_ids);
            local.index_status = merge_id_records(
                local.index_status,
                imported.index_status,
                |s| s.log_id.as_str(),
                |s| s.indexed_at.as_str(),
            );
            local.document_generation_prefs = merge_id_records(
                local.document_generation_prefs,
                imported.document_generation_prefs,
                |p| p.doc_kind.as_str(),
                |p| p.updated_at.as_str(),
            );
        }
    }

    if sections.memory && staging.join(DATA_MEMORY).is_file() {
        let imported: MemoryPayload = read_json_file(&staging.join(DATA_MEMORY))?;
        local.memory_entries = merge_id_records(
            local.memory_entries,
            imported.memory_entries,
            |e| e.id.as_str(),
            |e| e.updated_at.as_str(),
        );
    }

    if sections.general_settings && staging.join(DATA_GENERAL).is_file() {
        let imported: GeneralSettingsPayload = read_json_file(&staging.join(DATA_GENERAL))?;
        apply_general_settings(&mut local.settings, &imported);
        if let Some(enabled) = imported.text_completion_enabled {
            local.settings.text_completion_enabled = enabled;
        }
        if let Some(snippets) = imported.completion_personal_snippets {
            local.completion_personal_snippets = merge_ask_question_history(
                local.completion_personal_snippets,
                snippets,
            );
        }
    }

    if sections.workspace_personal && staging.join(DATA_WORKSPACE_PERSONAL).is_file() {
        let imported: WorkspacePersonalPayload = read_json_file(&staging.join(DATA_WORKSPACE_PERSONAL))?;
        local.settings.text_completion_enabled = imported.text_completion_enabled;
        local.completion_personal_snippets = merge_ask_question_history(
            local.completion_personal_snippets,
            imported.completion_personal_snippets,
        );
        local.completion_usage_stats =
            merge_completion_usage_stats(local.completion_usage_stats, imported.completion_usage_stats);
    }

    if sections.model_config && staging.join(DATA_MODELS).is_file() {
        let imported: ModelsPayload = read_json_file(&staging.join(DATA_MODELS))?;
        local.settings.llm = imported.llm;
        local.settings.vlm = imported.vlm;
        local.settings.embedding = imported.embedding;
    }

    if sections.shortcuts && staging.join(DATA_SHORTCUTS).is_file() {
        let imported: ShortcutsPayload = read_json_file(&staging.join(DATA_SHORTCUTS))?;
        local.settings.shortcuts = imported.shortcuts;
    }

    let file_count = merge_log_files_from_bundle(app, staging, &sections, &local.settings)?;
    let nodes_total = local.nodes.len() as u32;
    save_app_state(app.clone(), local)?;

    Ok(MergeStagingResult {
        file_count,
        nodes_total,
        nodes_imported,
    })
}

fn merge_legacy_from_staging(
    app: &tauri::AppHandle,
    staging: &Path,
    manifest: &BundleManifest,
) -> Result<MergeStagingResult, WorkShadowError> {
    let db_src = staging.join(ENTRY_SQLITE);
    if !db_src.is_file() {
        return Err(WorkShadowError::Rag("bundle missing sqlite/workshadow.db".into()));
    }

    let mut local = load_app_state(app.clone())?;
    let mut imported = load_app_state_from_path(&db_src)?;
    let local_log_base =
        crate::path_to_user_string(&crate::resolve_log_directory(app, &local.settings));

    let file_count =
        merge_log_files_from_bundle(app, staging, &DataBundleExportOptions::legacy_full(), &local.settings)?;

    remap_import_node_paths(&mut imported.nodes, &manifest.log_directory, &local_log_base);
    let (nodes, nodes_imported) = merge_nodes(local.nodes, imported.nodes);
    local = AppState {
        settings: local.settings,
        nodes,
        expanded_node_ids: merge_expanded_ids(local.expanded_node_ids, imported.expanded_node_ids),
        index_status: merge_id_records(
            local.index_status,
            imported.index_status,
            |s| s.log_id.as_str(),
            |s| s.indexed_at.as_str(),
        ),
        memory_entries: merge_id_records(
            local.memory_entries,
            imported.memory_entries,
            |e| e.id.as_str(),
            |e| e.updated_at.as_str(),
        ),
        document_generation_prefs: merge_id_records(
            local.document_generation_prefs,
            imported.document_generation_prefs,
            |p| p.doc_kind.as_str(),
            |p| p.updated_at.as_str(),
        ),
        completion_personal_snippets: merge_ask_question_history(
            local.completion_personal_snippets,
            imported.completion_personal_snippets,
        ),
        completion_usage_stats: merge_completion_usage_stats(
            local.completion_usage_stats,
            imported.completion_usage_stats,
        ),
    };

    let nodes_total = local.nodes.len() as u32;
    save_app_state(app.clone(), local)?;

    Ok(MergeStagingResult {
        file_count,
        nodes_total,
        nodes_imported,
    })
}

#[tauri::command]
pub async fn import_data_bundle(app: tauri::AppHandle, source_path: String) -> Result<DataBundleImportResult, WorkShadowError> {
    let source = PathBuf::from(source_path.trim());
    if !source.is_file() {
        return Err(WorkShadowError::Rag("import file not found".into()));
    }

    let payload = read_ws_payload(&source)?;
    let decoder = GzDecoder::new(&payload[..]);
    let mut archive = Archive::new(decoder);

    let staging = std::env::temp_dir().join(format!("workshadow-import-{}", uuid_simple()));
    let _ = remove_dir_all(&staging);
    fs::create_dir_all(&staging)?;

    let mut manifest: Option<BundleManifest> = None;
    let mut extracted = 0u32;

    for entry in archive.entries()? {
        let mut entry = entry?;
        if entry.header().entry_type().is_dir() {
            continue;
        }
        let path = entry.path()?.to_path_buf();
        let rel = sanitize_bundle_entry_path(&path)?;
        let path_str = rel.to_string_lossy().replace('\\', "/");
        let mut data = Vec::new();
        entry.read_to_end(&mut data)?;
        if path_str == ENTRY_MANIFEST {
            manifest = Some(serde_json::from_slice(&data)?);
            extracted += 1;
            continue;
        }
        extract_tar_entry(&staging, &rel, &data)?;
        extracted += 1;
    }

    let manifest = manifest.ok_or_else(|| WorkShadowError::Rag("bundle missing manifest.json".into()))?;
    if manifest.format_version != 1 && manifest.format_version != 2 {
        return Err(WorkShadowError::Rag(format!(
            "unsupported bundle format version: {}",
            manifest.format_version
        )));
    }

    let sections = manifest_sections(&manifest);
    let merged = if is_v2_bundle(&staging, &manifest) {
        merge_v2_from_staging(&app, &staging, &manifest)?
    } else {
        merge_legacy_from_staging(&app, &staging, &manifest)?
    };

    let lance_src = staging.join("lance");
    let lance_chunks_merged = if sections.includes_lance_index() && lance_src.is_dir() {
        crate::rag::merge_lance_from_directory(&app, &lance_src).await?
    } else {
        0
    };
    let _ = remove_dir_all(&staging);

    Ok(DataBundleImportResult {
        file_count: merged.file_count.saturating_add(extracted),
        nodes_total: merged.nodes_total,
        nodes_imported: merged.nodes_imported,
        lance_chunks_merged,
    })
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{n}")
}
