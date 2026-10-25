import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { Ic } from './Icons.jsx';

/** manifest 里的多语言字段：{zh,en} 或纯字符串 */
const pick = (field, lang) => {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  return field[lang] || field.zh || field.en || '';
};

/** 没有封面图时按 id 生成固定色相，让卡片彼此区分（零体积） */
const hueOf = (s) => {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};

/**
 * 从内置模板新建画布。
 *
 * 两步在同一弹窗里：先选模板（卡片网格），选中后下方展开参数表单。
 * 模板的 params 是可选声明——没有就退化成「一键创建」，不弹表单。
 */
export default function TemplatePicker({ onClose, onCreated }) {
  const { t, lang } = useI18n();
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  const [pickedId, setPickedId] = useState('');
  const [values, setValues] = useState({});
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.templates()
      .then((r) => setItems(r.items || []))
      .catch((e) => { setErr(e.message); setItems([]); });
  }, []);

  const picked = (items || []).find((x) => x.id === pickedId) || null;

  function select(item) {
    setPickedId(item.id);
    setName('');
    setErr('');
    const init = {};
    for (const p of item.params || []) {
      init[p.key] = p.default ?? (p.type === 'select' ? (p.options || [])[0] : '');
    }
    setValues(init);
  }

  async function create() {
    if (!picked || busy) return;
    setBusy(true);
    setErr('');
    try {
      const res = await api.useTemplate(picked.id, {
        name: name.trim() || undefined,
        values,
      });
      onCreated(res.id, res);
    } catch (e) {
      const code = e.code || 'badTemplate';
      setErr(t(`tpl.err.${code}`) === `tpl.err.${code}` ? e.message : t(`tpl.err.${code}`));
    } finally {
      setBusy(false);
    }
  }

  const missingRequired = (picked?.params || []).some((p) => p.required && !String(values[p.key] ?? '').trim());

  return (
    <div className="wb-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wb-modal wb-modal--wide" role="dialog" aria-modal="true">
        <div className="wb-modal__head">
          <strong>{t('tpl.title')}</strong>
          <button type="button" className="wb-icon-btn" onClick={onClose}>×</button>
        </div>

        <div className="wb-modal__body">
          {items === null && <div className="wb-empty">{t('common.loading')}</div>}
          {items && !items.length && <div className="wb-empty">{t('tpl.empty')}</div>}

          {items && items.length > 0 && (
            <div className="wb-tpl-grid">
              {items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className={`wb-tpl-card${it.id === pickedId ? ' is-on' : ''}`}
                  onClick={() => select(it)}
                >
                  <div
                    className="wb-tpl-card__cover"
                    style={it.cover ? undefined : {
                      background: "linear-gradient(135deg, hsl(calc(var(--h) * 1deg) 34% 24%), hsl(calc((var(--h) + 46) * 1deg) 30% 14%))",
                      ['--h']: String(hueOf(it.id)),
                    }}
                  >
                    {it.cover
                      ? <img src={it.cover} alt="" loading="lazy" />
                      : <Ic n="layers" size={22} />}
                  </div>
                  <div className="wb-tpl-card__title">{pick(it.name, lang)}</div>
                  <div className="wb-tpl-card__desc">{pick(it.description, lang)}</div>
                  <div className="wb-tpl-card__meta">
                    <span>{t('tpl.nodes', { n: it.nodeCount })}</span>
                    {it.hasAssets && <span className="wb-tpl-card__dot">{t('tpl.hasAssets')}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {picked && (
            <div className="wb-tpl-detail">
              <div className="wb-tpl-detail__head">
                <strong>{pick(picked.name, lang)}</strong>
                {picked.estimate?.costHint && (
                  <span className="wb-muted">{t('tpl.estimate', { hint: pick(picked.estimate.costHint, lang) })}</span>
                )}
              </div>

              {(picked.requires || []).length > 0 && (
                <div className="wb-tpl-warn">
                  <Ic n="warn" size={14} />
                  <div>
                    {(picked.requires || []).map((r) => (
                      <div key={r.nodeId}>
                        <strong>{pick(r.label, lang)}</strong>
                        {pick(r.why, lang) ? `：${pick(r.why, lang)}` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(picked.params || []).length > 0 && (
                <div className="wb-tpl-form">
                  {(picked.params || []).map((p) => (
                    <label className="wb-field" key={p.key}>
                      <span className="wb-field__label">
                        {pick(p.label, lang)}{p.required ? ' *' : ''}
                      </span>
                      {p.type === 'textarea' && (
                        <textarea
                          className="wb-input wb-input--area"
                          rows={3}
                          value={values[p.key] ?? ''}
                          placeholder={pick(p.placeholder, lang)}
                          onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                        />
                      )}
                      {p.type === 'number' && (
                        <input
                          className="wb-input"
                          type="number"
                          min={p.min}
                          max={p.max}
                          value={values[p.key] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                        />
                      )}
                      {p.type === 'select' && (
                        <select
                          className="wb-input"
                          value={values[p.key] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                        >
                          {(p.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                      {p.type === 'switch' && (
                        <input
                          type="checkbox"
                          checked={Boolean(values[p.key])}
                          onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.checked }))}
                        />
                      )}
                    </label>
                  ))}
                </div>
              )}

              <label className="wb-field">
                <span className="wb-field__label">{t('tpl.name')}</span>
                <input
                  className="wb-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={pick(picked.name, lang)}
                />
              </label>
            </div>
          )}

          {err && <div className="wb-error">{err}</div>}
        </div>

        <div className="wb-modal__foot">
          <span className="wb-modal__note">{picked ? t('tpl.pickedHint') : t('tpl.pickHint')}</span>
          <button type="button" className="wb-btn" onClick={onClose}>{t('common.cancel')}</button>
          <button
            type="button"
            className="wb-btn wb-btn--primary"
            onClick={create}
            disabled={!picked || busy || missingRequired}
            title={missingRequired ? t('tpl.needRequired') : undefined}
          >
            {busy ? t('common.loading') : t('tpl.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
