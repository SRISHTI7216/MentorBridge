import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { extractDocument, identifyDocument, MAX_DOCUMENT_BYTES, MAX_CONTENT_UNITS, MAX_EXTRACTED_CHARS } from '../server/src/services/sourceDocumentExtraction.js';
import { authorize } from '../server/src/routes/sourceDocumentRoutes.js';
import { uploadSourceWithMetadata, saveDocumentExtraction, readDocumentExtraction, deleteSourceWithObject, markExtractionRetryable } from '../server/src/services/sourceDocumentPersistence.js';
import { inspectOfficeZip, MAX_OFFICE_ARCHIVE_BYTES, MAX_OFFICE_ENTRIES } from '../server/src/services/officeZip.js';

const types = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', pdf: 'application/pdf',
};
async function main() {
  const txt = Buffer.from('Line one\nLine two');
  assert.equal(identifyDocument('notes.txt', types.txt, txt), 'txt');
  assert.deepEqual((await extractDocument('txt', txt)).units.map((u) => u.number), [1, 2]);
  assert.throws(() => identifyDocument('evil.exe', 'application/octet-stream', txt));
  assert.throws(() => identifyDocument('notes.txt', types.txt, Buffer.from([0, 1])));
  assert.equal(MAX_DOCUMENT_BYTES, 25 * 1024 * 1024);
  assert.throws(() => identifyDocument('large.txt', types.txt, Buffer.alloc(MAX_DOCUMENT_BYTES + 1)));

  const pptxBytes = await makePptx();
  assert.equal(identifyDocument('lesson.pptx', types.pptx, pptxBytes), 'pptx');
  const slides = await extractDocument('pptx', pptxBytes);
  assert.deepEqual(slides.units.map((u) => u.number), [1, 2]);
  assert.match(slides.units[0].text, /Second/);
  assert.match(slides.units[1].text, /First/);
  await assert.rejects(async () => extractDocument('pptx', await makePptx(true)), /invalid_document/);

  const docx = new JSZip();
  docx.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  docx.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  docx.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Paragraph one</w:t></w:r></w:p><w:p><w:r><w:t>Paragraph two</w:t></w:r></w:p></w:body></w:document>');
  const docxBytes = await docx.generateAsync({ type: 'nodebuffer' });
  const paragraphs = await extractDocument('docx', docxBytes);
  assert.equal(paragraphs.rangeKind, 'paragraph');
  assert.equal(paragraphs.unitCount, 2);
  assert.deepEqual(paragraphs.units.map((u) => u.number), [1, 2]);
  await assert.rejects(() => extractDocument('docx', pptxBytes), /invalid_document/);
  await assert.rejects(() => extractDocument('docx', Buffer.from([0x50, 0x4b, 0x03, 0x04])), /invalid_document/);

  const oversizedZip = await new JSZip().file('oversized.txt', 'x').generateAsync({ type: 'nodebuffer' });
  const centralOffset = oversizedZip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  oversizedZip.writeUInt32LE(MAX_OFFICE_ARCHIVE_BYTES + 1, centralOffset + 24);
  assert.throws(() => inspectOfficeZip(oversizedZip), /extraction_limit/);
  const manyFiles = new JSZip();
  for (let i = 0; i <= MAX_OFFICE_ENTRIES; i++) manyFiles.file(`entry-${i}.txt`, 'x');
  const manyFilesBytes = await manyFiles.generateAsync({ type: 'nodebuffer' });
  assert.throws(() => inspectOfficeZip(manyFilesBytes), /extraction_limit/);
  assert.throws(() => inspectOfficeZip(Buffer.from([0x50, 0x4b, 0x03, 0x04])), /invalid_document/);

  const pdf = makePdf(['First page text', 'Second page text']);
  assert.equal(identifyDocument('pages.pdf', types.pdf, pdf), 'pdf');
  const pages = await extractDocument('pdf', pdf);
  assert.deepEqual(pages.units.map((u) => u.number), [1, 2]);
  assert.match(pages.units[1].text, /Second page text/);
  await assert.rejects(() => extractDocument('pdf', Buffer.from('%PDF-corrupt')));
  await assert.rejects(() => extractDocument('pdf', makePdf([''])));
  await assert.rejects(() => extractDocument('pdf', makePdf(['__IMAGE__'])));
  await assert.rejects(() => extractDocument('pdf', makePdf(Array(501).fill('page'))), /extraction_limit/);

  await assert.rejects(() => extractDocument('txt', Buffer.from('x'.repeat(MAX_EXTRACTED_CHARS + 1))), /extraction_limit/);
  await assert.rejects(() => extractDocument('txt', Buffer.from(Array(MAX_CONTENT_UNITS + 1).fill('x').join('\n'))), /extraction_limit/);

  const owned = { id: 'a', mentor_id: 'mentor-a', status: 'draft' };
  const ownedModule = { id: 'm', created_by: 'mentor-a', status: 'draft' };
  const makeDb = (assessment: any, module: any) => ({ from(table: string) {
    let result: any = table === 'assessments' ? assessment : table === 'learning_modules' ? module : { assessment_id: 'a' };
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: result }) };
    return query;
  } });
  assert.equal((await authorize('a', 'm', 'mentor-a', false, true, makeDb(owned, ownedModule) as any)).error, undefined);
  assert.equal((await authorize('a', 'm', 'mentor-b', false, true, makeDb(owned, ownedModule) as any)).error, 'not_found');
  assert.equal((await authorize('a', 'm', 'admin-1', true, false, makeDb(owned, ownedModule) as any)).error, undefined);
  assert.equal((await authorize('a', 'm', 'admin-1', true, false, makeDb(owned, { ...ownedModule, created_by: 'mentor-b' }) as any)).error, 'not_found');
  assert.equal((await authorize('a', 'm', 'admin-1', true, true, makeDb(owned, { ...ownedModule, status: 'published' }) as any)).error, 'locked');

  const events: string[] = [];
  const fake = makePersistenceDb(events);
  await assert.rejects(() => uploadSourceWithMetadata(fake, 'private', 'server/path', Buffer.from('x'), { mime_type: 'text/plain' }), /metadata_insert_failed/);
  assert.deepEqual(events.slice(0, 3), ['upload', 'insert', 'storage_remove']);
  events.length = 0;
  fake.failUpload = true;
  await assert.rejects(() => uploadSourceWithMetadata(fake, 'private', 'server/path', Buffer.from('x'), { mime_type: 'text/plain' }), /storage_upload_failed/);
  assert.deepEqual(events, ['upload', 'storage_remove']);
  fake.failUpload = false; fake.failInsert = false;
  await saveDocumentExtraction(fake, 'doc1', { units: [{ number: 1, text: 'cached' }], characterCount: 6, rangeKind: 'line' });
  assert.deepEqual(events.slice(-2), ['cache_upsert', 'metadata_ready']);
  const persisted = await readDocumentExtraction(fake, 'doc1');
  assert.equal(persisted?.units[0].text, 'cached');
  fake.failMetadataUpdate = true;
  await assert.rejects(() => saveDocumentExtraction(fake, 'doc1', { units: [{ number: 1, text: 'retry' }], characterCount: 5, rangeKind: 'line' }), /extraction_metadata_update_failed/);
  assert(events.includes('cache_delete'));
  fake.failMetadataUpdate = false;
  await deleteSourceWithObject(fake, 'private', { id: 'doc1', storage_object_path: 'p', mime_type: 'text/plain' }, 'a', 'm');
  assert(events.includes('storage_download') && events.includes('storage_remove') && events.includes('metadata_delete'));
  fake.failDelete = true;
  await assert.rejects(() => deleteSourceWithObject(fake, 'private', { id: 'doc1', storage_object_path: 'p', mime_type: 'text/plain' }, 'a', 'm'), /metadata_delete_failed/);
  assert(events.includes('storage_restore'));
  fake.failCacheWrite = true;
  await assert.rejects(() => saveDocumentExtraction(fake, 'doc1', { units: [{ number: 1, text: 'cached' }], characterCount: 6, rangeKind: 'line' }), /extraction_cache_write_failed/);
  fake.failCacheWrite = false;
  await markExtractionRetryable(fake, 'doc1');
  assert(events.includes('mark_retryable'));
  console.log('Phase 5C.3 document extraction verification passed.');
}
function makePersistenceDb(events: string[]) {
  const db: any = { failUpload: false, failInsert: true, failDelete: false, failMetadataUpdate: false, failCacheWrite: false,
    storage: { from: () => ({ upload: async () => { events.push('upload'); return { error: db.failUpload ? new Error('storage') : null }; }, remove: async () => { events.push('remove'); return { error: null }; }, download: async () => { events.push('storage_download'); return { data: new Blob([Buffer.from('original')]), error: null }; } }) },
    from: (table: string) => ({
      insert: () => { events.push('insert'); return { select: () => ({ single: async () => ({ data: db.failInsert ? null : { id: 'doc1' }, error: db.failInsert ? new Error('db') : null }) }) }; },
      upsert: async () => { events.push('cache_upsert'); return { error: db.failCacheWrite ? new Error('db') : null }; },
      update: (values: any) => ({ eq: async () => { events.push(values.extraction_status === 'failed' ? 'mark_retryable' : 'metadata_ready'); return { error: db.failMetadataUpdate ? new Error('db') : null }; } }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { extraction_units: [{ number: 1, text: 'cached' }], extraction_character_count: 6, extraction_range_kind: 'line' }, error: null }) }) }),
      delete: () => { const query: any = { eq: () => query, select: () => ({ maybeSingle: async () => { events.push('metadata_delete'); return { data: db.failDelete ? null : { id: 'doc1' }, error: db.failDelete ? new Error('db') : null }; } }), then: (resolve: any) => { events.push('cache_delete'); resolve({ error: null }); } }; return query; },
    }) };
  // Storage operations are selected by call order to keep this local fixture small.
  const storageFrom = db.storage.from;
  db.storage.from = () => ({ ...storageFrom(), remove: async () => { events.push(events.includes('metadata_delete') ? 'storage_restore' : 'storage_remove'); return { error: null }; } });
  return db;
}
async function makePptx(brokenRelationship = false): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="257" r:id="rIdSecond"/><p:sldId id="258" r:id="rIdFirst"/></p:sldIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${brokenRelationship ? 'rIdMissing' : 'rIdSecond'}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/><Relationship Id="rIdFirst" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`);
  zip.file('ppt/slides/slide1.xml', '<p:sld><a:t>First</a:t></p:sld>');
  zip.file('ppt/slides/slide2.xml', '<p:sld><a:t>Second</a:t></p:sld>');
  return zip.generateAsync({ type: 'nodebuffer' });
}
function makePdf(texts: string[]): Buffer {
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${texts.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${texts.length} >>`);
  for (let i = 0; i < texts.length; i++) {
    const pageId = 3 + i * 2; const contentId = pageId + 1;
    const imageOnly = texts[i] === '__IMAGE__'; const imageId = 3 + texts.length * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> ${imageOnly ? `/XObject << /Im1 ${imageId} 0 R >>` : ''} >> /Contents ${contentId} 0 R >>`);
    const stream = imageOnly ? 'q 20 0 0 20 20 20 cm /Im1 Do Q' : `BT /F1 12 Tf 20 80 Td (${texts[i]}) Tj ET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  if (texts.includes('__IMAGE__')) objects.push('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\nabc\nendstream');
  let output = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(output)); output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(output); output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
