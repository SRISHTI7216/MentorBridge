import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, AssessmentGenerationPayload, AssessmentSourceDocument } from '../../services/apiClient';
import { Button } from '../../components/ui/Button';
import { acquireActionLock, buildAssessmentGenerationPayload, stableIdempotencyKey, validateSourceFile } from './assessmentGenerationWorkflow';

const COGNITIVE_LEVELS: AssessmentGenerationPayload['cognitiveLevels'] = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
const EMPTY_COUNTS = { mcq: 2, multiple_select: 0, true_false: 0 };
const EMPTY_DIFFICULTY = { easy: 1, medium: 1, hard: 0 };

export const AssessmentQuestionGenerationPanel: React.FC<{
  assessmentId: string; moduleId: string; onGenerated: (questions: any[]) => Promise<void> | void; onOpenReview: () => void;
}> = ({ assessmentId, moduleId, onGenerated, onOpenReview }) => {
  const [documents, setDocuments] = useState<AssessmentSourceDocument[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [rangesByDocument, setRangesByDocument] = useState<Record<string, string>>({});
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [questionCounts, setQuestionCounts] = useState(EMPTY_COUNTS);
  const [difficultyDistribution, setDifficultyDistribution] = useState(EMPTY_DIFFICULTY);
  const [cognitiveLevels, setCognitiveLevels] = useState<AssessmentGenerationPayload['cognitiveLevels']>(['understand', 'apply']);
  const [topicCoverageText, setTopicCoverageText] = useState('');
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [generationMessage, setGenerationMessage] = useState('');
  const retryKey = useRef<{ signature: string; key: string } | null>(null);
  const generationLock = useRef(false);
  const uploadLock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async () => {
    setDocumentsLoading(true); setDocumentsError('');
    try {
      const result = await apiClient.getAssessmentSourceDocuments(assessmentId, moduleId);
      if (result.error || !result.data) throw new Error(result.error || 'Source documents could not be loaded.');
      setDocuments(result.data.documents || []);
    } catch (error: any) { setDocumentsError(error?.message || 'Source documents could not be loaded.'); }
    finally { setDocumentsLoading(false); }
  }, [assessmentId, moduleId]);

  useEffect(() => { void loadDocuments(); }, [loadDocuments]);

  const uploadFile = async (file?: File) => {
    if (!file || uploading || !acquireActionLock(uploadLock)) return;
    const validation = validateSourceFile(file);
    if ('error' in validation) { uploadLock.current = false; setUploadMessage(validation.error); return; }
    if (documents.some(doc => doc.filename === file.name && doc.sizeBytes === file.size)) { uploadLock.current = false; setUploadMessage('This file is already uploaded to this assessment.'); return; }
    setUploading(true); setUploadMessage(`Uploading and extracting ${file.name}...`); setDocumentsError('');
    try {
      const result = await apiClient.uploadAssessmentSourceDocument(assessmentId, moduleId, file, validation.mimeType);
      if (result.error) throw new Error(result.error);
      setUploadMessage(`${file.name} uploaded and extracted.`);
      await loadDocuments();
    } catch (error: any) {
      setUploadMessage(error?.message || 'Upload failed.');
      await loadDocuments();
    } finally { uploadLock.current = false; setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  };

  const retryExtraction = async (documentId: string) => {
    if (uploading || !acquireActionLock(uploadLock)) return;
    setUploading(true); setUploadMessage('Retrying document extraction...');
    try {
      const result = await apiClient.retryAssessmentSourceExtraction(assessmentId, moduleId, documentId);
      if (result.error) throw new Error(result.error);
      setUploadMessage('Document extraction completed.'); await loadDocuments();
    } catch (error: any) { setUploadMessage(error?.message || 'Extraction retry failed.'); await loadDocuments(); }
    finally { uploadLock.current = false; setUploading(false); }
  };

  const deleteDocument = async (document: AssessmentSourceDocument) => {
    if (uploading || uploadLock.current || !confirm(`Delete ${document.filename} and its private extracted source?`)) return;
    if (!acquireActionLock(uploadLock)) return;
    setUploading(true); setUploadMessage('Deleting source document...');
    try {
      const result = await apiClient.deleteAssessmentSourceDocument(assessmentId, moduleId, document.id);
      if (result.error) throw new Error(result.error);
      setSelectedDocuments(current => current.filter(id => id !== document.id));
      setUploadMessage('Source document deleted.'); await loadDocuments();
    } catch (error: any) { setUploadMessage(error?.message || 'Document could not be deleted.'); }
    finally { uploadLock.current = false; setUploading(false); }
  };

  const submitGeneration = async () => {
    if (generating || !acquireActionLock(generationLock)) return;
    setGenerationError(''); setGenerationMessage('');
    const signatureData = { assessmentId, moduleId, selectedDocuments, rangesByDocument, questionCounts, difficultyDistribution, cognitiveLevels, topicCoverageText, additionalInstructions };
    const signature = JSON.stringify(signatureData);
    const keyState = stableIdempotencyKey(signature, retryKey.current, () => globalThis.crypto?.randomUUID?.() || '');
    const idempotencyKey = keyState.key;
    if (!idempotencyKey) { generationLock.current = false; setGenerationError('A secure generation key is unavailable in this browser.'); return; }
    retryKey.current = keyState;
    const validation = buildAssessmentGenerationPayload({ assessmentId, moduleId, documents, selectedDocumentIds: selectedDocuments,
      rangesByDocument, questionCounts, difficultyDistribution, cognitiveLevels, topicCoverageText, additionalInstructions, idempotencyKey });
    if ('error' in validation) { generationLock.current = false; setGenerationError(validation.error); return; }
    setGenerating(true); setGenerationMessage('Generating source-grounded questions...');
    try {
      const result = await apiClient.generateAssessmentQuestions(assessmentId, moduleId, validation.payload);
      if (result.error || !result.data) throw new Error(result.error || 'Question generation did not return a result.');
      retryKey.current = null;
      const count = result.data.questions?.length || 0;
      setGenerationMessage(`${count} question${count === 1 ? '' : 's'} generated and saved as pending-review draft questions.`);
      await onGenerated(result.data.questions || []);
    } catch (error: any) { setGenerationError(error?.message || 'Question generation failed. Correct the issue and retry.'); }
    finally { generationLock.current = false; setGenerating(false); }
  };

  const toggleDocument = (document: AssessmentSourceDocument) => {
    setSelectedDocuments(current => current.includes(document.id)
      ? current.filter(id => id !== document.id)
      : [...current, document.id]);
    setRangesByDocument(current => ({ ...current, [document.id]: current[document.id] || '1' }));
  };

  return <div className="space-y-5">
    <section className="space-y-3">
      <div><h3 className="font-semibold">Private source documents</h3><p className="text-xs text-slate-500">PDF, PPTX, DOCX, or TXT · up to 25 MiB per file</p></div>
      <div className="flex flex-wrap items-center gap-3"><input ref={fileInput} type="file" accept=".pdf,.pptx,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" disabled={uploading} onChange={event => void uploadFile(event.currentTarget.files?.[0])} className="max-w-full text-sm" />{uploading&&<span role="status" className="text-sm text-slate-600">Working...</span>}</div>
      {uploadMessage&&<p role="status" className="text-sm text-slate-600">{uploadMessage}</p>}{documentsError&&<p role="alert" className="text-sm text-rose-700">{documentsError}</p>}
      {documentsLoading?<p role="status" className="text-sm text-slate-500">Loading source documents...</p>:documents.length===0?<p className="rounded border border-dashed p-4 text-sm text-slate-500">No source documents yet. Upload a file to begin.</p>:<div className="space-y-2">{documents.map(document=><article key={document.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><input type="checkbox" aria-label={`Select ${document.filename}`} disabled={document.extractionStatus!=='ready'||(!selectedDocuments.includes(document.id)&&selectedDocuments.length>=5)} checked={selectedDocuments.includes(document.id)} onChange={()=>toggleDocument(document)} /><div className="min-w-0"><p className="truncate text-sm font-medium">{document.filename}</p><p className="text-xs text-slate-500">{document.mimeType} · {(document.sizeBytes/1024/1024).toFixed(2)} MiB · {document.extractionStatus}{document.unitCount?` · ${document.unitCount} ${document.rangeKind||'units'}`:''}</p></div></div><div className="flex gap-2">{['failed','processing'].includes(document.extractionStatus)&&<Button size="sm" variant="outline" disabled={uploading} onClick={()=>void retryExtraction(document.id)}>Retry extraction</Button>}<Button size="sm" variant="outline" disabled={uploading} onClick={()=>void deleteDocument(document)}>Delete</Button></div></div>{selectedDocuments.includes(document.id)&&<label className="mt-3 block text-xs font-medium">{document.rangeKind||'Page / slide / unit'} ranges<input className="mt-1 w-full rounded border px-3 py-2" value={rangesByDocument[document.id]||''} onChange={event=>setRangesByDocument(current=>({...current,[document.id]:event.target.value}))} placeholder="1-3, 5"/><span className="mt-1 block text-slate-500">Available: {(document.availableRanges||[]).join(', ')}</span></label>}</article>)}</div>}
    </section>

    <section className="space-y-3 border-t pt-4"><h3 className="font-semibold">Question configuration</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{([['mcq','MCQ'],['multiple_select','Multiple select'],['true_false','True / false']] as const).map(([key,label])=><label key={key} className="text-xs">{label}<input type="number" min={0} max={20} value={questionCounts[key]} onChange={event=>setQuestionCounts(current=>({...current,[key]:Number(event.target.value)}))} className="mt-1 w-full rounded border px-3 py-2"/></label>)}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{(['easy','medium','hard'] as const).map(level=><label key={level} className="text-xs capitalize">{level} difficulty<input type="number" min={0} max={20} value={difficultyDistribution[level]} onChange={event=>setDifficultyDistribution(current=>({...current,[level]:Number(event.target.value)}))} className="mt-1 w-full rounded border px-3 py-2"/></label>)}</div>
      <fieldset><legend className="mb-2 text-xs font-medium">Cognitive levels</legend><div className="flex flex-wrap gap-3">{COGNITIVE_LEVELS.map(level=><label key={level} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={cognitiveLevels.includes(level)} onChange={event=>setCognitiveLevels(current=>event.target.checked?[...current,level]:current.filter(item=>item!==level))}/>{level}</label>)}</div></fieldset>
      <label className="block text-xs font-medium">Optional topic coverage<textarea value={topicCoverageText} onChange={event=>setTopicCoverageText(event.target.value)} rows={2} placeholder="One topic per line or comma-separated" className="mt-1 w-full rounded border p-2"/></label>
      <label className="block text-xs font-medium">Additional instructions<textarea value={additionalInstructions} onChange={event=>setAdditionalInstructions(event.target.value)} maxLength={1500} rows={3} className="mt-1 w-full rounded border p-2"/><span className="text-slate-500">{additionalInstructions.length}/1500</span></label>
      {generationError&&<p role="alert" className="rounded bg-rose-50 p-3 text-sm text-rose-800">{generationError}</p>}{generationMessage&&<p role="status" className="rounded bg-emerald-50 p-3 text-sm text-emerald-800">{generationMessage}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">Questions are saved as drafts and require mentor review before publication.</p><div className="flex flex-wrap gap-2">{generationMessage&&<Button variant="outline" disabled={generating} onClick={onOpenReview}>Open Question Review</Button>}<Button variant="primary" disabled={generating||uploading||documentsLoading} onClick={()=>void submitGeneration()}>{generating?'Generating...':'Generate Questions with AI'}</Button></div></div>
    </section>
  </div>;
};
