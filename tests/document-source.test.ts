import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const mocks = vi.hoisted(() => ({ access: vi.fn(), query: vi.fn(), read: vi.fn(), pdf: vi.fn(), docx: vi.fn(), travel: vi.fn(), travelFile: vi.fn() }));
vi.mock('../lib/authorize', () => ({ requireProject: mocks.access }));
vi.mock('../lib/db', () => ({ sql: mocks.query }));
vi.mock('../lib/storage', () => ({ readPrivateObject: mocks.read }));
vi.mock('../lib/travel', () => ({ loadTravel: mocks.travel, travelFile: mocks.travelFile }));
vi.mock('../server/services/export', () => ({ toPdf: mocks.pdf, toDocx: mocks.docx }));
import { loadDocumentSource, MAX_DOCUMENT_BYTES, recipientNumber, safeFileName } from '../lib/document-source';
beforeEach(() => { Object.values(mocks).forEach(mock => mock.mockReset()); mocks.access.mockResolvedValue({ user: {id:'sender'},role:'coordinator',scholarId:null }); });
const input = { projectId:'project-a',sourceId:'source-a',kind:'rtp' as const,format:'pdf' as const };
describe('application document authorization', () => {
  it('requires project access before reading source data', async () => {
    mocks.access.mockRejectedValue({status:403});
    await expect(loadDocumentSource(input)).rejects.toMatchObject({status:403});
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('pins RTP lookup to project, undeleted report and current saved version', async () => {
    mocks.query.mockResolvedValue([{scholar_id:'member-a',number:'01/2026',status:'approved',current_version:3,content:{saved:true}}]);
    mocks.pdf.mockResolvedValue(Buffer.from('PDF'));
    const source = await loadDocumentSource(input);
    expect(source.version).toBe(3);
    expect((await source.makeFile()).filename).toBe('RTP-01-2026.pdf');
    expect(mocks.pdf).toHaveBeenCalledWith({saved:true});
    const [strings,...values]=mocks.query.mock.calls[0];
    expect(values).toEqual(['source-a','project-a']);
    expect(strings.join('?')).toContain('rv.version=r.current_version');
    expect(strings.join('?')).toContain('r.deleted_at IS NULL');
  });
  it('refuses a report from another project without generating a file', async () => {
    mocks.query.mockResolvedValue([]);
    await expect(loadDocumentSource(input)).rejects.toMatchObject({status:404});
    expect(mocks.pdf).not.toHaveBeenCalled();
  });
  it('refuses another scholar report even inside the same project', async () => {
    mocks.access.mockResolvedValue({user:{id:'sender'},role:'scholar',scholarId:'own-member'});
    mocks.query.mockResolvedValue([{scholar_id:'other-member'}]);
    await expect(loadDocumentSource(input)).rejects.toMatchObject({status:403});
  });
  it('identifies unapproved RTP files as previews', async () => {
    mocks.query.mockResolvedValue([{scholar_id:'member',number:'01/2026',status:'draft',current_version:1}]);
    expect((await loadDocumentSource(input)).label).toContain('prévia');
  });
  it('keeps travel exports on their beneficiary and requested format', async () => {
    mocks.travel.mockResolvedValue({beneficiary:{name:'Beneficiary'}});
    mocks.travelFile.mockResolvedValue({buffer:Buffer.from('docx'),mime:'docx',filename:'travel.docx'});
    const source = await loadDocumentSource({...input,kind:'travel',format:'docx'});
    await source.makeFile();
    expect(mocks.travel).toHaveBeenCalledWith('project-a','source-a');
    expect(mocks.travelFile).toHaveBeenCalledWith({name:'Beneficiary'},'docx');
  });
});
describe('private stored documents', () => {
  const data = Buffer.from('private-document');
  const record = {scholar_id:'member-a',created_by:'sender',storage_key:'project-a/private.pdf',size_bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),original_name:'Private.pdf',mime_type:'application/pdf'};
  const documentInput = {...input,kind:'document' as const,format:'original' as const};
  it('reads only the authorized database key and verifies the stored file hash', async () => {
    mocks.query.mockResolvedValue([record]); mocks.read.mockResolvedValue(data);
    expect((await (await loadDocumentSource(documentInput)).makeFile()).buffer).toEqual(data);
    expect(mocks.read).toHaveBeenCalledWith(record.storage_key,MAX_DOCUMENT_BYTES);
  });
  it('rejects a storage key outside the project before fetching any bytes', async () => {
    mocks.query.mockResolvedValue([{...record,storage_key:'other-project/private.pdf'}]);
    await expect(loadDocumentSource(documentInput)).rejects.toMatchObject({status:404});
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('rejects a stored file whose content differs from the registered hash', async () => {
    mocks.query.mockResolvedValue([record]); mocks.read.mockResolvedValue(Buffer.from('modified'));
    await expect((await loadDocumentSource(documentInput)).makeFile()).rejects.toMatchObject({status:409});
  });
  it('enforces size and scholar ownership before accessing storage', async () => {
    mocks.query.mockResolvedValueOnce([{...record,size_bytes:MAX_DOCUMENT_BYTES+1}]);
    await expect(loadDocumentSource(documentInput)).rejects.toMatchObject({status:413});
    mocks.access.mockResolvedValue({user:{id:'sender'},role:'scholar',scholarId:'own-member'});
    mocks.query.mockResolvedValueOnce([{...record,created_by:'another-user'}]);
    await expect(loadDocumentSource(documentInput)).rejects.toMatchObject({status:403});
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('rejects format conversion for original attachments', async () => {
    await expect(loadDocumentSource({...documentInput,format:'pdf'})).rejects.toMatchObject({status:400});
  });
});
describe('recipient and filename handling', () => {
  it('accepts an explicitly entered international number and rejects groups, URLs and malformed values', () => {
    expect(recipientNumber('+55 (63) 99999-9999')).toBe('5563999999999');
    for (const value of ['group@g.us','https://example.com/5563999999999','abc5563999999999','999']) expect(() => recipientNumber(value)).toThrow();
  });
  it('removes control characters and paths from downloaded filenames', () => {
    expect(safeFileName('folder/report\r\n".pdf')).toBe('folder_report___.pdf');
  });
});
