import express, { Router, Response, Request } from 'express';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { AuthenticatedRequest, requireMentorOrAdmin } from '../middleware/auth.js';
import { extractDocument, identifyDocument, MAX_DOCUMENT_BYTES, DocumentKind, ContentUnit } from '../services/sourceDocumentExtraction.js';
import { uploadSourceWithMetadata, saveDocumentExtraction, readDocumentExtraction, deleteSourceWithObject, markExtractionRetryable } from '../services/sourceDocumentPersistence.js';

const router = Router();
const BUCKET = 'assessment-source-materials';
const selectFields = 'id,module_id,assessment_id,uploaded_by,storage_bucket,storage_object_path,original_filename,mime_type,size_bytes,extraction_status,extraction_error_code,page_count,extracted_at,uploaded_at';

export async function authorize(assessmentId: string, moduleId: string, userId: string, admin: boolean, requireDraft = true, db = supabaseAdmin!) {
  const [{ data: assessment }, { data: module }, { data: link }] = await Promise.all([
    db.from('assessments').select('id,mentor_id,status').eq('id', assessmentId).maybeSingle(),
    db.from('learning_modules').select('id,created_by,status').eq('id', moduleId).maybeSingle(),
    db.from('module_assessment_links').select('assessment_id').eq('assessment_id', assessmentId).eq('module_id', moduleId).maybeSingle(),
  ]);
  if (!assessment || !module || !link || (!admin && (assessment.mentor_id !== userId || module.created_by !== userId))) return { error: 'not_found' as const };
  if (module.created_by !== assessment.mentor_id) return { error: 'not_found' as const };
  if (requireDraft && (assessment.status !== 'draft' || module.status !== 'draft')) return { error: 'locked' as const };
  return { assessment, module };
}
function sendAuthError(res: Response, err: 'not_found' | 'locked') { res.status(err === 'not_found' ? 404 : 409).json({ error: err === 'not_found' ? 'Assessment or module not found.' : 'Source documents are locked outside the draft workflow.' }); }

router.post('/:assessmentId/modules/:moduleId/source-documents', requireMentorOrAdmin, (req: Request, res: Response, next) => {
  if (!String(req.headers['content-type'] || '').startsWith('application/octet-stream')) { res.status(415).json({ error: 'Upload must use application/octet-stream.' }); return; }
  express.raw({ type: 'application/octet-stream', limit: MAX_DOCUMENT_BYTES })(req, res, (error) => {
    if (error) { res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: error.type === 'entity.too.large' ? 'File exceeds the 25 MiB limit.' : 'Upload could not be read.' }); return; }
    next();
  });
}, async (req: AuthenticatedRequest, res: Response) => {
  const documentBuffer = Buffer.isBuffer(req.body) ? req.body as Buffer : undefined;
  if (!supabaseAdmin || !documentBuffer?.length) { documentBuffer?.fill(0); res.status(400).json({ error: 'Upload is required.' }); return; }
  const filename = String(req.headers['x-file-name'] || ''); const mime = String(req.headers['x-file-mime'] || '');
  if (!filename || filename.length > 255 || /[\r\n\\/]/.test(filename)) { documentBuffer.fill(0); res.status(400).json({ error: 'Invalid filename or empty file.' }); return; }
  const access = await authorize(req.params.assessmentId, req.params.moduleId, req.user!.id, req.user!.role === 'admin');
  if ('error' in access) { documentBuffer.fill(0); sendAuthError(res, access.error!); return; }
  // The schema binds uploader to assessment mentor. Admins can review but cannot upload on behalf of a mentor.
  if (req.user!.role === 'admin' && access.assessment.mentor_id !== req.user!.id) { documentBuffer.fill(0); res.status(403).json({ error: 'Only the owning mentor can upload source documents.' }); return; }
  let kind: DocumentKind;
  try { kind = identifyDocument(filename, mime, documentBuffer); } catch { documentBuffer.fill(0); res.status(415).json({ error: 'Unsupported or invalid document.' }); return; }
  const id = crypto.randomUUID(); const path = `${req.user!.id}/${req.params.moduleId}/${req.params.assessmentId}/${id}`;
  try {
    const row = await uploadSourceWithMetadata(supabaseAdmin, BUCKET, path, documentBuffer, { id, module_id: req.params.moduleId, assessment_id: req.params.assessmentId, uploaded_by: req.user!.id, storage_bucket: BUCKET, storage_object_path: path, original_filename: filename, mime_type: mime, size_bytes: documentBuffer.length, extraction_status: 'processing' });
    let extraction;
    try { extraction = await extractDocument(kind, documentBuffer); }
    catch (error) {
      const code = error instanceof Error && ['empty_document','no_extractable_text','extraction_limit'].includes(error.message) ? error.message : 'extraction_failed';
      const { error: statusError } = await supabaseAdmin.from('assessment_source_documents').update({ extraction_status: 'rejected', extraction_error_code: code }).eq('id', id);
      if (statusError) { res.status(500).json({ error: 'Extraction failed and its status could not be saved.', documentId: id }); return; }
      res.status(422).json({ error: 'Document could not be safely extracted.', documentId: id, extractionStatus: 'rejected' });
      return;
    }
    try { await storeExtraction(id, extraction); }
    catch {
      try { await markExtractionRetryable(supabaseAdmin, id); }
      catch { console.error('[source-document] failed to persist retryable extraction state'); }
      res.status(503).json({ error: 'Document and source file were retained for extraction retry.', documentId: id, retryEndpoint: `/api/assessments/${req.params.assessmentId}/modules/${req.params.moduleId}/source-documents/${id}/retry-extraction` }); return;
    }
    res.status(201).json({ document: { ...publicMetadata(row, extraction), extractionStatus: 'ready', extractionErrorCode: null } });
  } catch (error) {
    if (error instanceof Error && ['metadata_failed_storage_cleanup_failed','extraction_metadata_update_cache_cleanup_failed','storage_upload_cleanup_failed'].includes(error.message)) console.error('[source-document] compensating cleanup failed');
    res.status(500).json({ error: 'Document upload failed.' });
  } finally { documentBuffer.fill(0); }
});

router.post('/:assessmentId/modules/:moduleId/source-documents/:documentId/retry-extraction', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  if (!supabaseAdmin) { res.status(503).json({ error: 'Document service unavailable.' }); return; }
  const access = await authorize(req.params.assessmentId, req.params.moduleId, req.user!.id, req.user!.role === 'admin');
  if ('error' in access) { sendAuthError(res, access.error!); return; }
  const { data: row, error } = await supabaseAdmin.from('assessment_source_documents').select(selectFields).eq('id', req.params.documentId).eq('assessment_id', req.params.assessmentId).eq('module_id', req.params.moduleId).maybeSingle();
  if (error) { res.status(500).json({ error: 'Failed to retrieve source document.' }); return; }
  if (!row) { res.status(404).json({ error: 'Source document not found.' }); return; }
  if (!['failed','processing'].includes(row.extraction_status)) { res.status(409).json({ error: 'Only failed or interrupted extraction can be retried.' }); return; }
  const { data: stored, error: downloadError } = await supabaseAdmin.storage.from(BUCKET).download(row.storage_object_path);
  if (downloadError || !stored) { res.status(503).json({ error: 'Retained source file is unavailable for retry.' }); return; }
  const bytes = Buffer.from(await stored.arrayBuffer());
  try {
    const kind = identifyDocument(row.original_filename, row.mime_type, bytes);
    const extraction = await extractDocument(kind, bytes);
    await storeExtraction(row.id, extraction);
    res.json({ document: { ...publicMetadata(row, extraction), extractionStatus: 'ready', extractionErrorCode: null } });
  } catch (failure) {
    if (failure instanceof Error && ['empty_document','no_extractable_text','extraction_limit','invalid_document','unsupported_document'].includes(failure.message)) {
      const { error: statusError } = await supabaseAdmin.from('assessment_source_documents').update({ extraction_status: 'rejected', extraction_error_code: failure.message }).eq('id', row.id);
      if (statusError) { res.status(500).json({ error: 'Extraction failed and its status could not be saved.' }); return; }
      res.status(422).json({ error: 'Retained document cannot be extracted.' }); return;
    }
    try { await markExtractionRetryable(supabaseAdmin, row.id); } catch { console.error('[source-document] failed to persist retryable extraction state'); }
    res.status(503).json({ error: 'Extraction retry failed; the retained document remains retryable.', documentId: row.id });
  } finally { bytes.fill(0); }
});

router.get('/:assessmentId/modules/:moduleId/source-documents', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  if (!supabaseAdmin) { res.status(503).json({ error: 'Document service unavailable.' }); return; }
  const access = await authorize(req.params.assessmentId, req.params.moduleId, req.user!.id, req.user!.role === 'admin', false);
  if ('error' in access) { sendAuthError(res, access.error!); return; }
  const { data, error } = await supabaseAdmin.from('assessment_source_documents').select(selectFields).eq('assessment_id', req.params.assessmentId).eq('module_id', req.params.moduleId).order('uploaded_at', { ascending: false });
  if (error) { res.status(500).json({ error: 'Failed to retrieve source documents.' }); return; }
  const ids = (data || []).map((d) => d.id);
  const { data: cache, error: cacheError } = ids.length ? await supabaseAdmin.from('assessment_source_document_extractions').select('source_document_id,extraction_units,extraction_character_count,extraction_range_kind').in('source_document_id', ids) : { data: [], error: null };
  if (cacheError) { res.status(500).json({ error: 'Failed to retrieve extraction metadata.' }); return; }
  const byId = new Map((cache || []).map((c: any) => [c.source_document_id, { units: c.extraction_units, unitCount: c.extraction_units.length, characterCount: c.extraction_character_count, rangeKind: c.extraction_range_kind }]));
  res.json({ documents: (data || []).map((d) => publicMetadata(d, byId.get(d.id))) });
});
router.get('/:assessmentId/modules/:moduleId/source-documents/:documentId', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  if (!supabaseAdmin) { res.status(503).json({ error: 'Document service unavailable.' }); return; }
  const access = await authorize(req.params.assessmentId, req.params.moduleId, req.user!.id, req.user!.role === 'admin', false);
  if ('error' in access) { sendAuthError(res, access.error!); return; }
  const { data: row, error } = await supabaseAdmin.from('assessment_source_documents').select(selectFields).eq('id', req.params.documentId).eq('assessment_id', req.params.assessmentId).eq('module_id', req.params.moduleId).maybeSingle();
  if (error || !row) { res.status(404).json({ error: 'Source document not found.' }); return; }
  let extraction;
  try { extraction = await readDocumentExtraction(supabaseAdmin, row.id); }
  catch { res.status(500).json({ error: 'Failed to retrieve extraction metadata.' }); return; }
  if (!extraction) { res.status(503).json({ error: 'Extraction cache is unavailable; re-upload is required.' }); return; }
  res.json({ document: publicMetadata(row, extraction as any) });
});
router.delete('/:assessmentId/modules/:moduleId/source-documents/:documentId', requireMentorOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  if (!supabaseAdmin) { res.status(503).json({ error: 'Document service unavailable.' }); return; }
  const access = await authorize(req.params.assessmentId, req.params.moduleId, req.user!.id, req.user!.role === 'admin');
  if ('error' in access) { sendAuthError(res, access.error!); return; }
  const { data: row, error: lookupError } = await supabaseAdmin.from('assessment_source_documents').select(selectFields).eq('id', req.params.documentId).eq('assessment_id', req.params.assessmentId).eq('module_id', req.params.moduleId).maybeSingle();
  if (lookupError) { res.status(500).json({ error: 'Failed to retrieve source document.' }); return; }
  if (!row) { res.status(404).json({ error: 'Source document not found.' }); return; }
  try { await deleteSourceWithObject(supabaseAdmin, BUCKET, row, req.params.assessmentId, req.params.moduleId); }
  catch { res.status(500).json({ error: 'Source document could not be deleted safely.' }); return; }
  res.json({ message: 'Source document deleted.' });
});

async function storeExtraction(id: string, extraction: Awaited<ReturnType<typeof extractDocument>>) {
  await saveDocumentExtraction(supabaseAdmin!, id, extraction);
}
type PublicExtraction = { units: ContentUnit[]; unitCount: number; characterCount: number; rangeKind: string };
function publicMetadata(row: any, extraction?: PublicExtraction) {
  const cached = extraction;
  return { id: row.id, assessmentId: row.assessment_id, moduleId: row.module_id, filename: row.original_filename, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes), extractionStatus: row.extraction_status, extractionErrorCode: row.extraction_error_code, unitCount: cached?.unitCount ?? row.page_count, characterCount: cached?.characterCount, rangeKind: cached?.rangeKind, availableRanges: cached?.units?.map((u: { number: number }) => u.number), extractedUnits: cached?.units, uploadedAt: row.uploaded_at, extractedAt: row.extracted_at };
}
export default router;
