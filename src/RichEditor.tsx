'use client';

import { useRef, useState } from 'react';
import { EditorContent, Extension, Node, mergeAttributes, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Columns3, Combine, ImagePlus, IndentDecrease, IndentIncrease,
  Italic, List, ListOrdered, Minus, Quote, Redo2, Rows3, ScissorsLineDashed, Split, Table2, Trash2, Underline, Undo2, WrapText
} from 'lucide-react';
import { Fragment, Slice } from '@tiptap/pm/model';
import { reflowDoc, reflowNodes, type RichDoc, type RichNode } from '@/lib/minutes-model';

/* Extensions ------------------------------------------------------------------------------------ */
// "Recuos": indentation level of paragraphs and headings (lists use their own nesting).
const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading'], attributes: { indent: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-indent') ?? 0), renderHTML: (a) => (a.indent ? { 'data-indent': a.indent, style: `margin-left:${a.indent * 2}em` } : {}) } } }];
  },
  addCommands() {
    const change = (delta: number) => () => ({ state, tr, dispatch }: { state: Editor['state']; tr: Editor['state']['tr']; dispatch?: (tr: Editor['state']['tr']) => void }) => {
      let changed = false;
      state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
        if (!['paragraph', 'heading'].includes(node.type.name)) return;
        const next = Math.max(0, Math.min(6, Number(node.attrs.indent ?? 0) + delta));
        if (next !== node.attrs.indent) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next }); changed = true; }
      });
      if (changed && dispatch) dispatch(tr);
      return changed;
    };
    return { indent: change(1), outdent: change(-1) } as never;
  }
});
const PageBreak = Node.create({
  name: 'pageBreak', group: 'block', atom: true, selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'rich-page-break' }), ['span', {}, 'Quebra de página']],
  addCommands() { return { setPageBreak: () => ({ commands }: { commands: Editor['commands'] }) => commands.insertContent({ type: 'pageBreak' }) } as never; }
});
const BorderedTable = Table.extend({
  addAttributes() { return { ...this.parent?.(), bordered: { default: true, parseHTML: (el: HTMLElement) => el.getAttribute('data-bordered') !== 'false', renderHTML: (a: { bordered: boolean }) => ({ 'data-bordered': String(a.bordered !== false) }) } }; }
});
const shade = { backgroundColor: { default: null, parseHTML: (el: HTMLElement) => el.style.backgroundColor || null, renderHTML: (a: { backgroundColor: string | null }) => (a.backgroundColor ? { style: `background-color:${a.backgroundColor}` } : {}) } };
const ShadedCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...shade }; } });
const ShadedHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...shade }; } });

const extensions = [
  StarterKit.configure({ heading: { levels: [2, 3] }, code: false, codeBlock: false, link: false, strike: false }),
  TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
  Image.configure({ inline: false, allowBase64: false }), Indent, PageBreak,
  BorderedTable.configure({ resizable: true, cellMinWidth: 40 }), TableRow, ShadedHeader, ShadedCell
];

/* Table models ---------------------------------------------------------------------------------- */
const cell = (type: 'tableHeader' | 'tableCell', text = '', attrs: Record<string, unknown> = {}): RichNode => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs }, content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] });
function model(caption: string, head: string[], widths: number[], rows: string[][], footer?: RichNode): RichNode[] {
  return [
    { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: caption, marks: [{ type: 'bold' }] }] },
    { type: 'table', attrs: { bordered: true }, content: [
      { type: 'tableRow', content: head.map((h, i) => cell('tableHeader', h, { colwidth: [widths[i]] })) },
      ...rows.map((r) => ({ type: 'tableRow', content: r.map((t, i) => cell('tableCell', t, { colwidth: [widths[i]] })) })),
      ...(footer ? [footer] : [])
    ] },
    { type: 'paragraph' }
  ];
}
export const TABLE_MODELS: Record<string, { label: string; nodes: () => RichNode[] }> = {
  decisions: { label: 'Quadro de encaminhamentos', nodes: () => model('Quadro – Encaminhamentos', ['Nº', 'Encaminhamento', 'Responsável', 'Prazo'], [40, 320, 170, 90], [['1', '', '', ''], ['2', '', '', ''], ['3', '', '', '']]) },
  schedule: { label: 'Quadro de cronograma', nodes: () => model('Quadro – Cronograma', ['Atividade', 'Responsável', 'Início', 'Conclusão'], [300, 170, 90, 90], [['', '', '', ''], ['', '', '', ''], ['', '', '', '']]) },
  roles: { label: 'Quadro de responsabilidades', nodes: () => model('Quadro – Responsabilidades', ['Participante', 'Instituição', 'Responsabilidade'], [200, 150, 300], [['', '', ''], ['', '', ''], ['', '', '']]) },
  budget: { label: 'Quadro financeiro', nodes: () => model('Quadro – Financeiro', ['Descrição', 'Quantidade', 'Valor', 'Total'], [290, 90, 120, 120], [['', '', '', ''], ['', '', '', '']], { type: 'tableRow', content: [cell('tableCell', 'Total geral', { colspan: 3, colwidth: [290, 90, 120] }), cell('tableCell', '', { colwidth: [120] })] }) }
};
const CELL_COLORS = [['', 'Sem cor'], ['#E9E9E9', 'Cinza'], ['#FFF3D6', 'Laranja claro'], ['#E1EEE5', 'Verde claro'], ['#E2EEF5', 'Azul claro']];

/* Editor ---------------------------------------------------------------------------------------- */
/** Toolbar button: keeps the text selection (mousedown does not take the focus). */
function B({ title, active, onClick, children, disabled }: { title: string; active?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return <button type="button" className={active ? 'rich-btn on' : 'rich-btn'} title={title} aria-label={title} aria-pressed={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>;
}
type Props = { value: RichDoc | null; onChange: (doc: RichDoc) => void; editable?: boolean; placeholder?: string; onUpload?: (file: File) => Promise<string>; minHeight?: number; label: string };
export default function RichEditor({ value, onChange, editable = true, onUpload, minHeight = 140, label }: Props) {
  const [uploading, setUploading] = useState(false), [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  // The editor is created once: it must always call the latest onChange (the parent's state moves on).
  const changed = useRef(onChange);
  changed.current = onChange;
  const editor = useEditor({
    extensions, content: (value ?? { type: 'doc', content: [{ type: 'paragraph' }] }) as never, editable, immediatelyRender: false, shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: 'rich-body', 'aria-label': label, style: `min-height:${minHeight}px` },
      // Text pasted from PDFs, e-mails or WhatsApp arrives one paragraph per line: join the lines.
      transformPasted: (slice, view) => {
        try {
          const before = (slice.content.toJSON() ?? []) as RichNode[], nodes = reflowNodes(before);
          if (!nodes.length || JSON.stringify(nodes) === JSON.stringify(before)) return slice;
          // Open ends are kept only where the edge node is still the same kind (a paragraph merges into the text around it).
          const same = (a?: RichNode, b?: RichNode) => !!a && !!b && a.type === b.type && JSON.stringify(a.content?.[0]?.type) === JSON.stringify(b.content?.[0]?.type);
          return new Slice(Fragment.fromJSON(view.state.schema, nodes), same(before[0], nodes[0]) ? slice.openStart : 0, same(before[before.length - 1], nodes[nodes.length - 1]) ? slice.openEnd : 0);
        } catch { return slice; }
      }
    },
    onUpdate: ({ editor: e }) => changed.current(e.getJSON() as RichDoc)
  }, [editable]);
  if (!editor) return <div className="rich" style={{ minHeight }} />;
  // Commands are built only when a button is clicked: chain().focus() runs the focus right away.
  type Chain = ReturnType<Editor['chain']> & Record<string, (...a: unknown[]) => ReturnType<Editor['chain']>>;
  const run = (fn: (c: Chain) => ReturnType<Editor['chain']>) => () => { fn(editor.chain().focus() as Chain).run(); };
  const on = (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs);
  async function pick(f: File | undefined) {
    if (!f || !onUpload) return;
    setUploading(true); setError('');
    try { const src = await onUpload(f); editor!.chain().focus().setImage({ src, alt: f.name }).run(); }
    catch (x) { setError((x as Error).message); } finally { setUploading(false); if (file.current) file.current.value = ''; }
  }
  const inTable = on('table');
  const style = on('heading', { level: 2 }) ? 'h2' : on('heading', { level: 3 }) ? 'h3' : 'p';
  return <div className={editable ? 'rich' : 'rich rich-readonly'}>
    {editable && <div className="rich-bar" role="toolbar" aria-label={`Formatação: ${label}`}>
      <div className="rich-group">
        <B title="Desfazer (Ctrl+Z)" onClick={run((c) => c.undo())} disabled={!editor.can().undo()}><Undo2 /></B>
        <B title="Refazer (Ctrl+Y)" onClick={run((c) => c.redo())} disabled={!editor.can().redo()}><Redo2 /></B>
      </div>
      <div className="rich-group">
        <select className="rich-select rich-style" aria-label="Estilo do parágrafo" value={style} onChange={(e) => { const v = e.target.value; const c = editor.chain().focus(); (v === 'p' ? c.setParagraph() : c.setHeading({ level: v === 'h2' ? 2 : 3 })).run(); }}>
          <option value="p">Texto normal</option><option value="h2">Título</option><option value="h3">Subtítulo</option>
        </select>
      </div>
      <div className="rich-group">
        <B title="Negrito (Ctrl+B)" active={on('bold')} onClick={run((c) => c.toggleBold())}><Bold /></B>
        <B title="Itálico (Ctrl+I)" active={on('italic')} onClick={run((c) => c.toggleItalic())}><Italic /></B>
        <B title="Sublinhado (Ctrl+U)" active={on('underline')} onClick={run((c) => c.toggleUnderline())}><Underline /></B>
      </div>
      <div className="rich-group">
        <B title="Alinhar à esquerda" active={editor.isActive({ textAlign: 'left' })} onClick={run((c) => c.setTextAlign('left'))}><AlignLeft /></B>
        <B title="Centralizar" active={editor.isActive({ textAlign: 'center' })} onClick={run((c) => c.setTextAlign('center'))}><AlignCenter /></B>
        <B title="Alinhar à direita" active={editor.isActive({ textAlign: 'right' })} onClick={run((c) => c.setTextAlign('right'))}><AlignRight /></B>
        <B title="Justificar" active={editor.isActive({ textAlign: 'justify' })} onClick={run((c) => c.setTextAlign('justify'))}><AlignJustify /></B>
        <B title="Ajustar parágrafos: junta as linhas quebradas de textos colados" onClick={() => { const json = editor.getJSON() as RichDoc, next = reflowDoc(json); if (JSON.stringify(next) !== JSON.stringify(json)) editor.chain().focus().setContent(next as never, { emitUpdate: true }).run(); }}><WrapText /></B>
      </div>
      <div className="rich-group">
        <B title="Lista com marcadores" active={on('bulletList')} onClick={run((c) => c.toggleBulletList())}><List /></B>
        <B title="Lista numerada" active={on('orderedList')} onClick={run((c) => c.toggleOrderedList())}><ListOrdered /></B>
        <B title="Citação" active={on('blockquote')} onClick={run((c) => c.toggleBlockquote())}><Quote /></B>
        <B title="Aumentar recuo" onClick={run((c) => (on('listItem') ? c.sinkListItem('listItem') : c.indent()))}><IndentIncrease /></B>
        <B title="Diminuir recuo" onClick={run((c) => (on('listItem') ? c.liftListItem('listItem') : c.outdent()))}><IndentDecrease /></B>
      </div>
      <div className="rich-group">
        {onUpload && <B title={uploading ? 'Enviando imagem…' : 'Inserir imagem'} disabled={uploading} onClick={() => file.current?.click()}><ImagePlus /></B>}
        <B title="Inserir tabela 3 × 3" onClick={run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}><Table2 /></B>
        <select className="rich-select" aria-label="Inserir quadro modelo" value="" onChange={(e) => { const m = TABLE_MODELS[e.target.value]; if (m) editor.chain().focus().insertContent(m.nodes() as never).run(); }}>
          <option value="">Inserir quadro…</option>{Object.entries(TABLE_MODELS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <B title="Linha horizontal" onClick={run((c) => c.setHorizontalRule())}><Minus /></B>
        <B title="Quebra de página" onClick={run((c) => c.setPageBreak())}><ScissorsLineDashed /></B>
      </div>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void pick(e.target.files?.[0])} />
    </div>}
    {editable && inTable && <div className="rich-bar rich-bar-table" role="toolbar" aria-label="Tabela">
      <span>Tabela</span>
      <button type="button" className="btn btn-sm" onClick={run((c) => c.addRowAfter())}><Rows3 />+ linha</button>
      <button type="button" className="btn btn-sm" onClick={run((c) => c.addColumnAfter())}><Columns3 />+ coluna</button>
      <button type="button" className="btn btn-sm" onClick={run((c) => c.deleteRow())}>− linha</button>
      <button type="button" className="btn btn-sm" onClick={run((c) => c.deleteColumn())}>− coluna</button>
      <button type="button" className="btn btn-sm" disabled={!editor.can().mergeCells()} onClick={run((c) => c.mergeCells())}><Combine />Mesclar</button>
      <button type="button" className="btn btn-sm" disabled={!editor.can().splitCell()} onClick={run((c) => c.splitCell())}><Split />Dividir</button>
      <button type="button" className="btn btn-sm" onClick={run((c) => c.toggleHeaderRow())}>Cabeçalho</button>
      <select className="rich-select" aria-label="Cor da célula" value="" onChange={(e) => { editor.chain().focus().setCellAttribute('backgroundColor', e.target.value || null).run(); }}>
        <option value="">Cor da célula…</option>{CELL_COLORS.map(([v, l]) => <option key={l} value={v}>{l}</option>)}
      </select>
      <button type="button" className="btn btn-sm" onClick={() => editor.chain().focus().updateAttributes('table', { bordered: !editor.getAttributes('table').bordered }).run()}>{editor.getAttributes('table').bordered === false ? 'Com bordas' : 'Sem bordas'}</button>
      <button type="button" className="btn btn-sm btn-danger" onClick={run((c) => c.deleteTable())}><Trash2 />Excluir tabela</button>
    </div>}
    {error && <p className="rich-error" role="alert">{error}</p>}
    <EditorContent editor={editor} />
  </div>;
}
