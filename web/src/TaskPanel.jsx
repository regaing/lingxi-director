import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { useI18n } from './i18n.jsx';
import { Ic } from './components/Icons.jsx';

const STATUS_COLOR = {
  succeeded: '#34d399',
  failed: '#e0503f',
  cancelled: '#8b8b98',
  running: '#3f8fe0',
  queued: '#c08a3e',
  preparing: '#c08a3e',
};

const TERMINAL = ['succeeded', 'failed', 'cancelled'];

const short = (id) => (id ? `${String(id).slice(0, 8)}…` : '-');

function when(t) {
  if (!t) return '-';
  const d = typeof t === 'number' ? new Date(t * 1000) : new Date(t);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function TaskPanel({ wfId, onPreview, onClose }) {
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  // 只拉当前工作流的任务（服务端按 runs 里的 task_id 反查过滤）
  const load = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api.tasks(`?page_size=20${wfId ? `&wfId=${encodeURIComponent(wfId)}` : ''}`);
      setItems(r.items || []);
      setTotal(r.total ?? (r.items || []).length);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }, [wfId]);

  useEffect(() => { load(); }, [load]);

  async function download(it) {
    const url = it.content?.url;
    if (!url) { setNote(t('tasks.noOutput')); return; }
    try {
      const saved = await api.download(url, `task_${String(it.id).slice(0, 8)}`);
      setNote(t('tasks.saved', { f: saved.file || 'downloads/' }));
    } catch (e) {
      setNote(`✕ ${e.message}`);
    }
  }

  async function remove(it) {
    const done = TERMINAL.includes(it.status);
    if (!window.confirm(done ? t('tasks.deleteConfirm') : t('tasks.cancelConfirm'))) return;
    try {
      await api.removeTask(it.id);
      load();
    } catch (e) {
      setNote(`✕ ${e.message}`);
    }
  }

  return (
    <div className="wb-tasks">
      <div className="wb-tasks__head">
        <strong>{t('tasks.title')}</strong>
        <span className="wb-muted">{t('tasks.total', { n: total })}</span>
        <div className="wb-tasks__head-actions">
          <button
            type="button"
            className="wb-icon-btn wb-icon-btn--sm"
            title={busy ? t('common.loading') : t('common.refresh')}
            aria-label={t('common.refresh')}
            onClick={load}
            disabled={busy}
          >
            <Ic n="refresh" size={14} className={busy ? 'wb-spin' : undefined} />
          </button>
          <button type="button" className="wb-icon-btn wb-icon-btn--sm" title={t('common.close')} aria-label={t('common.close')} onClick={onClose}>
            <Ic n="close" size={14} />
          </button>
        </div>
      </div>

      {err && <div className="wb-error">{err}</div>}
      {note && <div className="wb-muted wb-tasks__note">{note}</div>}
      {!busy && !err && items.length === 0 && <div className="wb-empty">{t('tasks.empty')}</div>}

      {items.map((it) => (
        <div className="wb-task" key={it.id}>
          <span className="wb-task__dot" style={{ background: STATUS_COLOR[it.status] || '#3a3a44' }} />
          <div className="wb-task__main">
            <div className="wb-task__id" title={it.id}>{short(it.id)}</div>
            <div className="wb-muted">{it.status} · {when(it.created_at || it.createdAt)}</div>
          </div>
          <div className="wb-task__ops">
            {it.content?.url && (
              <>
                <button type="button" className="wb-btn wb-btn--xs" onClick={() => onPreview(it.content.url)}>{t('tasks.preview')}</button>
                <button type="button" className="wb-btn wb-btn--xs" onClick={() => download(it)}>{t('tasks.download')}</button>
              </>
            )}
            <button type="button" className="wb-btn wb-btn--xs wb-btn--danger" onClick={() => remove(it)}>
              {TERMINAL.includes(it.status) ? t('common.delete') : t('tasks.cancel')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
