import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { Ic } from './Icons.jsx';

/** 任何地方写完通知后 ping 一下，铃铛会立刻重取（省掉把 ref 层层透传） */
export function pingNotifications() {
  try { window.dispatchEvent(new Event('wb:notif')); } catch { /* ignore */ }
}

const LEVEL_COLOR = {
  success: 'var(--ok)',
  error: 'var(--err)',
  warn: 'var(--warn)',
  info: 'var(--accent-2)',
};

/** 列表里的时间：当天只给 HH:MM，跨天给 MM-DD，减少噪声 */
function when(iso, justNow) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const p = (n) => String(n).padStart(2, '0');
  if (sameDay) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  const diff = (now - d) / 1000;
  if (diff < 60) return justNow;
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function NotificationCenter({ onOpenWorkflow }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const [err, setErr] = useState('');
  const boxRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setData(await api.notifications(60));
      setErr('');
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 20000);
    const onPing = () => load();
    window.addEventListener('wb:notif', onPing);
    return () => { clearInterval(timer); window.removeEventListener('wb:notif', onPing); };
  }, [load]);

  // 点面板外面就收起
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function markAll() {
    await api.markNotificationsRead('all').catch(() => {});
    load();
  }

  async function clearAll() {
    await api.clearNotifications(false).catch(() => {});
    load();
  }

  const unread = data.unread || 0;

  return (
    <div className="wb-notif" ref={boxRef}>
      <button
        type="button"
        className={`wb-icon-btn${open ? ' is-active' : ''}`}
        onClick={() => { setOpen((v) => !v); if (!open) load(); }}
        title={t('editor.notice')}
        aria-label={t('editor.notice')}
      >
        <Ic n={unread ? 'bellRing' : 'bell'} size={17} />
        {unread > 0 && <span className="wb-notif__badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="wb-notif__panel" role="dialog" aria-label={t('notif.title')}>
          <div className="wb-notif__head">
            <strong>{t('notif.title')}</strong>
            <span className="wb-notif__count">{unread ? t('notif.unread', { n: unread }) : ''}</span>
            <div className="wb-notif__head-actions">
              <button type="button" className="wb-btn wb-btn--ghost wb-btn--sm" onClick={markAll} disabled={!unread} title={t('notif.readAll')}>
                <Ic n="readAll" size={13} />
              </button>
              <button type="button" className="wb-btn wb-btn--ghost wb-btn--sm" onClick={clearAll} title={t('notif.clear')}>
                <Ic n="remove" size={13} />
              </button>
            </div>
          </div>

          <div className="wb-notif__list">
            {err && <div className="wb-field__err">{err}</div>}
            {!err && !data.items.length && (
              <div className="wb-empty wb-empty--center">
                <Ic n="empty" size={20} />
                <span>{t('notif.empty')}</span>
              </div>
            )}
            {data.items.map((n) => {
              const titleKey = `notif.kind.${n.kind}`;
              const title = t(titleKey);
              return (
                <div key={n.id} className={`wb-notif__item${n.read ? '' : ' is-unread'}`}>
                  <span className="wb-notif__dot" style={{ background: LEVEL_COLOR[n.level] || LEVEL_COLOR.info }} />
                  <div className="wb-notif__body">
                    <div className="wb-notif__line">
                      <span className="wb-notif__title">{title === titleKey ? (n.title || n.kind) : title}</span>
                      <span className="wb-notif__time">{when(n.createdAt, t('notif.justNow'))}</span>
                    </div>
                    {n.body ? <div className="wb-notif__text">{n.body}</div> : null}
                    {n.wfId && onOpenWorkflow ? (
                      <button
                        type="button"
                        className="wb-notif__link"
                        onClick={() => { setOpen(false); onOpenWorkflow(n.wfId); }}
                      >
                        <Ic n="open" size={12} /> {t('common.open')}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
