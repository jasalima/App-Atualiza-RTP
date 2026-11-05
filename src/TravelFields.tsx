import { useState } from 'react';
import { ArrowDown, ArrowUp, CalendarDays, ImagePlus, Plus, Trash2 } from 'lucide-react';
import { photos as photosApi } from './api';
import type { TravelEntry, TravelPhoto, TravelReport } from './types';
import { errorText, useToast } from './ui';

// One row per day between departure and return, keeping what was already typed.
export function tripDays(start: string, end: string, current: TravelEntry[]) {
  const out: TravelEntry[] = [];
  for (let d = new Date(`${start}T12:00:00Z`), last = new Date(`${end}T12:00:00Z`); d <= last && out.length < 60; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    out.push(current.find((e) => e.date === date) ?? { date, activity: '' });
  }
  return [...out, ...current.filter((e) => !e.date && e.activity.trim())];
}

/** The editable part of Form 26: trip identification and description, shared by the team editor and the signing link. */
export function TravelFields({ r, set, locked }: { r: TravelReport; set: (patch: Partial<TravelReport>) => void; locked: boolean }) {
  const setEntry = (i: number, patch: Partial<TravelEntry>) => set({ entries: r.entries.map((e, n) => (n === i ? { ...e, ...patch } : e)) });
  return <>
    <section className="panel panel-pad">
      <h3 style={{ fontSize: 18, marginBottom: 14 }}>Identificação do afastamento</h3>
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="grid-form">
          <label className="field">Cidade/UF de origem<input value={r.origin} onChange={(e) => set({ origin: e.target.value })} placeholder="Palmas/TO" /><small>Padrão: Palmas/TO</small></label>
          <label className="field">Cidade/UF de destino<input value={r.destination} onChange={(e) => set({ destination: e.target.value })} placeholder="Lagoa da Confusão/TO" /><small>Padrão: Lagoa da Confusão/TO</small></label>
          <label className="field">Saída<input type="date" value={r.departureDate ?? ''} onChange={(e) => set({ departureDate: e.target.value || null })} /></label>
          <label className="field">Retorno<input type="date" value={r.returnDate ?? ''} min={r.departureDate ?? undefined} onChange={(e) => set({ returnDate: e.target.value || null })} /></label>
          <label className="field">Data do pagamento da diária<input type="date" value={r.paymentDate ?? ''} onChange={(e) => set({ paymentDate: e.target.value || null })} /><small>Opcional</small></label>
        </div>
      </fieldset>
    </section>

    <section className="panel panel-pad">
      <h3 style={{ fontSize: 18, marginBottom: 4 }}>Descrição da viagem</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Descreva o objetivo da viagem e relate os resultados, assim como outras informações pertinentes.</p>
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0 }}>
        <label className="field">Objetivo e resultados<textarea value={r.objective} onChange={(e) => set({ objective: e.target.value })} style={{ minHeight: 120 }} /></label>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, margin: '18px 0 8px', flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>Atividades por data</b>
          <div className="head-actions">
            <button type="button" className="btn btn-sm" disabled={!r.departureDate || !r.returnDate} onClick={() => set({ entries: tripDays(r.departureDate!, r.returnDate!, r.entries) })} title={!r.departureDate || !r.returnDate ? 'Informe saída e retorno' : undefined}><CalendarDays />Um dia por linha</button>
            <button type="button" className="btn btn-sm" onClick={() => set({ entries: [...r.entries, { date: '', activity: '' }] })}><Plus />Linha</button>
          </div>
        </div>
        {r.entries.length ? <div className="travel-entries">{r.entries.map((e, i) => <div className="travel-entry" key={i}>
          <input type="date" value={e.date} onChange={(ev) => setEntry(i, { date: ev.target.value })} aria-label={`Data da linha ${i + 1}`} />
          <textarea value={e.activity} onChange={(ev) => setEntry(i, { activity: ev.target.value })} aria-label={`Atividades da linha ${i + 1}`} placeholder="Atividades realizadas nesta data" />
          <button type="button" className="icon-btn" onClick={() => set({ entries: r.entries.filter((_, n) => n !== i) })} aria-label={`Remover linha ${i + 1}`}><Trash2 /></button>
        </div>)}</div> : <p className="muted" style={{ fontSize: 13.5 }}>Sem linhas: o documento sai com linhas em branco. Use “Um dia por linha” para preencher conforme as datas da viagem.</p>}
      </fieldset>
    </section>
  </>;
}

/** "Registro fotográfico": photos with captions, saved one by one (no separate Save). */
export function PhotoManager({ endpoint, photos, onChange, locked }: { endpoint: string; photos: TravelPhoto[]; onChange: (p: TravelPhoto[]) => void; locked: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(''), [captions, setCaptions] = useState<Record<string, string>>({});
  async function add(list: FileList | null) {
    const files = Array.from(list ?? []);
    for (const [i, file] of files.entries()) {
      setBusy(`Enviando foto ${i + 1} de ${files.length}…`);
      try { onChange((await photosApi.add(endpoint, file, '')).photos); } catch (e) { toast(errorText(e), 'crit'); }
    }
    setBusy('');
  }
  async function change(body: Parameters<typeof photosApi.change>[1]) {
    setBusy('Salvando…');
    try { onChange((await photosApi.change(endpoint, body)).photos); } catch (e) { toast(errorText(e), 'crit'); } finally { setBusy(''); }
  }
  return <section className="panel panel-pad">
    <h3 style={{ fontSize: 18, marginBottom: 4 }}>Registro fotográfico</h3>
    <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Fotos do evento e comprovantes do deslocamento (recibos, notas fiscais, faturas de hotel e restaurantes). Saem na página “REGISTRO FOTOGRÁFICO” do documento, na ordem abaixo, numeradas automaticamente (Imagem 1 - legenda, Imagem 2 - …).</p>
    {photos.length > 0 && <div className="photo-grid">{photos.map((p, i) => <figure key={p.key} className="photo-card">
      {p.url ? <img src={p.url} alt={p.caption || p.name} loading="lazy" /> : <div className="photo-missing" />}
      <figcaption>
        <b style={{ fontSize: 12.5 }}>Imagem {i + 1}</b>
        <input value={captions[p.key] ?? p.caption} placeholder="Legenda (opcional)" disabled={locked || !!busy} aria-label={`Legenda da foto ${i + 1}`}
          onChange={(e) => setCaptions({ ...captions, [p.key]: e.target.value })}
          onBlur={() => { const c = (captions[p.key] ?? p.caption).trim(); if (c !== p.caption) void change({ action: 'caption', key: p.key, caption: c }); }} />
        {!locked && <span className="row-actions">
          <button type="button" className="icon-btn" disabled={!!busy || i === 0} onClick={() => void change({ action: 'move', key: p.key, offset: -1 })} aria-label="Mover para cima"><ArrowUp /></button>
          <button type="button" className="icon-btn" disabled={!!busy || i === photos.length - 1} onClick={() => void change({ action: 'move', key: p.key, offset: 1 })} aria-label="Mover para baixo"><ArrowDown /></button>
          <button type="button" className="icon-btn" disabled={!!busy} onClick={() => { if (confirm('Remover esta foto do relatório?')) void change({ action: 'remove', key: p.key }); }} aria-label="Remover foto"><Trash2 /></button>
        </span>}
      </figcaption>
    </figure>)}</div>}
    {!locked && <label className="drop" style={{ marginTop: photos.length ? 14 : 0 }}>
      <ImagePlus /><b>{busy || 'Adicionar fotos'}</b><small>JPG, PNG ou WEBP. Cada foto é reduzida para caber no documento.</small>
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={!!busy} onChange={(e) => { const f = e.target.files; void add(f).then(() => { e.target.value = ''; }); }} />
    </label>}
    {locked && !photos.length && <p className="muted" style={{ fontSize: 13.5 }}>Nenhuma foto inserida.</p>}
  </section>;
}
