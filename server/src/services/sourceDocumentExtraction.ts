import JSZip from 'jszip';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import path from 'node:path';
import { extractZipEntry, inspectOfficeZip } from './officeZip.js';

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_EXTRACTED_CHARS = 2_000_000;
export const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_CONTENT_UNITS = 500;
export type DocumentKind = 'pdf' | 'pptx' | 'docx' | 'txt';
export type ContentUnit = { number: number; text: string };
export type Extraction = { kind: DocumentKind; units: ContentUnit[]; unitCount: number; characterCount: number; rangeKind: 'page' | 'slide' | 'paragraph' | 'line' };

const types: Record<DocumentKind, string> = {
  pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain',
};
export function identifyDocument(filename: string, declaredMime: string, bytes: Buffer): DocumentKind {
  if (bytes.length < 1 || bytes.length > MAX_DOCUMENT_BYTES) throw new Error('document_size_limit');
  const ext = filename.toLowerCase().split('.').pop();
  const kind = (['pdf', 'pptx', 'docx', 'txt'] as DocumentKind[]).find((x) => x === ext);
  if (!kind || declaredMime.split(';')[0].trim().toLowerCase() !== types[kind]) throw new Error('unsupported_document');
  const zip = bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (kind === 'pdf' && !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('invalid_document');
  if ((kind === 'docx' || kind === 'pptx') && !zip) throw new Error('invalid_document');
  if (kind === 'txt' && (bytes.includes(0) || !isUtf8(bytes))) throw new Error('invalid_document');
  return kind;
}
function isUtf8(bytes: Buffer): boolean { try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; } }
function enforceLimits(units: ContentUnit[]): void {
  const size = units.reduce((n, u) => n + Array.from(u.text).length, 0);
  if (size > MAX_EXTRACTED_CHARS || units.length > MAX_CONTENT_UNITS) throw new Error('extraction_limit');
}
export async function extractDocument(kind: DocumentKind, bytes: Buffer): Promise<Extraction> {
  if (bytes.length < 1 || bytes.length > MAX_DOCUMENT_BYTES) throw new Error('document_size_limit');
  let units: ContentUnit[]; let rangeKind: Extraction['rangeKind'];
  if (kind === 'pdf') {
    const parser = new PDFParse({ data: bytes });
    let totalPages: number;
    try {
      const info = await parser.getInfo();
      if (info.total > MAX_CONTENT_UNITS) throw new Error('extraction_limit');
      totalPages = info.total;
      units = [];
      let chars = 0;
      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
        const page = await parser.getText({ partial: [pageNumber] });
        const text = page.pages[0]?.text.trim() || '';
        chars += Array.from(text).length;
        if (chars > MAX_EXTRACTED_CHARS) throw new Error('extraction_limit');
        units.push({ number: pageNumber, text });
      }
    } finally { await parser.destroy(); }
    rangeKind = 'page';
    if (!units.some((u) => u.text.trim())) throw new Error('no_extractable_text');
  } else if (kind === 'pptx') {
    const entries = inspectOfficeZip(bytes);
    const presentation = readOfficeText(bytes, entries, 'ppt/presentation.xml');
    const relationships = readOfficeText(bytes, entries, 'ppt/_rels/presentation.xml.rels');
    if (!/<(?:\w+:)?presentation\b/.test(presentation)) throw new Error('invalid_document');
    const relMap = parsePresentationRelationships(relationships);
    const order = [...presentation.matchAll(/<(?:\w+:)?sldId\b([^>]*)\/?\s*>/g)].map((match) => readXmlAttributes(match[1]).find(([name]) => name === 'r:id' || name.endsWith(':id'))?.[1]);
    if (!order.length || order.length > MAX_CONTENT_UNITS || order.some((id) => !id || !relMap.has(id))) throw new Error(order.length > MAX_CONTENT_UNITS ? 'extraction_limit' : 'invalid_document');
    units = [];
    let chars = 0;
    for (let i = 0; i < order.length; i++) {
      const slidePath = relMap.get(order[i]!)!;
      const xml = readOfficeText(bytes, entries, slidePath);
      if (!/<(?:\w+:)?sld\b/.test(xml)) throw new Error('invalid_document');
      const text = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(' ');
      chars += Array.from(text).length;
      if (chars > MAX_EXTRACTED_CHARS) throw new Error('extraction_limit');
      units.push({ number: i + 1, text });
    }
    rangeKind = 'slide';
  } else if (kind === 'docx') {
    const entries = inspectOfficeZip(bytes);
    const contentTypes = readOfficeText(bytes, entries, '[Content_Types].xml');
    const rootRelationships = readOfficeText(bytes, entries, '_rels/.rels');
    const documentXml = readOfficeText(bytes, entries, 'word/document.xml');
    if (!/<(?:\w+:)?Types\b/.test(contentTypes) || !/<(?:\w+:)?document\b/.test(documentXml)) throw new Error('invalid_document');
    const officeDocument = parseRootOfficeDocumentRelationship(rootRelationships);
    if (officeDocument !== 'word/document.xml') throw new Error('invalid_document');
    const safeArchive = new JSZip();
    safeArchive.file('[Content_Types].xml', contentTypes);
    safeArchive.file('_rels/.rels', rootRelationships);
    safeArchive.file('word/document.xml', documentXml);
    const safeBytes = await safeArchive.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    let result;
    try { result = await mammoth.extractRawText({ buffer: safeBytes }); }
    finally { safeBytes.fill(0); }
    units = result.value.split(/\n+/).map((text, i) => ({ number: i + 1, text: text.trim() })).filter((u) => u.text);
    rangeKind = 'paragraph';
  } else {
    units = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n').split('\n').map((text, i) => ({ number: i + 1, text }));
    rangeKind = 'line';
  }
  enforceLimits(units);
  if (units.length === 0 || !units.some((u) => u.text.trim())) throw new Error('empty_document');
  return { kind, units, unitCount: units.length, characterCount: units.reduce((n, u) => n + Array.from(u.text).length, 0), rangeKind };
}
function readOfficeText(bytes: Buffer, entries: Map<string, import('./officeZip.js').ZipEntry>, name: string): string {
  const entry = entries.get(name);
  if (!entry || entry.uncompressedSize > MAX_UNCOMPRESSED_BYTES) throw new Error('invalid_document');
  const contents = extractZipEntry(bytes, entry);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(contents); }
  finally { contents.fill(0); }
}
function readXmlAttributes(source: string): Array<[string, string]> {
  const result: Array<[string, string]> = [];
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result.push([match[1], decodeXml(match[2] ?? match[3])]);
  return result;
}
function parsePresentationRelationships(xml: string): Map<string, string> {
  if (!/<(?:\w+:)?Relationships\b/.test(xml)) throw new Error('invalid_document');
  const relationships = new Map<string, string>();
  for (const match of xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?\s*>/g)) {
    const attrs = new Map(readXmlAttributes(match[1])); const id = attrs.get('Id'); const target = attrs.get('Target'); const type = attrs.get('Type');
    if (!id || !target || !type?.endsWith('/slide') || attrs.get('TargetMode') === 'External' || relationships.has(id)) continue;
    const resolved = target.startsWith('/') ? path.posix.normalize(target.slice(1)) : path.posix.normalize(path.posix.join('ppt', target));
    if (resolved.startsWith('../') || resolved === '..' || resolved.startsWith('/')) throw new Error('invalid_document');
    relationships.set(id, resolved);
  }
  return relationships;
}
function parseRootOfficeDocumentRelationship(xml: string): string | undefined {
  if (!/<(?:\w+:)?Relationships\b/.test(xml)) throw new Error('invalid_document');
  for (const match of xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?\s*>/g)) {
    const attrs = new Map(readXmlAttributes(match[1]));
    if (attrs.get('Type')?.endsWith('/officeDocument')) {
      if (attrs.get('TargetMode') === 'External') throw new Error('invalid_document');
      return path.posix.normalize(attrs.get('Target') || '').replace(/^\//, '');
    }
  }
  return undefined;
}
function decodeXml(text: string): string { return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"); }
