type Db = any;
export async function uploadSourceWithMetadata(db: Db, bucket: string, path: string, bytes: Buffer, metadata: Record<string, unknown>) {
  const { error: uploadError } = await db.storage.from(bucket).upload(path, bytes, { contentType: metadata.mime_type, upsert: false });
  if (uploadError) {
    const { error: cleanupError } = await db.storage.from(bucket).remove([path]);
    if (cleanupError) throw new Error('storage_upload_cleanup_failed');
    throw new Error('storage_upload_failed');
  }
  const { data, error } = await db.from('assessment_source_documents').insert(metadata).select('*').single();
  if (error || !data) {
    const { error: cleanupError } = await db.storage.from(bucket).remove([path]);
    if (cleanupError) throw new Error('metadata_failed_storage_cleanup_failed');
    throw new Error('metadata_insert_failed');
  }
  return data;
}

export async function saveDocumentExtraction(db: Db, id: string, extraction: { units: unknown[]; characterCount: number; rangeKind: string }) {
  const { error: cacheError } = await db.from('assessment_source_document_extractions').upsert({ source_document_id: id, extraction_units: extraction.units, extraction_character_count: extraction.characterCount, extraction_range_kind: extraction.rangeKind }, { onConflict: 'source_document_id' });
  if (cacheError) throw new Error('extraction_cache_write_failed');
  const { error } = await db.from('assessment_source_documents').update({ extraction_status: 'ready', extraction_error_code: null, page_count: Math.max(1, extraction.units.length), extracted_at: new Date().toISOString() }).eq('id', id);
  if (error) {
    const { error: cleanupError } = await db.from('assessment_source_document_extractions').delete().eq('source_document_id', id);
    if (cleanupError) throw new Error('extraction_metadata_update_cache_cleanup_failed');
    throw new Error('extraction_metadata_update_failed');
  }
}

export async function markExtractionRetryable(db: Db, id: string) {
  const { error } = await db.from('assessment_source_documents').update({ extraction_status: 'failed', extraction_error_code: 'cache_persistence_failed' }).eq('id', id);
  if (error) throw new Error('retryable_failure_state_write_failed');
}

export async function readDocumentExtraction(db: Db, id: string) {
  const { data, error } = await db.from('assessment_source_document_extractions').select('extraction_units,extraction_character_count,extraction_range_kind').eq('source_document_id', id).maybeSingle();
  if (error) throw new Error('extraction_cache_read_failed');
  if (!data) return undefined;
  return { units: data.extraction_units, unitCount: data.extraction_units.length, characterCount: data.extraction_character_count, rangeKind: data.extraction_range_kind };
}

export async function deleteSourceWithObject(db: Db, bucket: string, row: { id: string; storage_object_path: string; mime_type: string }, assessmentId: string, moduleId: string) {
  const { data, error: downloadError } = await db.storage.from(bucket).download(row.storage_object_path);
  if (downloadError || !data) throw new Error('storage_download_failed');
  const original = Buffer.from(await data.arrayBuffer());
  try {
    const { error: removeError } = await db.storage.from(bucket).remove([row.storage_object_path]);
    if (removeError) throw new Error('storage_remove_failed');
    const { data: deleted, error: dbError } = await db.from('assessment_source_documents').delete().eq('id', row.id).eq('assessment_id', assessmentId).eq('module_id', moduleId).select('id').maybeSingle();
    if (dbError || !deleted) {
      const { error: restoreError } = await db.storage.from(bucket).upload(row.storage_object_path, original, { contentType: row.mime_type, upsert: false });
      if (restoreError) throw new Error('metadata_delete_failed_storage_restore_failed');
      throw new Error('metadata_delete_failed');
    }
  } finally { original.fill(0); }
}
