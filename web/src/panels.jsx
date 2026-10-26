import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NODE_DEFS, GROUPS, PROVIDER, assetKind } from './graph/model.js';
import { api } from './api.js';
import { useI18n } from './i18n.jsx';
import { Ic } from './components/Icons.jsx';
import NodeHelp from './components/NodeHelp.jsx';
import AssetLightbox from './components/AssetLightbox.jsx';
import { PRESET_GROUPS, presetsOf, pickLang } from './presets.js';

/* 哪些字符串按 i18n key 处理（不是 key 的就当字面量显示）；新增前缀记得加在这里 */
const isKey = (s) => typeof s === 'string' && /^(opt|role|field|node|ratio|frame|color)\./.test(s);

/** 节点库里每类节点的图标：一眼区分输入 / 生成 / 逻辑 / 输出 */
const NODE_ICON = {
  'text.prompt': 'sparkles',
  'text.negative': 'warn',
  'text.merge': 'merge',
  'media.image': 'film',
  'media.video': 'film',
  'media.audio': 'film',
  'param.video': 'params',
  'task.source': 'dot',
  'logic.condition': 'branch',
  'gen.video': 'zap',
  'gen.context': 'layers',
  'gen.regen': 'redo',
  'task.watch': 'clock',
  'text.vars': 'readAll',
  'video.frame': 'film',
  'video.concat': 'merge',
  'image.fit': 'params',
  'video.info': 'info',
  'output.preview': 'play',
  'output.download': 'download',
};

export function Palette({ onAdd }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const kw = q.trim().toLowerCase();

  const matches = (type) => {
    if (!kw) return true;
    const d = NODE_DEFS[type];
    return type.toLowerCase().includes(kw) || t(d.labelKey).toLowerCase().includes(kw);
  };

  return (
    <>
      <div className="wb-sidebar__searchbar">
        <Ic n="search" size={14} className="wb-searchbar__icon" />
        <input
          className="wb-input wb-sidebar__search"
          value={q}
          placeholder={t('editor.palette.search')}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="wb-sidebar__scroll">
        {GROUPS.map((g) => {
          const types = Object.keys(NODE_DEFS).filter((k) => NODE_DEFS[k].group === g && matches(k));
          if (!types.length) return null;
          return (
            <div key={g} className="wb-group">
              <div className="wb-group__title">{t(g)}</div>
              {types.map((type) => {
                const d = NODE_DEFS[type];
                return (
                  <div
                    key={type}
                    className="wb-palette-item"
                    draggable
                    role="button"
                    tabIndex={0}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/wb-node', type);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => onAdd && onAdd(type)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && onAdd) onAdd(type); }}
                    title={type}
                    style={{ '--node-color': d.color }}
                  >
                    <span className="wb-palette-item__glyph" style={{ color: d.color }}>
                      <Ic n={NODE_ICON[type] || 'dot'} size={14} />
                    </span>
                    <span className="wb-palette-item__name">{t(d.labelKey)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * 左侧边栏第二页：AI 改流程。
 * 三块职责分开：「试试这些」用来改现有流程，「剧本预设」用来从零起片。
 */
export function AiPanel({ value, onChange, onRun, busy, reply, usage }) {
  const { t, lang } = useI18n();
  const examples = [t('ai.ex1'), t('ai.ex2'), t('ai.ex3')];
  /** 手风琴只开一组，侧栏本来就窄，全展开会把输入框挤走 */
  const [openGroup, setOpenGroup] = useState(PRESET_GROUPS[0]?.id || '');

  return (
    <div className="wb-sidebar__scroll wb-ai">
      <p className="wb-ai__help">{t('ai.help')}</p>
      <textarea
        className="wb-input wb-ai__input"
        rows={6}
        value={value}
        placeholder={t('editor.ai.placeholder')}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !busy) onRun(); }}
        disabled={busy}
      />
      <button type="button" className="wb-btn wb-btn--primary" onClick={onRun} disabled={busy || !value.trim()}>
        <Ic n={busy ? 'running' : 'sparkles'} size={14} className={busy ? 'wb-spin' : ''} />
        {busy ? t('editor.ai.thinking') : t('editor.ai.run')}
      </button>
      {reply && <div className="wb-ai__reply">{reply}</div>}
      {usage?.prompt_tokens != null && (() => {
        const used = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
        const win = usage.contextWindow || 1048576;
        const pct = used / win;
        // 1048576 → 1M、4194 → 4.1K：数字要一眼能读懂量级
        const kb = (n) => {
          if (n >= 1048576) return `${+(n / 1048576).toFixed(n % 1048576 ? 1 : 0)}M`;
          if (n >= 1024) return `${+(n / 1024).toFixed(n % 1024 ? 1 : 0)}K`;
          return String(n);
        };
        return (
          <div className={`wb-ai__usage${pct >= 0.8 ? ' is-warn' : ''}`}>
            {t('ai.usage', { used: kb(used), win: kb(win), pct: (pct * 100).toFixed(pct < 0.01 ? 2 : 1) })}
            {pct >= 0.8 ? ` · ${t('ai.usage.warn')}` : ''}
          </div>
        );
      })()}
      <div className="wb-group__title">{t('ai.examples')}</div>
      {examples.map((s) => (
        <button key={s} type="button" className="wb-ai__ex" onClick={() => onChange(s)} title={s}>{s}</button>
      ))}

      {/* 从 0 到 1 的剧本预设：点一下把整条结构化指令填进输入框，用户自己决定何时执行 */}
      <div className="wb-group__title">{t('ai.presets')}</div>
      <p className="wb-ai__hint">{t('ai.presetsHint')}</p>
      {PRESET_GROUPS.map((g) => {
        const items = presetsOf(g.id);
        if (!items.length) return null;
        const open = openGroup === g.id;
        return (
          <div className="wb-ai__group" key={g.id}>
            <button
              type="button"
              className={`wb-ai__grouphead${open ? ' is-on' : ''}`}
              onClick={() => setOpenGroup(open ? '' : g.id)}
              aria-expanded={open}
            >
              <Ic n={open ? 'chevronDown' : 'chevronRight'} size={13} />
              <span>{pickLang(g.title, lang)}</span>
              <em>{items.length}</em>
            </button>
            {open && items.map((p) => (
              <button
                key={p.id}
                type="button"
                className="wb-ai__ex wb-ai__ex--preset"
                onClick={() => onChange(pickLang(p.text, lang))}
                title={pickLang(p.text, lang)}
              >
                {pickLang(p.label, lang)}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function imageSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

/** 素材上传：比例越界本地就拦（上游 2013 的前置守卫） */
function AssetsField({ label, value, onChange }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // 放大预览的当前下标；null = 没开
  const [box, setBox] = useState(null);
  const list = value || [];

  async function handleFiles(files) {
    setErr('');
    setBusy(true);
    try {
      const added = [];
      for (const f of files) {
        let w; let h;
        if (f.type.startsWith('image/')) {
          const size = await imageSize(f);
          w = size.w; h = size.h;
          const ratio = w / h;
          if (ratio < PROVIDER.imageRatioMin || ratio > PROVIDER.imageRatioMax) {
            setErr(t('validate.ratio', { name: f.name }));
            continue;
          }
        }
        const dataBase64 = await fileToBase64(f);
        if (!dataBase64) continue;
        const saved = await api.uploadAsset({ name: f.name, mime: f.type, dataBase64 });
        // 记下 mime：缩略图靠它区分图片/视频/音频（老数据没有 mime，就退回落盘扩展名）
        added.push({ ...saved, w, h, mime: f.type || saved.mime || '' });
      }
      if (added.length) onChange([...list, ...added]);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wb-field">
      <span className="wb-field__label">{label}</span>
      <label className="wb-file">
        <input
          type="file"
          multiple
          disabled={busy}
          onChange={(e) => { handleFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
        />
        <Ic n="upload" size={14} />
        <span>{busy ? t('media.uploading') : t('media.pick')}</span>
      </label>
      {err && <div className="wb-field__err">{err}</div>}
      {!list.length && !busy && <div className="wb-field__hint">{t('empty.noAssets')}</div>}
      {list.map((a, i) => {
        // 只有图片能用 <img> 出画面；视频/音频给类型图标，别让 img 去加载 mp4（必然空白）
        const kind = assetKind(a);
        const file = a.asset || a.name;
        return (
          <div key={file} className="wb-asset">
            {/* 点缩略图放大：图片走缩放预览，视频/音频在同一个预览层里直接播 */}
            <button type="button" className="wb-asset__open" onClick={() => setBox(i)} title={t('asset.preview')}>
              {kind === 'image' ? (
                <img className="wb-asset__thumb" src={`/api/assets/${file}`} alt={a.name} loading="lazy" />
              ) : (
                <span className={`wb-asset__thumb wb-asset__thumb--icon${kind === 'audio' ? ' is-audio' : ''}`}>
                  <Ic n={kind === 'audio' ? 'audio' : 'film'} size={15} />
                </span>
              )}
            </button>
            <span className="wb-asset__name" title={a.name}>
              {a.name}
              {a.w ? <em className="wb-asset__dim">{a.w}×{a.h}</em> : null}
            </span>
            <button type="button" className="wb-asset__x" onClick={() => onChange(list.filter((_, j) => j !== i))} title={t('media.remove')}>
              <Ic n="close" size={12} />
            </button>
          </div>
        );
      })}
      {/* list 被删空时 box 可能越界，用 list[box] 兜一层 */}
      {box != null && list[box] ? (
        <AssetLightbox items={list} index={box} onIndexChange={setBox} onClose={() => setBox(null)} />
      ) : null}
    </div>
  );
}

/** 单字段：head 里留 action 插槽（放按钮），below 插槽（放结果面板） */
function Field({ def, value, onChange, action, below }) {
  const { t } = useI18n();
  const label = t(def.labelKey);
  const head = (
    <div className="wb-field__head">
      <span className="wb-field__label">{label}</span>
      {action || null}
    </div>
  );

  if (def.type === 'assets') return <AssetsField label={label} value={value} onChange={onChange} />;

  if (def.type === 'switch') {
    const on = Boolean(value);
    return (
      <div className="wb-field wb-field--row">
        <span className="wb-field__label">{label}</span>
        <button
          type="button"
          className={`wb-switch${on ? ' is-on' : ''}`}
          onClick={() => onChange(!on)}
          aria-pressed={on}
        >
          <span className="wb-switch__knob" />
        </button>
      </div>
    );
  }

  if (def.type === 'textarea') {
    return (
      <div className="wb-field">
        {head}
        <textarea
          className="wb-input"
          rows={8}
          value={value ?? ''}
          placeholder={def.placeholder || ''}
          onChange={(e) => onChange(e.target.value)}
        />
        {below || null}
      </div>
    );
  }

  if (def.type === 'number') {
    return (
      <div className="wb-field">
        {head}
        <input
          className="wb-input"
          type="number"
          min={def.min}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      </div>
    );
  }

  if (def.type === 'select') {
    return (
      <div className="wb-field">
        {head}
        <select className="wb-input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {(def.options || []).map((o) => {
            const v = typeof o === 'string' ? o : o.value;
            const l = typeof o === 'string' ? o : o.label;
            return <option key={v} value={v}>{isKey(l) ? t(l) : (l === '' ? t('opt.omit') : l)}</option>;
          })}
        </select>
      </div>
    );
  }

  return (
    <div className="wb-field">
      {head}
      <input
        className="wb-input"
        type="text"
        value={value ?? ''}
        placeholder={def.placeholder || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * AI 优化提示词：按钮挂在字段标签行，结果面板落在输入框下方。
 * 结果先预览，用户点「替换为优化版」才写回节点；失败原地报错，正文一个字都不动。
 * 做成 hook 是因为按钮和面板要渲染在两个不同的 DOM 位置，得共享同一份 state。
 */
function usePromptOptimize({ text, kind, resetKey, notify, onApply }) {
  const { t } = useI18n();
  const [state, setState] = useState({ busy: false, result: null, error: '' });

  // 换节点就清场，避免把上一个节点的优化结果显示在新节点上
  useEffect(() => { setState({ busy: false, result: null, error: '' }); }, [resetKey]);

  const close = () => setState({ busy: false, result: null, error: '' });

  const run = useCallback(async () => {
    if (!String(text || '').trim()) {
      setState({ busy: false, result: null, error: t('inspector.optimizeEmpty') });
      return;
    }
    setState({ busy: true, result: null, error: '' });
    try {
      const r = await api.optimizePrompt({ text, kind });
      setState({ busy: false, result: r, error: '' });
      notify?.({ kind: 'editor.optimized', level: 'success', body: r.note || kind });
    } catch (e) {
      setState({ busy: false, result: null, error: e.message });
    }
  }, [text, kind, t, notify]);

  const button = kind ? (
    <button
      type="button"
      className="wb-btn wb-btn--ghost wb-btn--xs"
      onClick={run}
      disabled={state.busy}
      title={t('inspector.optimizeHint')}
    >
      <Ic n={state.busy ? 'running' : 'optimize'} size={12} className={state.busy ? 'wb-spin' : ''} />
      {state.busy ? t('inspector.optimizing') : t('inspector.optimize')}
    </button>
  ) : null;

  let panel = null;
  if (state.error) {
    panel = <div className="wb-field__err">{state.error}</div>;
  } else if (state.result) {
    panel = (
      <div className="wb-opt__out">
        <div className="wb-opt__head">
          <span className="wb-opt__title"><Ic n="sparkles" size={13} /> {t('inspector.optimized')}</span>
          <button type="button" className="wb-opt__close" onClick={close} aria-label={t('common.close')}>
            <Ic n="close" size={12} />
          </button>
        </div>
        <pre className="wb-opt__text">{state.result.text}</pre>
        {state.result.note ? <div className="wb-opt__note">{t('inspector.optimizeNote')}：{state.result.note}</div> : null}
        <div className="wb-opt__actions">
          <button
            type="button"
            className="wb-btn wb-btn--primary wb-btn--xs"
            onClick={() => { onApply(state.result.text); close(); }}
          >
            <Ic n="check" size={12} /> {t('inspector.applyOptimized')}
          </button>
          <button type="button" className="wb-btn wb-btn--xs" onClick={close}>{t('inspector.discardOptimized')}</button>
        </div>
      </div>
    );
  }

  return { button, panel };
}

/** 可 AI 优化的文本节点 */
const OPTIMIZABLE = {
  'text.prompt': 'prompt',
  'text.negative': 'negative',
};

export function Inspector({ node, onPatch, onDelete, onDuplicate, onRun, runBusy, notify, dirty }) {
  const { t } = useI18n();
  const scrollRef = useRef(null);

  const kind = node ? OPTIMIZABLE[node.type] : undefined;
  const optimize = usePromptOptimize({
    text: node?.data?.text || '',
    kind,
    resetKey: node?.id,
    notify,
    onApply: (next) => onPatch({ text: next }),
  });

  // 换节点时滚回顶部，否则会停在上一节点的中间
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [node?.id]);

  if (!node) {
    // 未选中时不显示「参数」标题，只留一句提示，避免空面板看着像坏掉
    return (
      <aside className="wb-inspector wb-inspector--empty">
        <div className="wb-empty wb-empty--center">
          <Ic n="params" size={22} />
          <span>{t('editor.inspector.empty')}</span>
        </div>
      </aside>
    );
  }

  const def = NODE_DEFS[node.type] || { labelKey: node.type, fields: [] };

  return (
    <aside className="wb-inspector">
      <div className="wb-inspector__head">
        <span className="wb-node__dot" style={{ background: def.color }} />
        <strong className="wb-inspector__name">{t(def.labelKey)}</strong>
        <span className="wb-inspector__id" title={node.id}>{node.id}</span>
        <div className="wb-inspector__tools">
          <button type="button" className="wb-icon-btn wb-icon-btn--sm" onClick={onDuplicate} title={t('common.duplicate')}>
            <Ic n="duplicate" size={14} />
          </button>
          <button type="button" className="wb-icon-btn wb-icon-btn--sm wb-icon-btn--danger" onClick={onDelete} title={t('common.deleteNode')}>
            <Ic n="remove" size={14} />
          </button>
        </div>
      </div>

      <div className="wb-inspector__scroll" ref={scrollRef}>
        <NodeHelp type={node.type} />

        {node.type === 'param.video' && (
          <div className="wb-hint">
            {node.data?.resolution} · {PROVIDER.durationRange(node.data?.resolution).join('–')}s
          </div>
        )}

        {(!def.fields || def.fields.length === 0) && <div className="wb-empty wb-empty--soft">{t('inspector.noFields')}</div>}

        {(def.fields || []).map((f) => (
          <Field
            key={f.key}
            def={f}
            value={node.data?.[f.key]}
            onChange={(v) => onPatch({ [f.key]: v })}
            action={kind && f.key === 'text' ? optimize.button : null}
            below={kind && f.key === 'text' ? optimize.panel : null}
          />
        ))}
      </div>

      <div className="wb-inspector__foot">
        <button
          type="button"
          className="wb-btn wb-btn--primary wb-inspector__run"
          onClick={() => onRun?.(node.id, true)}
          disabled={runBusy || dirty}
          title={dirty ? t('inspector.runNeedGraph') : t('inspector.runSingleHint')}
        >
          <Ic n={runBusy ? 'running' : 'runSingle'} size={14} className={runBusy ? 'wb-spin' : ''} />
          {t('inspector.runSingle')}
        </button>
        <button
          type="button"
          className="wb-btn wb-inspector__run"
          onClick={() => onRun?.(node.id, false)}
          disabled={runBusy || dirty}
          title={dirty ? t('inspector.runNeedGraph') : t('inspector.runToHint')}
        >
          <Ic n="runTo" size={14} />
          {t('inspector.runTo')}
        </button>
      </div>
    </aside>
  );
}
