import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { NODE_DEFS } from '../graph/model.js';
import { useI18n } from '../i18n.jsx';
import { Ic } from '../components/Icons.jsx';

/** 字节数 → 人读的体积（节点卡片摘要用） */
function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return '-';
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${n}B`;
}

/**
 * 端口行：句柄与标签在同一行内布局，彻底避免标签压住正文。
 * 悬停浮出「这个口该接什么」——不点开参数面板也能看懂连线方向。
 */
function Port({ handle, kind, t }) {
  const key = `port.${handle.id}`;
  const text = t(key);
  const name = text === key ? handle.label : text;
  const tip = kind === 'in' ? t('port.tip.in') : t('port.tip.out');
  return (
    <div className={`wb-port wb-port--${kind}`} title={`${name}｜${tip}`}>
      <Handle
        type={kind === 'in' ? 'target' : 'source'}
        position={kind === 'in' ? Position.Left : Position.Right}
        id={handle.id}
        className={`wb-h wb-h--${kind}`}
      />
      <span className="wb-port__label">{name}</span>
    </div>
  );
}

/** 运行态 → 角标图标（与 runner 的状态词表对齐：running / success / error / skipped / cancelled） */
const STATUS_ICON = {
  running: 'running',
  success: 'ok',
  error: 'fail',
  skipped: 'dot',
  cancelled: 'close',
};

export default function BaseNode({ id, type, data, selected }) {
  const { t } = useI18n();
  const def = NODE_DEFS[type] || { labelKey: type, inputs: [], outputs: [], color: '#666', fields: [] };
  const ins = def.inputs || [];
  const outs = def.outputs || [];
  const status = data?.__status || 'idle';

  /* 节点卡片的摘要：优先展示最有信息量的已配置内容 */
  function summary() {
    if (!data) return null;
    // 媒体处理节点要先判：video.frame 也带 role 字段，放到下面的 role/assets 分支之后会被误吞
    if (type === 'video.frame') return `${t(`frame.${data.position || 'last'}`)} → ${t(`role.${data.role || 'first_frame'}`)}`;
    if (type === 'video.concat') return data.namePrefix || 'joined';
    if (type === 'text.vars') {
      const n = String(data.vars || '').split('\n').filter((l) => l.includes('=') && l.indexOf('=') > 0).length;
      return n ? `${n} ${t('unit.vars')}` : null;
    }
    if (typeof data.text === 'string' && data.text.trim()) return data.text.trim().slice(0, 90);
    if (data.role || (data.assets && data.assets.length)) {
      const n = (data.assets || []).length;
      return `${t(`role.${data.role || 'reference_image'}`)} · ${n}`;
    }
    if (data.resolution) return `${data.resolution} · ${data.duration}s · ${data.ratio}`;
    if (data.taskId) return data.taskId;
    if (type === 'image.fit') return t(`color.${data.color || 'black'}`);
    return null;
  }

  /**
   * 运行产物摘要：有 __output 才显示。
   * 这是「跑完就能看到结果」的第一落点 —— 不用点开面板也知道拿到了什么。
   */
  function outputLine() {
    const o = data?.__output;
    if (!o) return null;
    if (type.startsWith('gen.')) {
      if (!o.task_id) return null;
      return { icon: 'zap', text: String(o.task_id), title: o.task_id, mono: true };
    }
    if (type === 'task.watch') {
      if (o.video_url) {
        return { icon: 'film', text: t('node.out.video'), title: `${o.task_id ? `#${o.task_id} · ` : ''}${o.video_url}` };
      }
      if (o.status) return { icon: 'clock', text: String(o.status) };
      return null;
    }
    /* 媒体处理节点的产物摘要：跑完当场能看出拿到了什么 */
    if (type === 'video.frame') {
      const img = (o.image || [])[0];
      if (!img) return null;
      return { icon: 'film', text: t('node.out.frame'), title: `${t(`role.${img.role}`)} · ${String(img.dataUrl || '').slice(0, 48)}` };
    }
    if (type === 'video.concat') {
      return o.file ? { icon: 'merge', text: String(o.file), title: o.video_url } : null;
    }
    if (type === 'image.fit') {
      return o.image?.length ? { icon: 'params', text: `${o.image.length} ${t('unit.images')}` } : null;
    }
    if (type === 'video.info') {
      if (!o.duration && !o.resolution) return null;
      return { icon: 'info', text: `${o.duration}s · ${o.resolution} · ${fmtSize(o.size)}` };
    }
    if (type === 'text.vars') {
      if (typeof o.text !== 'string') return null;
      return { icon: 'readAll', text: o.text.trim().slice(0, 40) || t('opt.omit'), title: o.text };
    }
    if (type === 'output.download') {
      if (!o.file) return null;
      return { icon: 'download', text: String(o.file), title: String(o.file) };
    }
    if (type === 'output.preview') {
      return o.video_url ? { icon: 'play', text: t('node.out.video'), title: o.video_url } : null;
    }
    return null;
  }

  const sum = summary();
  const out = outputLine();

  return (
    <div className={`wb-node${selected ? ' is-selected' : ''}`} data-type={type} data-status={status}>
      <div className="wb-node__head">
        <span className="wb-node__dot" style={{ background: def.color }} />
        <span className="wb-node__title">{t(def.labelKey)}</span>
        {status !== 'idle' && (
          <span className="wb-node__state" data-status={status} title={t(`run.status.${status}`)}>
            <Ic n={STATUS_ICON[status] || 'dot'} size={11} className={status === 'running' ? 'wb-spin' : ''} />
          </span>
        )}
        <span className="wb-node__id" title={id}>#{id.slice(-4)}</span>
      </div>

      {(ins.length > 0 || outs.length > 0) && (
        <div className="wb-node__ports">
          <div className="wb-ports-col">
            {ins.map((h) => <Port key={`i-${h.id}`} handle={h} kind="in" t={t} />)}
          </div>
          <div className="wb-ports-col wb-ports-col--out">
            {outs.map((h) => <Port key={`o-${h.id}`} handle={h} kind="out" t={t} />)}
          </div>
        </div>
      )}

      {(data?.assets || []).length > 0 && type.startsWith('media.') ? (
        <div className="wb-node__thumbs">
          {data.assets.slice(0, 4).map((a) => (
            <img key={a.asset || a.name} src={`/api/assets/${a.asset || a.name}`} alt={a.name || ''} loading="lazy" />
          ))}
        </div>
      ) : null}

      {sum && !type.startsWith('media.') ? (
        <div className="wb-node__body">
          <span className="wb-node__sum">{sum}</span>
        </div>
      ) : null}

      {out ? (
        <div className="wb-node__out" title={out.title}>
          <Ic n={out.icon} size={11} />
          <span className={out.mono ? 'wb-node__out-id' : ''}>{out.text}</span>
        </div>
      ) : null}
    </div>
  );
}
