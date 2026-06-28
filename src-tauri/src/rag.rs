use crate::{app_log, AppSettings, WorkShadowError};
use arrow_array::{
    Array, FixedSizeListArray, Float32Array, Int32Array, RecordBatch, StringArray,
};
use arrow_schema::{DataType, Field, Schema, SchemaRef};
use futures::TryStreamExt;
use lance_index::scalar::FullTextSearchQuery;
use lancedb::index::scalar::FtsIndexBuilder;
use lancedb::index::{vector::IvfPqIndexBuilder, Index};
use lancedb::query::{ExecutableQuery, QueryBase, Select};
use lancedb::DistanceType;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::Manager;

const TABLE_NAME: &str = "log_chunks";
const META_FILE: &str = "workshadow-lancedb-meta.json";
const INDEX_SCHEMA_VERSION: u32 = 2;
const VECTOR_METRIC: &str = "cosine";
/// OpenAI 兼容接口常见上限为 2048；阿里云 DashScope 等限制为 10，取保守值避免 400。
const EMBEDDING_BATCH_SIZE: usize = 10;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RagChunkInput {
    pub id: String,
    pub log_id: String,
    pub text: String,
    pub timestamp: String,
    pub parent_path: String,
    pub position: i32,
    pub content_hash: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSyncRequest {
    pub settings: AppSettings,
    pub chunks: Vec<RagChunkInput>,
    pub active_log_ids: Vec<String>,
    #[serde(default)]
    pub force_full: bool,
    /// 更换嵌入模型后：仅用库内已有 chunk 文本重算向量，不删表、不改写 text。
    #[serde(default)]
    pub reembed_all_vectors: bool,
    /// 开发模式：将 Embedding 请求 input 与返回向量写入应用日志
    #[serde(default)]
    pub dev_verbose_logging: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSyncResponse {
    pub indexed_at: String,
    pub chunk_count: usize,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchRequest {
    pub settings: AppSettings,
    pub query: String,
    #[serde(default = "default_search_limit")]
    pub limit: usize,
    /// 开发模式：将 Embedding 请求 input 与返回向量写入应用日志
    #[serde(default)]
    pub dev_verbose_logging: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchChunk {
    pub id: String,
    pub log_id: String,
    pub text: String,
    pub timestamp: String,
    pub parent_path: String,
    pub position: i32,
    pub score: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchResult {
    pub chunk: RagSearchChunk,
    pub summary: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LanceMeta {
    schema_version: u32,
    embedding_model: String,
    embedding_dim: i32,
    #[serde(default)]
    vector_metric: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VectorMetric {
    Cosine,
    L2,
}

impl VectorMetric {
    fn from_meta(raw: &str) -> Self {
        if raw.eq_ignore_ascii_case("cosine") {
            Self::Cosine
        } else {
            Self::L2
        }
    }

    fn as_lance(self) -> DistanceType {
        match self {
            Self::Cosine => DistanceType::Cosine,
            Self::L2 => DistanceType::L2,
        }
    }
}

#[derive(Debug, Clone)]
struct LanceRow {
    id: String,
    log_id: String,
    text: String,
    timestamp: String,
    parent_path: String,
    position: i32,
    content_hash: String,
    embedding_model: String,
    embedding_dim: i32,
    vector: Vec<f32>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingDatum>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingDatum {
    #[serde(default)]
    index: usize,
    embedding: Vec<f32>,
}

fn default_search_limit() -> usize {
    12
}

#[tauri::command]
pub async fn rag_sync_index(
    app: tauri::AppHandle,
    request: RagSyncRequest,
) -> Result<RagSyncResponse, WorkShadowError> {
    validate_embedding_config(&request.settings)?;
    let db_dir = lance_dir(&app)?;
    fs::create_dir_all(&db_dir)?;

    let active_log_ids = request.active_log_ids.into_iter().collect::<HashSet<_>>();
    let db = lancedb::connect(db_dir.to_string_lossy().as_ref()).execute().await?;
    if request.force_full {
        drop_table_if_exists(&db).await?;
        let _ = fs::remove_file(meta_path(&app)?);
    }

    let mut incoming = request.chunks;
    incoming.sort_by(|a, b| a.id.cmp(&b.id));
    if incoming.is_empty() {
        if table_exists(&db).await? {
            let table = db.open_table(TABLE_NAME).execute().await?;
            if active_log_ids.is_empty() {
                table.delete("true").await?;
            } else {
                table
                    .delete(&format!("log_id NOT IN ({})", quoted_list(active_log_ids.iter())))
                    .await?;
            }
        }
        return Ok(sync_response(0));
    }

    let meta = read_meta(&app)?;
    let schema_matches = meta
        .as_ref()
        .map(|m| {
            m.schema_version == INDEX_SCHEMA_VERSION
                && m.vector_metric.eq_ignore_ascii_case(VECTOR_METRIC)
        })
        .unwrap_or(false);
    let model_matches = meta
        .as_ref()
        .map(|m| m.embedding_model == request.settings.embedding.model)
        .unwrap_or(false);

    let mut full_reembed_done = false;
    if !schema_matches && table_exists(&db).await? {
        drop_table_if_exists(&db).await?;
    } else if (request.reembed_all_vectors || !model_matches) && table_exists(&db).await? {
        reembed_all_vectors_in_table(&app, &request.settings, &db, request.dev_verbose_logging).await?;
        full_reembed_done = true;
    }

    let has_table = table_exists(&db).await?;
    let existing = if has_table {
        read_all_rows(&db.open_table(TABLE_NAME).execute().await?).await?
    } else {
        HashMap::new()
    };

    let mut rows_to_write: Vec<LanceRow> = Vec::new();
    let mut texts_to_embed: Vec<&RagChunkInput> = Vec::new();
    for chunk in &incoming {
        match existing.get(&chunk.id) {
            Some(row)
                if row.content_hash == chunk.content_hash
                    && row.embedding_model == request.settings.embedding.model =>
            {
                if row.parent_path != chunk.parent_path
                    || row.position != chunk.position
                    || row.timestamp != chunk.timestamp
                {
                    rows_to_write.push(row_from_existing(chunk, row));
                }
            }
            _ => texts_to_embed.push(chunk),
        }
    }

    let embeddings = if full_reembed_done && texts_to_embed.is_empty() {
        Vec::new()
    } else {
        embed_texts(
            &app,
            &request.settings,
            texts_to_embed.iter().map(|c| c.text.as_str()).collect(),
            request.dev_verbose_logging,
            "rag_sync_index",
        )
        .await?
    };
    for (chunk, vector) in texts_to_embed.into_iter().zip(embeddings) {
        rows_to_write.push(row_from_embedding(chunk, &request.settings.embedding.model, vector));
    }

    let first_dim = rows_to_write
        .first()
        .map(|row| row.embedding_dim)
        .or_else(|| existing.values().next().map(|row| row.embedding_dim))
        .ok_or_else(|| WorkShadowError::Rag("embedding returned no vectors".into()))?;
    if meta.as_ref().map(|m| m.embedding_dim).filter(|dim| *dim != first_dim).is_some() {
        drop_table_if_exists(&db).await?;
    }

    let table = if table_exists(&db).await? {
        db.open_table(TABLE_NAME).execute().await?
    } else {
        let table = db
            .create_empty_table(TABLE_NAME, lance_schema(first_dim))
            .execute()
            .await?;
        create_indices(&table).await;
        table
    };

    let incoming_ids = incoming.iter().map(|chunk| chunk.id.as_str()).collect::<HashSet<_>>();
    let delete_ids = existing
        .keys()
        .filter(|id| !incoming_ids.contains(id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !delete_ids.is_empty() {
        table.delete(&format!("id IN ({})", quoted_list(delete_ids.iter()))).await?;
    }
    if !active_log_ids.is_empty() {
        table
            .delete(&format!("log_id NOT IN ({})", quoted_list(active_log_ids.iter())))
            .await?;
    }

    if !rows_to_write.is_empty() {
        let ids = rows_to_write.iter().map(|row| row.id.clone()).collect::<Vec<_>>();
        table.delete(&format!("id IN ({})", quoted_list(ids.iter()))).await?;
        table.add(rows_to_batch(&rows_to_write)?).execute().await?;
        create_indices(&table).await;
    }

    write_meta(
        &app,
        &LanceMeta {
            schema_version: INDEX_SCHEMA_VERSION,
            embedding_model: request.settings.embedding.model,
            embedding_dim: first_dim,
            vector_metric: VECTOR_METRIC.into(),
        },
    )?;

    Ok(sync_response(incoming.len()))
}

#[tauri::command]
pub async fn rag_search(
    app: tauri::AppHandle,
    request: RagSearchRequest,
) -> Result<Vec<RagSearchResult>, WorkShadowError> {
    validate_embedding_config(&request.settings)?;
    let query = request.query.trim();
    if query.is_empty() {
        return Ok(vec![]);
    }
    let db = lancedb::connect(lance_dir(&app)?.to_string_lossy().as_ref())
        .execute()
        .await?;
    if !table_exists(&db).await? {
        return Ok(vec![]);
    }
    let table = db.open_table(TABLE_NAME).execute().await?;
    let query_vector = embed_one(
        &app,
        &request.settings,
        query,
        request.dev_verbose_logging,
        "rag_search_query",
    )
    .await?;
    let limit = request.limit.clamp(1, 50);
    let min_similarity = semantic_min_similarity(&request.settings);
    let vector_metric = read_meta(&app)?
        .map(|m| VectorMetric::from_meta(&m.vector_metric))
        .unwrap_or(VectorMetric::Cosine);

    let mut vector_query = table
        .query()
        .nearest_to(query_vector)?
        .distance_type(vector_metric.as_lance())
        .refine_factor(1)
        .select(search_select())
        .limit(limit.saturating_mul(3).clamp(12, 150));
    if min_similarity > 0.0 {
        let max_distance = max_vector_distance(min_similarity, vector_metric);
        vector_query = vector_query.distance_range(None, Some(max_distance));
    }
    let vector_rows = vector_query
        .execute()
        .await?
        .try_collect::<Vec<_>>()
        .await?;
    let fts_rows = table
        .query()
        .full_text_search(FullTextSearchQuery::new(query.to_string()))
        .select(search_select())
        .limit(limit * 2)
        .execute()
        .await?
        .try_collect::<Vec<_>>()
        .await
        .unwrap_or_default();

    let mut scores: HashMap<String, (LanceRow, f32)> = HashMap::new();
    merge_ranked_vector_rows(
        &mut scores,
        vector_rows,
        0.58,
        min_similarity,
        vector_metric,
    )?;
    merge_ranked_rows(&mut scores, fts_rows, 0.42)?;

    let mut out = scores.into_values().collect::<Vec<_>>();
    out.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out
        .into_iter()
        .take(limit)
        .map(|(row, score)| RagSearchResult {
            summary: strip_preview(&row.text, 180),
            chunk: RagSearchChunk {
                id: row.id,
                log_id: row.log_id,
                text: row.text,
                timestamp: row.timestamp,
                parent_path: row.parent_path,
                position: row.position,
                score,
            },
        })
        .collect())
}

#[tauri::command]
pub async fn rag_delete_logs(app: tauri::AppHandle, log_ids: Vec<String>) -> Result<(), WorkShadowError> {
    if log_ids.is_empty() {
        return Ok(());
    }
    let db = lancedb::connect(lance_dir(&app)?.to_string_lossy().as_ref())
        .execute()
        .await?;
    if table_exists(&db).await? {
        db.open_table(TABLE_NAME)
            .execute()
            .await?
            .delete(&format!("log_id IN ({})", quoted_list(log_ids.iter())))
            .await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn rag_rebuild_index(
    app: tauri::AppHandle,
    mut request: RagSyncRequest,
) -> Result<RagSyncResponse, WorkShadowError> {
    request.force_full = true;
    rag_sync_index(app, request).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagInspectRequest {
    #[serde(default = "default_inspect_limit")]
    pub limit: usize,
    #[serde(default)]
    pub offset: usize,
    #[serde(default)]
    pub log_id_filter: Option<String>,
    #[serde(default = "default_true")]
    pub include_vector_preview: bool,
}

fn default_inspect_limit() -> usize {
    40
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagInspectLogStat {
    pub log_id: String,
    pub chunk_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanceMetaPublic {
    pub schema_version: u32,
    pub embedding_model: String,
    pub embedding_dim: i32,
    pub vector_metric: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagInspectRow {
    pub id: String,
    pub log_id: String,
    pub text: String,
    pub timestamp: String,
    pub parent_path: String,
    pub position: i32,
    pub content_hash: String,
    pub embedding_model: String,
    pub embedding_dim: i32,
    pub vector_preview: String,
    pub vector_l2_norm: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagInspectResponse {
    pub exists: bool,
    pub directory: String,
    pub table_name: String,
    pub meta: Option<LanceMetaPublic>,
    pub total_rows: usize,
    pub filtered_rows: usize,
    pub log_stats: Vec<RagInspectLogStat>,
    pub rows: Vec<RagInspectRow>,
    pub warning: Option<String>,
}

#[tauri::command]
pub async fn rag_inspect(
    app: tauri::AppHandle,
    request: RagInspectRequest,
) -> Result<RagInspectResponse, WorkShadowError> {
    const MAX_SCAN_ROWS: usize = 25_000;
    let directory = lance_dir(&app)?.to_string_lossy().into_owned();
    let table_name = TABLE_NAME.to_string();
    let limit = request.limit.clamp(1, 200);
    let offset = request.offset;
    let log_filter = request
        .log_id_filter
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let meta_public = read_meta(&app)?.map(|m| LanceMetaPublic {
        schema_version: m.schema_version,
        embedding_model: m.embedding_model,
        embedding_dim: m.embedding_dim,
        vector_metric: m.vector_metric,
    });

    let db = lancedb::connect(&directory).execute().await?;
    if !table_exists(&db).await? {
        return Ok(RagInspectResponse {
            exists: false,
            directory,
            table_name,
            meta: meta_public,
            total_rows: 0,
            filtered_rows: 0,
            log_stats: vec![],
            rows: vec![],
            warning: None,
        });
    }

    let table = db.open_table(TABLE_NAME).execute().await?;
    let sql_filter = log_filter
        .as_ref()
        .map(|id| format!("log_id = '{}'", id.replace('\'', "''")));
    let total_rows = table.count_rows(None).await? as usize;
    let filtered_rows = table.count_rows(sql_filter.clone()).await? as usize;

    let log_stats = build_log_stats(&table).await?;

    let warning = if filtered_rows > MAX_SCAN_ROWS {
        Some(format!(
            "当前筛选结果共 {filtered_rows} 条，超过开发工具单次扫描上限 {MAX_SCAN_ROWS}；请按日志 ID 筛选后再查看明细。"
        ))
    } else {
        None
    };

    let rows = if warning.is_some() {
        vec![]
    } else {
        let mut all = load_rows_for_inspect(&table, sql_filter).await?;
        all.sort_by(|a, b| {
            a.log_id
                .cmp(&b.log_id)
                .then(a.position.cmp(&b.position))
                .then(a.id.cmp(&b.id))
        });
        all.into_iter()
            .skip(offset)
            .take(limit)
            .map(|row| lance_row_to_inspect(&row, request.include_vector_preview))
            .collect()
    };

    Ok(RagInspectResponse {
        exists: true,
        directory,
        table_name,
        meta: meta_public,
        total_rows,
        filtered_rows,
        log_stats,
        rows,
        warning,
    })
}

#[tauri::command]
pub fn rag_open_lance_directory(app: tauri::AppHandle) -> Result<(), String> {
    let dir = lance_dir(&app).map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::app_log::open_path_in_shell(&dir)
}

async fn build_log_stats(table: &lancedb::Table) -> Result<Vec<RagInspectLogStat>, WorkShadowError> {
    let batches = table
        .query()
        .select(Select::Columns(vec!["log_id".into()]))
        .execute()
        .await?
        .try_collect::<Vec<_>>()
        .await?;
    let mut counts: HashMap<String, usize> = HashMap::new();
    for batch in batches {
        let log_id = string_array(&batch, "log_id")?;
        for i in 0..batch.num_rows() {
            *counts.entry(log_id.value(i).to_string()).or_default() += 1;
        }
    }
    let mut stats = counts
        .into_iter()
        .map(|(log_id, chunk_count)| RagInspectLogStat { log_id, chunk_count })
        .collect::<Vec<_>>();
    stats.sort_by(|a, b| {
        b.chunk_count
            .cmp(&a.chunk_count)
            .then(a.log_id.cmp(&b.log_id))
    });
    Ok(stats)
}

async fn load_rows_for_inspect(
    table: &lancedb::Table,
    sql_filter: Option<String>,
) -> Result<Vec<LanceRow>, WorkShadowError> {
    let mut query = table.query().select(all_select());
    if let Some(filter) = sql_filter {
        query = query.only_if(filter);
    }
    let batches = query.execute().await?.try_collect::<Vec<_>>().await?;
    let mut rows = Vec::new();
    for batch in batches {
        rows.extend(batch_to_rows(&batch)?);
    }
    Ok(rows)
}

fn vector_l2_norm(vector: &[f32]) -> f32 {
    vector.iter().map(|v| v * v).sum::<f32>().sqrt()
}

fn vector_preview_text(vector: &[f32], head: usize) -> String {
    if vector.is_empty() {
        return "[]".into();
    }
    let shown = vector
        .iter()
        .take(head)
        .map(|v| format!("{v:.4}"))
        .collect::<Vec<_>>()
        .join(", ");
    if vector.len() > head {
        format!("[{shown}, … +{} dims]", vector.len() - head)
    } else {
        format!("[{shown}]")
    }
}

fn lance_row_to_inspect(row: &LanceRow, include_vector_preview: bool) -> RagInspectRow {
    let vector_l2_norm = vector_l2_norm(&row.vector);
    let vector_preview = if include_vector_preview {
        vector_preview_text(&row.vector, 8)
    } else {
        format!("dim={} · ‖v‖={vector_l2_norm:.4}", row.embedding_dim)
    };
    RagInspectRow {
        id: row.id.clone(),
        log_id: row.log_id.clone(),
        text: row.text.clone(),
        timestamp: row.timestamp.clone(),
        parent_path: row.parent_path.clone(),
        position: row.position,
        content_hash: row.content_hash.clone(),
        embedding_model: row.embedding_model.clone(),
        embedding_dim: row.embedding_dim,
        vector_preview,
        vector_l2_norm,
    }
}

fn validate_embedding_config(settings: &AppSettings) -> Result<(), WorkShadowError> {
    if settings.embedding.base_url.trim().is_empty()
        || settings.embedding.api_key.trim().is_empty()
        || settings.embedding.model.trim().is_empty()
    {
        return Err(WorkShadowError::Rag(
            "Embedding is not configured. Set Base URL, API Key, and model in Settings.".into(),
        ));
    }
    Ok(())
}

async fn embed_one(
    app: &tauri::AppHandle,
    settings: &AppSettings,
    text: &str,
    verbose: bool,
    purpose: &str,
) -> Result<Vec<f32>, WorkShadowError> {
    let mut vectors = embed_texts(app, settings, vec![text], verbose, purpose).await?;
    vectors
        .pop()
        .ok_or_else(|| WorkShadowError::Rag("embedding returned no vector".into()))
}

async fn embed_texts(
    app: &tauri::AppHandle,
    settings: &AppSettings,
    texts: Vec<&str>,
    verbose: bool,
    purpose: &str,
) -> Result<Vec<Vec<f32>>, WorkShadowError> {
    if texts.is_empty() {
        return Ok(vec![]);
    }
    let client = reqwest::Client::new();
    let url = format!("{}/embeddings", settings.embedding.base_url.trim_end_matches('/'));
    let mut all = Vec::with_capacity(texts.len());
    for batch in texts.chunks(EMBEDDING_BATCH_SIZE) {
        let response = client
            .post(&url)
            .bearer_auth(&settings.embedding.api_key)
            .json(&serde_json::json!({
                "model": settings.embedding.model,
                "type": settings.embedding.model,
                "workshadow_tier": settings.embedding.model,
                "input": batch,
                "workshadow_model_kind": "embedding",
            }))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(WorkShadowError::Rag(format!(
                "Embedding request failed: {} {}",
                response.status(),
                response.text().await.unwrap_or_default()
            )));
        }
        let mut payload = response.json::<EmbeddingResponse>().await?;
        payload.data.sort_by_key(|item| item.index);
        let batch_vectors: Vec<Vec<f32>> = payload.data.into_iter().map(|item| item.embedding).collect();
        if verbose {
            let _ = app_log::write_line(
                app,
                "INFO",
                "embedding",
                purpose,
                Some(serde_json::json!({
                    "model": settings.embedding.model,
                    "inputs": batch,
                    "vectors": batch_vectors,
                    "batchSize": batch.len(),
                    "dimensions": batch_vectors.first().map(|v| v.len()).unwrap_or(0),
                })),
            );
        }
        all.extend(batch_vectors);
    }
    if all.len() != texts.len() {
        return Err(WorkShadowError::Rag(format!(
            "embedding returned {} vectors for {} inputs",
            all.len(),
            texts.len()
        )));
    }
    Ok(all)
}

fn lance_dir(app: &tauri::AppHandle) -> Result<PathBuf, WorkShadowError> {
    let dir = app.path().app_data_dir().map_err(|_| WorkShadowError::MissingDataDir)?;
    Ok(dir.join("workshadow-lancedb"))
}

fn meta_path(app: &tauri::AppHandle) -> Result<PathBuf, WorkShadowError> {
    let dir = app.path().app_data_dir().map_err(|_| WorkShadowError::MissingDataDir)?;
    Ok(dir.join(META_FILE))
}

fn read_meta(app: &tauri::AppHandle) -> Result<Option<LanceMeta>, WorkShadowError> {
    let path = meta_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_str(&fs::read_to_string(path)?)?))
}

fn write_meta(app: &tauri::AppHandle, meta: &LanceMeta) -> Result<(), WorkShadowError> {
    let path = meta_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(meta)?)?;
    Ok(())
}

async fn table_exists(db: &lancedb::Connection) -> Result<bool, WorkShadowError> {
    Ok(db.table_names().execute().await?.iter().any(|name| name == TABLE_NAME))
}

async fn drop_table_if_exists(db: &lancedb::Connection) -> Result<(), WorkShadowError> {
    if table_exists(db).await? {
        db.drop_table(TABLE_NAME, &[]).await?;
    }
    Ok(())
}

/// 对表中全部行按既有 `text` 重算嵌入向量；不修改 chunk 正文与其它元数据字段。
async fn reembed_all_vectors_in_table(
    app: &tauri::AppHandle,
    settings: &AppSettings,
    db: &lancedb::Connection,
    verbose: bool,
) -> Result<(), WorkShadowError> {
    let table = db.open_table(TABLE_NAME).execute().await?;
    let existing = read_all_rows(&table).await?;
    if existing.is_empty() {
        return Ok(());
    }

    let mut rows: Vec<LanceRow> = existing.into_values().collect();
    rows.sort_by(|a, b| a.id.cmp(&b.id));
    let texts: Vec<&str> = rows.iter().map(|r| r.text.as_str()).collect();
    let embeddings = embed_texts(app, settings, texts, verbose, "rag_reembed_all").await?;
    let new_dim = embeddings
        .first()
        .map(|v| v.len() as i32)
        .ok_or_else(|| WorkShadowError::Rag("embedding returned no vectors".into()))?;
    let model = settings.embedding.model.clone();

    let meta = read_meta(app)?;
    let dim_changed = meta.as_ref().map(|m| m.embedding_dim != new_dim).unwrap_or(true);

    if dim_changed {
        drop_table_if_exists(db).await?;
        let table = db
            .create_empty_table(TABLE_NAME, lance_schema(new_dim))
            .execute()
            .await?;
        create_indices(&table).await;
        for (row, vector) in rows.iter_mut().zip(embeddings) {
            row.embedding_model = model.clone();
            row.embedding_dim = new_dim;
            row.vector = vector;
        }
        table.add(rows_to_batch(&rows)?).execute().await?;
        create_indices(&table).await;
    } else {
        for (row, vector) in rows.iter_mut().zip(embeddings) {
            row.embedding_model = model.clone();
            row.embedding_dim = new_dim;
            row.vector = vector;
        }
        let ids = rows.iter().map(|r| r.id.clone()).collect::<Vec<_>>();
        table
            .delete(&format!("id IN ({})", quoted_list(ids.iter())))
            .await?;
        table.add(rows_to_batch(&rows)?).execute().await?;
        create_indices(&table).await;
    }

    write_meta(
        app,
        &LanceMeta {
            schema_version: INDEX_SCHEMA_VERSION,
            embedding_model: model,
            embedding_dim: new_dim,
            vector_metric: VECTOR_METRIC.into(),
        },
    )?;
    Ok(())
}

async fn create_indices(table: &lancedb::Table) {
    let _ = table
        .create_index(&["text"], Index::FTS(FtsIndexBuilder::default()))
        .execute()
        .await;
    let _ = table
        .create_index(
            &["vector"],
            Index::IvfPq(
                IvfPqIndexBuilder::default().distance_type(DistanceType::Cosine),
            ),
        )
        .execute()
        .await;
}

fn semantic_min_similarity(settings: &AppSettings) -> f32 {
    settings.semantic_min_similarity.clamp(0.0, 1.0)
}

/// 将用户设置的相似度（0–1）转为 LanceDB 距离上界（Cosine 或 L2）。
fn max_vector_distance(min_similarity: f32, metric: VectorMetric) -> f32 {
    let min_similarity = min_similarity.clamp(0.0, 1.0);
    match metric {
        VectorMetric::Cosine => (1.0 - min_similarity).max(0.0),
        // 单位向量：L2² = 2(1 - cos_sim)
        VectorMetric::L2 => (2.0 * (1.0 - min_similarity)).max(0.0).sqrt(),
    }
}

/// 由 LanceDB 返回的 `_distance` 换算为余弦相似度（便于阈值比较）。
fn similarity_from_distance(distance: f32, metric: VectorMetric) -> f32 {
    match metric {
        VectorMetric::Cosine => 1.0 - distance,
        VectorMetric::L2 => (1.0 - (distance * distance) / 2.0).clamp(-1.0, 1.0),
    }
}

fn passes_similarity_threshold(distance: f32, metric: VectorMetric, min_similarity: f32) -> bool {
    if min_similarity <= 0.0 {
        return true;
    }
    similarity_from_distance(distance, metric) + f32::EPSILON >= min_similarity
}

fn lance_schema(dim: i32) -> SchemaRef {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("log_id", DataType::Utf8, false),
        Field::new("text", DataType::Utf8, false),
        Field::new("timestamp", DataType::Utf8, false),
        Field::new("parent_path", DataType::Utf8, false),
        Field::new("position", DataType::Int32, false),
        Field::new("content_hash", DataType::Utf8, false),
        Field::new("embedding_model", DataType::Utf8, false),
        Field::new("embedding_dim", DataType::Int32, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(Arc::new(Field::new("item", DataType::Float32, true)), dim),
            false,
        ),
    ]))
}

fn rows_to_batch(rows: &[LanceRow]) -> Result<RecordBatch, WorkShadowError> {
    let dim = rows.first().map(|row| row.embedding_dim).unwrap_or(0);
    let schema = lance_schema(dim);
    let vectors = FixedSizeListArray::from_iter_primitive::<arrow_array::types::Float32Type, _, _>(
        rows.iter()
            .map(|row| Some(row.vector.iter().map(|v| Some(*v)).collect::<Vec<_>>())),
        dim,
    );
    Ok(RecordBatch::try_new(
        schema,
        vec![
            Arc::new(StringArray::from(rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(rows.iter().map(|r| r.log_id.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(rows.iter().map(|r| r.text.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(rows.iter().map(|r| r.timestamp.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(rows.iter().map(|r| r.parent_path.as_str()).collect::<Vec<_>>())),
            Arc::new(Int32Array::from(rows.iter().map(|r| r.position).collect::<Vec<_>>())),
            Arc::new(StringArray::from(rows.iter().map(|r| r.content_hash.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(rows.iter().map(|r| r.embedding_model.as_str()).collect::<Vec<_>>())),
            Arc::new(Int32Array::from(rows.iter().map(|r| r.embedding_dim).collect::<Vec<_>>())),
            Arc::new(vectors),
        ],
    )?)
}

async fn read_all_rows(table: &lancedb::Table) -> Result<HashMap<String, LanceRow>, WorkShadowError> {
    let batches = table.query().select(all_select()).execute().await?.try_collect::<Vec<_>>().await?;
    let mut rows = HashMap::new();
    for batch in batches {
        for row in batch_to_rows(&batch)? {
            rows.insert(row.id.clone(), row);
        }
    }
    Ok(rows)
}

fn all_select() -> Select {
    Select::Columns(vec![
        "id".into(),
        "log_id".into(),
        "text".into(),
        "timestamp".into(),
        "parent_path".into(),
        "position".into(),
        "content_hash".into(),
        "embedding_model".into(),
        "embedding_dim".into(),
        "vector".into(),
    ])
}

fn search_select() -> Select {
    all_select()
}

fn batch_to_rows(batch: &RecordBatch) -> Result<Vec<LanceRow>, WorkShadowError> {
    let id = string_array(batch, "id")?;
    let log_id = string_array(batch, "log_id")?;
    let text = string_array(batch, "text")?;
    let timestamp = string_array(batch, "timestamp")?;
    let parent_path = string_array(batch, "parent_path")?;
    let position = int_array(batch, "position")?;
    let content_hash = string_array(batch, "content_hash")?;
    let embedding_model = string_array(batch, "embedding_model")?;
    let embedding_dim = int_array(batch, "embedding_dim")?;
    let vector = fixed_list_array(batch, "vector")?;
    let mut rows = Vec::with_capacity(batch.num_rows());
    for i in 0..batch.num_rows() {
        rows.push(LanceRow {
            id: id.value(i).to_string(),
            log_id: log_id.value(i).to_string(),
            text: text.value(i).to_string(),
            timestamp: timestamp.value(i).to_string(),
            parent_path: parent_path.value(i).to_string(),
            position: position.value(i),
            content_hash: content_hash.value(i).to_string(),
            embedding_model: embedding_model.value(i).to_string(),
            embedding_dim: embedding_dim.value(i),
            vector: list_value(vector, i)?,
        });
    }
    Ok(rows)
}

fn merge_ranked_rows(
    scores: &mut HashMap<String, (LanceRow, f32)>,
    batches: Vec<RecordBatch>,
    weight: f32,
) -> Result<(), WorkShadowError> {
    let mut rank = 0usize;
    for batch in batches {
        for row in batch_to_rows(&batch)? {
            rank += 1;
            let rrf = weight / (60.0 + rank as f32);
            scores
                .entry(row.id.clone())
                .and_modify(|(_, score)| *score += rrf)
                .or_insert((row, rrf));
        }
    }
    Ok(())
}

fn merge_ranked_vector_rows(
    scores: &mut HashMap<String, (LanceRow, f32)>,
    batches: Vec<RecordBatch>,
    weight: f32,
    min_similarity: f32,
    metric: VectorMetric,
) -> Result<(), WorkShadowError> {
    let mut rank = 0usize;
    for batch in batches {
        let distances = distance_array(&batch);
        let rows = batch_to_rows(&batch)?;
        for (i, row) in rows.into_iter().enumerate() {
            if min_similarity > 0.0 {
                let Some(dist) = distances.as_ref().and_then(|d| d.get(i).copied()) else {
                    continue;
                };
                if !passes_similarity_threshold(dist, metric, min_similarity) {
                    continue;
                }
            }
            rank += 1;
            let rrf = weight / (60.0 + rank as f32);
            scores
                .entry(row.id.clone())
                .and_modify(|(_, score)| *score += rrf)
                .or_insert((row, rrf));
        }
    }
    Ok(())
}

fn distance_array(batch: &RecordBatch) -> Option<Vec<f32>> {
    let idx = batch.schema().index_of("_distance").ok()?;
    let array = batch.column(idx).as_any().downcast_ref::<Float32Array>()?;
    Some((0..array.len()).map(|i| array.value(i)).collect())
}

fn string_array<'a>(batch: &'a RecordBatch, name: &str) -> Result<&'a StringArray, WorkShadowError> {
    let idx = batch.schema().index_of(name)?;
    batch
        .column(idx)
        .as_any()
        .downcast_ref::<StringArray>()
        .ok_or_else(|| WorkShadowError::Rag(format!("column {name} is not Utf8")))
}

fn int_array<'a>(batch: &'a RecordBatch, name: &str) -> Result<&'a Int32Array, WorkShadowError> {
    let idx = batch.schema().index_of(name)?;
    batch
        .column(idx)
        .as_any()
        .downcast_ref::<Int32Array>()
        .ok_or_else(|| WorkShadowError::Rag(format!("column {name} is not Int32")))
}

fn fixed_list_array<'a>(batch: &'a RecordBatch, name: &str) -> Result<&'a FixedSizeListArray, WorkShadowError> {
    let idx = batch.schema().index_of(name)?;
    batch
        .column(idx)
        .as_any()
        .downcast_ref::<FixedSizeListArray>()
        .ok_or_else(|| WorkShadowError::Rag(format!("column {name} is not FixedSizeList")))
}

fn list_value(array: &FixedSizeListArray, row: usize) -> Result<Vec<f32>, WorkShadowError> {
    let values = array.value(row);
    let floats = values
        .as_any()
        .downcast_ref::<Float32Array>()
        .ok_or_else(|| WorkShadowError::Rag("vector values are not Float32".into()))?;
    Ok((0..floats.len()).map(|i| floats.value(i)).collect())
}

fn row_from_existing(chunk: &RagChunkInput, row: &LanceRow) -> LanceRow {
    LanceRow {
        id: chunk.id.clone(),
        log_id: chunk.log_id.clone(),
        text: row.text.clone(),
        timestamp: chunk.timestamp.clone(),
        parent_path: chunk.parent_path.clone(),
        position: chunk.position,
        content_hash: row.content_hash.clone(),
        embedding_model: row.embedding_model.clone(),
        embedding_dim: row.embedding_dim,
        vector: row.vector.clone(),
    }
}

fn row_from_embedding(chunk: &RagChunkInput, model: &str, vector: Vec<f32>) -> LanceRow {
    LanceRow {
        id: chunk.id.clone(),
        log_id: chunk.log_id.clone(),
        text: chunk.text.clone(),
        timestamp: chunk.timestamp.clone(),
        parent_path: chunk.parent_path.clone(),
        position: chunk.position,
        content_hash: chunk.content_hash.clone(),
        embedding_model: model.to_string(),
        embedding_dim: vector.len() as i32,
        vector,
    }
}

fn quoted_list<'a>(values: impl Iterator<Item = &'a String>) -> String {
    values
        .map(|value| format!("'{}'", value.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(",")
}

fn sync_response(chunk_count: usize) -> RagSyncResponse {
    RagSyncResponse {
        indexed_at: current_timestamp(),
        chunk_count,
        status: "indexed".into(),
    }
}

fn current_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| format!("{}.{:03}Z", d.as_secs(), d.subsec_millis()))
        .unwrap_or_else(|_| "0.000Z".into())
}

fn copy_lance_tree(src: &Path, dst: &Path) -> Result<(), WorkShadowError> {
    if !src.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_lance_tree(&from, &to)?;
        } else {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// 将备份包中的 LanceDB 目录合并进本机（按 chunk id；较新的 timestamp 优先）。
pub async fn merge_lance_from_directory(
    app: &tauri::AppHandle,
    import_dir: &Path,
) -> Result<u32, WorkShadowError> {
    if !import_dir.is_dir() {
        return Ok(0);
    }
    let local_dir = lance_dir(app)?;
    fs::create_dir_all(&local_dir)?;

    let import_db = lancedb::connect(import_dir.to_string_lossy().as_ref())
        .execute()
        .await?;
    if !table_exists(&import_db).await? {
        return Ok(0);
    }

    let import_table = import_db.open_table(TABLE_NAME).execute().await?;
    let import_rows = read_all_rows(&import_table).await?;
    if import_rows.is_empty() {
        return Ok(0);
    }

    let local_db = lancedb::connect(local_dir.to_string_lossy().as_ref())
        .execute()
        .await?;
    if !table_exists(&local_db).await? {
        copy_lance_tree(import_dir, &local_dir)?;
        return Ok(import_rows.len() as u32);
    }

    let local_table = local_db.open_table(TABLE_NAME).execute().await?;
    let mut merged = read_all_rows(&local_table).await?;
    let local_dim = merged.values().next().map(|r| r.embedding_dim);
    let mut merged_count = 0u32;

    for (id, row) in import_rows {
        if let Some(dim) = local_dim {
            if row.embedding_dim != dim {
                continue;
            }
        }
        let replace = match merged.get(&id) {
            None => true,
            Some(existing) => row.timestamp > existing.timestamp,
        };
        if replace {
            merged.insert(id, row);
            merged_count += 1;
        }
    }

    if merged.is_empty() {
        return Ok(0);
    }

    let rows: Vec<LanceRow> = merged.into_values().collect();
    let dim = rows[0].embedding_dim;
    let model = rows[0].embedding_model.clone();
    drop_table_if_exists(&local_db).await?;
    let table = local_db
        .create_empty_table(TABLE_NAME, lance_schema(dim))
        .execute()
        .await?;
    create_indices(&table).await;
    table.add(rows_to_batch(&rows)?).execute().await?;
    create_indices(&table).await;
    write_meta(
        app,
        &LanceMeta {
            schema_version: INDEX_SCHEMA_VERSION,
            embedding_model: model,
            embedding_dim: dim,
            vector_metric: VECTOR_METRIC.into(),
        },
    )?;
    Ok(merged_count)
}

fn strip_preview(raw: &str, max_len: usize) -> String {
    let text = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= max_len {
        return text;
    }
    text.chars().take(max_len).collect::<String>() + "..."
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_similarity_threshold_maps_distance() {
        assert!((max_vector_distance(0.7, VectorMetric::Cosine) - 0.3).abs() < 1e-6);
        assert!(passes_similarity_threshold(0.25, VectorMetric::Cosine, 0.7));
        assert!(!passes_similarity_threshold(0.35, VectorMetric::Cosine, 0.7));
    }

    #[test]
    fn l2_similarity_threshold_for_unit_vectors() {
        let max_l2 = max_vector_distance(0.7, VectorMetric::L2);
        assert!(passes_similarity_threshold(max_l2, VectorMetric::L2, 0.7));
        assert!(!passes_similarity_threshold(max_l2 + 0.05, VectorMetric::L2, 0.7));
        assert!((similarity_from_distance(0.0, VectorMetric::L2) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn parses_embedding_response() {
        let raw = r#"{"data":[{"index":1,"embedding":[0.3,0.4]},{"index":0,"embedding":[0.1,0.2]}]}"#;
        let mut payload: EmbeddingResponse = serde_json::from_str(raw).unwrap();
        payload.data.sort_by_key(|item| item.index);
        assert_eq!(payload.data[0].embedding, vec![0.1, 0.2]);
    }

    #[test]
    fn preserves_existing_vector_for_metadata_only_change() {
        let chunk = RagChunkInput {
            id: "l:0".into(),
            log_id: "l".into(),
            text: "same".into(),
            timestamp: "t1".into(),
            parent_path: "New".into(),
            position: 0,
            content_hash: "h".into(),
        };
        let row = LanceRow {
            id: "l:0".into(),
            log_id: "l".into(),
            text: "same".into(),
            timestamp: "t0".into(),
            parent_path: "Old".into(),
            position: 0,
            content_hash: "h".into(),
            embedding_model: "m".into(),
            embedding_dim: 2,
            vector: vec![0.1, 0.2],
        };
        let next = row_from_existing(&chunk, &row);
        assert_eq!(next.parent_path, "New");
        assert_eq!(next.vector, vec![0.1, 0.2]);
    }
}
