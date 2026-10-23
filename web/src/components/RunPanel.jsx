import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { Ic } from './Icons.jsx';

/** 状态 → 图标 / 语义（与 runner 的状态词表一一对应） */
const STATUS_ICON = {
  running: 'running',
  success: 'ok',
  error: 'fail',
  skipped: 'dot',
  cancelled: 'close',
};

const fmtSec = (ms) => {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return s < 1 ? '<1s' : `${s}s`;
};

const fmtTime = (t) => {
  const d = t ? new Date(t) : null;
  if (!d || Number.isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const short = (id) => (id ? String(id).slice(0, 8) : '');

/**
 * 运行结果面板：成品 + 节点时间线 + 最近几次运行。
 *
 * 设计要点：
 *  - 结果的第一落点是「产物区」，不是通知：视频能直接播、能打开、能拿 task_id；
 *  - 时间线点一行就定位到对应节点（画布聚焦由父组件负责）；
 *  - 历史来自 SQLite（lib/runs.mjs），刷新、重启都还在。
 */
export default function RunPanel({
  run, timeline, artifacts, running, elapsed, progress, follow,
  onToggleFollow, onCancel, onFocus, onPreview, wfId,
}) {
  const { t } = useI18n();
  const [history, setHistory] = useState([]);
  const [note, setNote] = useState('');

  // 运行结束后刷一次历史（跑着的时候历史还没写完）
  useEffect(() => {
    if (!wfId || running) return undefined;
    let alive = true;
    api.runs(wfId, 10)
      .then((r) => { if (alive) setHistory(r.items || []); })
      .catch(() => { /* 历史拉不到不影响结果展示 */ });
    return () => { alive = false; };
  }, [wfId, running, run?.id]);

  const videos = useMemo(() => artifacts.filter((a) => a.videoUrl), [artifacts]);
  const files = useMemo(() => artifacts.filter((a) => a.file), [artifacts]);
  const tasks = useMemo(() => artifacts.filter((a) => a.taskId && !a.videoUrl), [artifacts]);

  async function copyTaskId(id) {
    try {
      await navigator.clipboard.writeText(id);
      setNote(t('run.copied'));
      setTimeout(() => setNote(''), 1800);
    } catch {
      setNote(t('run.copyFailed'));
    }
  }

  if (!run) {
    return (
      <aside className="wb-runpanel wb-runpanel--empty">
        <div className="wb-empty wb-empty--center">
          <Ic n="play" size={22} />
          <span>{t('run.empty')}</span>
        </div>
      </aside>
    );
  }

  const statusText = t(`run.status.${run.status}`);

  return (
    <aside className="wb-runpanel">
      <div className="wb-runpanel__head" data-state={run.status}>
        <span className="wb-runpanel__state">
          <Ic n={STATUS_ICON[run.status] || 'dot'} size={15} className={run.status === 'running' ? 'wb-spin' : ''} />
          {statusText}
        </span>
        <span className="wb-runpanel__meta">
          {run.id ? `${short(run.id)} · ` : ''}{fmtSec(elapsed * 1000)}
        </span>
        {running && (
          <button type="button" className="wb-btn wb-btn--xs wb-btn--danger" onClick={onCancel}>{t('run.cancel')}</button>
        )}
      </div>

      <div className="wb-runpanel__progress"><i style={{ width: `${progress}%` }} /></div>

      <div className="wb-runpanel__scroll">
        {run.error && (
          <div className="wb-runpanel__err">
            <Ic n="fail" size={14} />
            <span>{run.error}</span>
          </div>
        )}

        {/* 成品区：这是「看得到结果」的核心 */}
        <div className="wb-group__title">{t('run.outputs')}</div>
        {!artifacts.length && (
          <div className="wb-empty wb-empty--soft">{running ? t('run.pending') : t('run.noOutput')}</div>
        )}

        {videos.map((a) => (
          <div className="wb-artifact" key={`v-${a.nodeId}`}>
            <video src={a.videoUrl} controls preload="metadata" playsInline />
            <div className="wb-artifact__ops">
              <button type="button" className="wb-btn wb-btn--xs" onClick={() => onPreview(a.videoUrl)}>
                <Ic n="play" size={12} /> {t('run.preview')}
              </button>
              <a className="wb-btn wb-btn--xs" href={a.videoUrl} target="_blank" rel="noreferrer">
                <Ic n="external" size={12} /> {t('common.open')}
              </a>
            </div>
          </div>
        ))}

        {files.map((a) => (
          <div className="wb-artifact wb-artifact--file" key={`f-${a.nodeId}`}>
            <Ic n="download" size={14} />
            <a href={`/downloads/${encodeURIComponent(a.file)}`} target="_blank" rel="noreferrer">{a.file}</a>
          </div>
        ))}

        {tasks.map((a) => (
          <div className="wb-artifact wb-artifact--task" key={`t-${a.nodeId}`}>
            <Ic n="zap" size={14} />
            <code>{short(a.taskId)}…</code>
            <button type="button" className="wb-btn wb-btn--xs" onClick={() => copyTaskId(a.taskId)}>{t('run.copyTaskId')}</button>
          </div>
        ))}

        {note && <div className="wb-muted wb-runpanel__note">{note}</div>}

        {/* 节点时间线：一眼看出跑到哪儿、哪个挂了 */}
        <div className="wb-group__title">{t('run.timeline')}</div>
        {!timeline.length && <div className="wb-empty wb-empty--soft">{t('run.timelineEmpty')}</div>}
        {timeline.map((row, i) => (
          <button
            type="button"
            key={`${row.nodeId}-${i}`}
            className="wb-tl"
            data-status={row.status || 'idle'}
            onClick={() => onFocus(row.nodeId)}
            title={row.error || row.type}
          >
            <span className="wb-tl__mark">
              <Ic n={STATUS_ICON[row.status] || 'dot'} size={13} className={row.status === 'running' ? 'wb-spin' : ''} />
            </span>
            <span className="wb-tl__name">{t(`node.${row.type}`) || row.type}</span>
            <span className="wb-tl__state">{row.status ? t(`run.status.${row.status}`) : t('run.status.idle')}</span>
            <span className="wb-tl__ms">{row.ms != null ? fmtSec(row.ms) : ''}</span>
          </button>
        ))}

        {/* 历史：每工作流留最近 50 次（SQLite），点一下就能回看 */}
        {history.length > 1 && (
          <>
            <div className="wb-group__title">{t('run.history')}</div>
            {history.map((h) => (
              <div className="wb-hist" key={h.id} data-status={h.status}>
                <Ic n={STATUS_ICON[h.status] || 'dot'} size={12} />
                <span className="wb-hist__time">{fmtTime(h.startedAt)}</span>
                <span className="wb-hist__meta">{`${h.nodes} · ${t(`run.status.${h.status}`)}`}</span>
                {h.id === run.id && <em className="wb-hist__now">{t('run.current')}</em>}
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
