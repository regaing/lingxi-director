import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { go } from '../router.js';
import SettingsModal from '../components/SettingsModal.jsx';
import NotificationCenter from '../components/NotificationCenter.jsx';
import { LogoMark } from '../components/Logo.jsx';
import { Ic } from '../components/Icons.jsx';
import { fetchExportZip, saveBlob, safeFileName, importZip, isZip } from '../bundle.js';

function fmt(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 分类配色：跟节点色系同源，避免跳出视觉体系 */
const CAT_COLORS = ['#7c6cf0', '#3f8fe0', '#2f9e8f', '#d99b3c', '#e0503f', '#c264c9', '#5b8def', '#3fa96b'];

/** 「全部 / 未分类 / 具体分类」的选中态：undefined=全部，null=未分类，字符串=分类 id */
const isAll = (v) => v === undefined;

export default function Home() {
  const { t, toggle } = useI18n();
  const [items, setItems] = useState(null);
  const [cats, setCats] = useState({ items: [], total: 0 });
  const [activeCat, setActiveCat] = useState(undefined);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [menuId, setMenuId] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);   // { id, name } 重命名工作流弹窗
  const [deleteTarget, setDeleteTarget] = useState(null);   // 工作流对象：删除确认弹窗
  const [editor, setEditor] = useState(null);   // { id?, name, color } 新建/重命名分类
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [ioBusy, setIoBusy] = useState(false);      // 导入 / 导出进行中
  const [note, setNote] = useState('');             // 成功类提示，与 err 分开
  const fileRef = useRef(null);
  const [dragCat, setDragCat] = useState(null);
  const rootRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [wfRes, catRes] = await Promise.all([api.workflows(activeCat), api.categories()]);
      setItems(wfRes.items || []);
      setCats({ items: catRes.items || [], total: catRes.total || 0 });
      setErr('');
    } catch (e) {
      setErr(e.message);
      setItems([]);
    }
  }, [activeCat]);

  useEffect(() => { load(); }, [load]);

  // 点空白处收起卡片菜单 / 移动菜单
  useEffect(() => {
    if (!menuId && !moveOpen) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) { setMenuId(null); setMoveOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuId, moveOpen]);

  async function create() {
    setBusy(true);
    try {
      const wf = await api.createWorkflow(t('home.newName'), typeof activeCat === 'string' ? activeCat : null);
      go(`#/wf/${wf.id}`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  /** 重命名：不用 window.prompt —— 桌面壳（Electron / webview）里 prompt 不弹窗也不返回，点了就像没反应 */
  function rename(it) {
    setMenuId(null);
    setRenameTarget({ id: it.id, name: it.name || it.id });
  }

  async function saveRename() {
    const target = renameTarget;
    if (!target) return;
    try {
      const saved = await api.saveWorkflow(target.id, { name: target.name.trim() || target.id }, null);
      setItems((list) => (list || []).map((x) => (x.id === target.id ? { ...x, name: saved.name } : x)));
      setRenameTarget(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function duplicate(it) {
    try {
      await api.duplicateWorkflow(it.id);
      setMenuId(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  /** 删除改成自定义确认弹窗，不再用浏览器 confirm */
  function remove(it) {
    setMenuId(null);
    setDeleteTarget(it);
  }

  /* ── 导入 / 导出（.zip）：素材是包里的真文件，导入一律新建副本 ── */
  async function exportOne(it) {
    setMenuId(null);
    if (ioBusy) return;
    setIoBusy(true); setErr(''); setNote('');
    try {
      const blob = await fetchExportZip(it.id);
      saveBlob(blob, `${safeFileName(it.name || it.id)}.zip`);
      setNote(t('home.exportDone', { name: it.name || it.id }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setIoBusy(false);
    }
  }

  async function exportAll() {
    if (ioBusy) return;
    setIoBusy(true); setErr(''); setNote('');
    try {
      const n = ((await api.workflows()).items || []).length;
      const blob = await fetchExportZip();
      saveBlob(blob, `lingxi-workflows-${new Date().toISOString().slice(0, 10)}.zip`);
      setNote(t('home.exportAllDone', { n }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setIoBusy(false);
    }
  }

  /** 导入：只收 .zip；服务端解包 → 素材落盘换个新名字 → 每个工作流都新建副本 */
  async function onFiles(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';              // 允许同一个文件再导一次
    if (!files.length || ioBusy) return;
    setIoBusy(true); setErr(''); setNote('');
    let total = 0;
    let missing = 0;
    try {
      for (const f of files) {
        if (!isZip(f)) {
          setErr(t('bundle.err.notZip', { name: f.name }));
          continue;
        }
        try {
          const res = await importZip(f);
          total += (res.created || []).length;
          missing += (res.missingAssets || []).length;
        } catch (err) {
          setErr(t(`bundle.err.${err.code || 'badZip'}`));
        }
      }
      if (total) {
        setNote(t('home.importDone', { n: total }) + (missing ? t('home.importMissing', { n: missing }) : ''));
        await load();
      }
    } finally {
      setIoBusy(false);
    }
  }

  async function doRemove() {
    const target = deleteTarget;
    if (!target) return;
    try {
      await api.deleteWorkflow(target.id);
      setDeleteTarget(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function saveCategory() {
    const name = String(editor?.name || '').trim();
    if (!name) { setErr(t('home.category.needName')); return; }
    try {
      if (editor.id) await api.updateCategory(editor.id, { name, color: editor.color });
      else await api.createCategory({ name, color: editor.color });
      setEditor(null);
      setErr('');
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function removeCategory(cat) {
    if (!window.confirm(t('home.category.deleteConfirm', { name: cat.name, n: cat.count }))) return;
    try {
      await api.removeCategory(cat.id);
      if (activeCat === cat.id) setActiveCat(undefined);
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  /** 分类拖拽排序：本地先动，再落库 */
  async function dropCat(target) {
    if (!dragCat || dragCat === target) { setDragCat(null); return; }
    const list = [...cats.items];
    const from = list.findIndex((c) => c.id === dragCat);
    const to = list.findIndex((c) => c.id === target);
    if (from < 0 || to < 0) { setDragCat(null); return; }
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    setCats((c) => ({ ...c, items: list }));
    setDragCat(null);
    try {
      await api.reorderCategories(list.map((c) => c.id));
    } catch (e) {
      setErr(e.message);
      load();
    }
  }

  async function movePicked(categoryId) {
    const ids = [...picked];
    if (!ids.length) return;
    try {
      const r = await api.moveWorkflows(ids, categoryId);
      setMoveOpen(false);
      setPicked(new Set());
      setSelectMode(false);
      setErr(t('home.category.moveDone', { n: r.moved ?? ids.length }));
      setTimeout(() => setErr(''), 2400);
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return items || [];
    return (items || []).filter((it) => String(it.name || '').toLowerCase().includes(kw) || String(it.id).includes(kw));
  }, [items, q]);

  const catName = (id) => cats.items.find((c) => c.id === id)?.name || '';
  const catColor = (id) => cats.items.find((c) => c.id === id)?.color || 'var(--line-strong)';
  const totalCount = cats.total ?? 0;
  // 后端只给分类内计数，未分类 = 总数 - 各分类之和
  const uncatCount = Math.max(0, totalCount - cats.items.reduce((s, c) => s + (c.count || 0), 0));

  function togglePick(id) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="wb-home" ref={rootRef}>
      <header className="wb-home__bar">
        <button type="button" className="wb-brand" onClick={() => { setActiveCat(undefined); setQ(''); }} title={t('nav.home')}>
          <LogoMark size={30} />
          <span className="wb-brand__text">
            <span className="wb-brand__name">{t('app.name')}</span>
            <span className="wb-brand__sub">{t('app.tagline')}</span>
          </span>
        </button>

        <div className="wb-home__bar-right">
          <div className="wb-sidebar__searchbar wb-home__search">
            <Ic n="search" size={14} className="wb-searchbar__icon" />
            <input className="wb-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('home.search')} />
          </div>
          <NotificationCenter onOpenWorkflow={(wfId) => go(`#/wf/${encodeURIComponent(wfId)}`)} />
          <button type="button" className="wb-icon-btn" onClick={toggle} title={t('nav.lang')} aria-label={t('nav.lang')}>
            <Ic n="lang" size={17} />
          </button>
          <button type="button" className="wb-icon-btn" onClick={() => setShowSettings(true)} title={t('editor.settings')} aria-label={t('editor.settings')}>
            <Ic n="settings" size={17} />
          </button>
        </div>
      </header>

      <div className="wb-home__layout">
        {/* ── 分类侧栏：一部剧一个分类 ── */}
        <aside className="wb-cats">
          <div className="wb-cats__head">
            <span>{t('home.categories')}</span>
            <button type="button" className="wb-icon-btn wb-icon-btn--sm" title={t('home.category.new')} onClick={() => setEditor({ name: '', color: CAT_COLORS[cats.items.length % CAT_COLORS.length] })}>
              <Ic n="categoryNew" size={15} />
            </button>
          </div>

          <button type="button" className={`wb-cats__item${isAll(activeCat) ? ' is-on' : ''}`} onClick={() => setActiveCat(undefined)}>
            <Ic n="layers" size={14} />
            <span className="wb-cats__name">{t('common.all')}</span>
            <span className="wb-cats__count">{totalCount}</span>
          </button>

          <button type="button" className={`wb-cats__item${activeCat === null ? ' is-on' : ''}`} onClick={() => setActiveCat(null)}>
            <Ic n="inbox" size={14} />
            <span className="wb-cats__name">{t('home.uncategorized')}</span>
            <span className="wb-cats__count">{uncatCount}</span>
          </button>

          <div className="wb-cats__list">
            {cats.items.map((c) => (
              <div
                key={c.id}
                className={`wb-cats__item wb-cats__item--cat${activeCat === c.id ? ' is-on' : ''}${dragCat === c.id ? ' is-dragging' : ''}`}
                draggable
                onDragStart={() => setDragCat(c.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropCat(c.id)}
                onDragEnd={() => setDragCat(null)}
                onClick={() => setActiveCat(c.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') setActiveCat(c.id); }}
                title={t('home.category.dragHint')}
              >
                <span className="wb-cats__dot" style={{ background: c.color }} />
                <span className="wb-cats__name">{c.name}</span>
                <span className="wb-cats__count">{c.count}</span>
                <span className="wb-cats__ops">
                  <button type="button" className="wb-icon-btn wb-icon-btn--xs" title={t('home.category.rename')}
                    onClick={(e) => { e.stopPropagation(); setEditor({ id: c.id, name: c.name, color: c.color }); }}>
                    <Ic n="rename" size={12} />
                  </button>
                  <button type="button" className="wb-icon-btn wb-icon-btn--xs wb-icon-btn--danger" title={t('home.category.delete')}
                    onClick={(e) => { e.stopPropagation(); removeCategory(c); }}>
                    <Ic n="remove" size={12} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </aside>

        {/* ── 工作流区 ── */}
        <main className="wb-home__main">
          <div className="wb-home__toolbar">
            <div className="wb-home__heading">
              <h1>{isAll(activeCat) ? t('home.title') : activeCat === null ? t('home.uncategorized') : catName(activeCat)}</h1>
              <span className="wb-home__muted">{t('home.category.count', { n: shown.length })}</span>
            </div>
            <div className="wb-home__actions">
              {selectMode ? (
                <>
                  <span className="wb-home__muted">{t('home.category.selected', { n: picked.size })}</span>
                  <div className="wb-menu-wrap">
                    <button type="button" className="wb-btn" onClick={() => setMoveOpen((v) => !v)} disabled={!picked.size}>
                      <Ic n="move" size={14} /> {t('home.category.move')}
                      <Ic n="chevronDown" size={13} />
                    </button>
                    {moveOpen && (
                      <div className="wb-menu">
                        <button type="button" className="wb-menu__item" onClick={() => movePicked(null)}>
                          <span className="wb-cats__dot" style={{ background: 'var(--line-strong)' }} />
                          {t('home.uncategorized')}
                        </button>
                        {cats.items.map((c) => (
                          <button key={c.id} type="button" className="wb-menu__item" onClick={() => movePicked(c.id)}>
                            <span className="wb-cats__dot" style={{ background: c.color }} />
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="button" className="wb-btn" onClick={() => { setSelectMode(false); setPicked(new Set()); }}>{t('common.cancel')}</button>
                </>
              ) : (
                <>
                  <button type="button" className="wb-btn" onClick={() => fileRef.current?.click()} disabled={ioBusy}>
                    <Ic n="upload" size={14} /> {t('home.import')}
                  </button>
                  <button type="button" className="wb-btn" onClick={exportAll} disabled={ioBusy || !(items || []).length}>
                    <Ic n="download" size={14} /> {t('home.exportAll')}
                  </button>
                  <input ref={fileRef} type="file" accept=".zip,application/zip" multiple hidden onChange={onFiles} />
                  <button type="button" className="wb-btn" onClick={() => setSelectMode(true)} disabled={!shown.length}>
                    <Ic n="check" size={14} /> {t('home.category.select')}
                  </button>
                  <button type="button" className="wb-btn wb-btn--primary" onClick={create} disabled={busy}>
                    <Ic n="add" size={15} /> {t('home.new')}
                  </button>
                </>
              )}
            </div>
          </div>

          {err && <div className="wb-error">{err}</div>}
          {note && <div className="wb-home__note">{note}</div>}

          {items === null && <div className="wb-empty">{t('common.loading')}</div>}
          {items !== null && shown.length === 0 && (
            <div className="wb-empty wb-empty--big">
              <Ic n="empty" size={26} />
              <span>{q ? t('home.emptySearch') : isAll(activeCat) ? t('home.empty') : t('home.category.empty')}</span>
            </div>
          )}

          <div className="wb-grid">
            {shown.map((it) => (
              <article
                key={it.id}
                className={`wb-card${picked.has(it.id) ? ' is-picked' : ''}`}
                onClick={() => (selectMode ? togglePick(it.id) : go(`#/wf/${it.id}`))}
              >
                <div className="wb-card__thumb" style={{ '--card-accent': it.categoryId ? catColor(it.categoryId) : 'var(--accent)' }}>
                  <span className="wb-card__nodes">
                    <Ic n="layers" size={14} /> {it.nodes}
                  </span>
                  <span className="wb-card__edges">{t('home.flows', { n: it.edges })}</span>
                  {selectMode && (
                    <span className={`wb-card__check${picked.has(it.id) ? ' is-on' : ''}`}>
                      {picked.has(it.id) ? <Ic n="check" size={13} /> : null}
                    </span>
                  )}
                </div>
                <div className="wb-card__body">
                  <h3 title={it.name}>{it.name || it.id}</h3>
                  <div className="wb-card__meta">
                    {it.categoryId ? (
                      <span className="wb-tag"><span className="wb-tag__dot" style={{ background: catColor(it.categoryId) }} />{catName(it.categoryId)}</span>
                    ) : null}
                    <span>{t('home.updated', { t: fmt(it.updatedAt) })}</span>
                  </div>
                </div>

                {!selectMode && (
                  <div className="wb-card__ops" onClick={(e) => e.stopPropagation()}>
                    <div className="wb-menu-wrap">
                      <button type="button" className="wb-icon-btn wb-icon-btn--sm" title={t('home.card.menu')} onClick={() => setMenuId((v) => (v === it.id ? null : it.id))}>
                        <Ic n="more" size={15} />
                      </button>
                      {menuId === it.id && (
                        <div className="wb-menu wb-menu--right">
                          <button type="button" className="wb-menu__item" onClick={() => rename(it)}>
                            <Ic n="rename" size={13} /> {t('common.rename')}
                          </button>
                          <button type="button" className="wb-menu__item" onClick={() => duplicate(it)}>
                            <Ic n="duplicate" size={13} /> {t('common.duplicate')}
                          </button>
                          <button type="button" className="wb-menu__item" onClick={() => exportOne(it)}>
                            <Ic n="download" size={13} /> {t('home.export')}
                          </button>
                          <div className="wb-menu__sep" />
                          <button type="button" className="wb-menu__item wb-menu__item--danger" onClick={() => remove(it)}>
                            <Ic n="remove" size={13} /> {t('common.delete')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </main>
      </div>

      {/* 新建 / 改名分类 */}
      {editor && (
        <div className="wb-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditor(null); }}>
          <div className="wb-modal wb-modal--sm" role="dialog" aria-modal="true">
            <div className="wb-modal__head">
              <strong>{editor.id ? t('home.category.rename') : t('home.category.new')}</strong>
              <button type="button" className="wb-icon-btn wb-icon-btn--sm" onClick={() => setEditor(null)} aria-label={t('common.close')}>
                <Ic n="close" size={14} />
              </button>
            </div>
            <div className="wb-modal__body">
              <label className="wb-field">
                <span className="wb-field__label">{t('home.category.name')}</span>
                <input
                  className="wb-input"
                  autoFocus
                  value={editor.name}
                  placeholder={t('home.category.namePlaceholder')}
                  onChange={(e) => setEditor((v) => ({ ...v, name: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveCategory(); }}
                />
              </label>
              <div className="wb-field">
                <span className="wb-field__label">{t('home.category.color')}</span>
                <div className="wb-swatches">
                  {CAT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`wb-swatch${editor.color === c ? ' is-on' : ''}`}
                      style={{ background: c }}
                      onClick={() => setEditor((v) => ({ ...v, color: c }))}
                      aria-label={c}
                    >
                      {editor.color === c ? <Ic n="check" size={12} /> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="wb-modal__foot">
              <button type="button" className="wb-btn" onClick={() => setEditor(null)}>{t('common.cancel')}</button>
              <button type="button" className="wb-btn wb-btn--primary" onClick={saveCategory}>{t('common.save')}</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {/* 重命名工作流（替代 window.prompt：桌面壳里 prompt 不弹，点了没反应） */}
      {renameTarget && (
        <div className="wb-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) setRenameTarget(null); }}>
          <div className="wb-modal wb-modal--sm" role="dialog" aria-modal="true">
            <div className="wb-modal__head">
              <strong>{t('home.renameTitle')}</strong>
              <button type="button" className="wb-icon-btn wb-icon-btn--sm" onClick={() => setRenameTarget(null)} aria-label={t('common.close')}>
                <Ic n="close" size={14} />
              </button>
            </div>
            <div className="wb-modal__body">
              <label className="wb-field">
                <span className="wb-field__label">{t('home.name')}</span>
                <input
                  className="wb-input"
                  autoFocus
                  value={renameTarget.name}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setRenameTarget((v) => ({ ...v, name: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenameTarget(null); }}
                />
              </label>
            </div>
            <div className="wb-modal__foot">
              <button type="button" className="wb-btn" onClick={() => setRenameTarget(null)}>{t('common.cancel')}</button>
              <button type="button" className="wb-btn wb-btn--primary" onClick={saveRename}>{t('common.save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* 删除工作流：自定义确认弹窗，替代浏览器 confirm */}
      {deleteTarget && (
        <div className="wb-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
          <div className="wb-modal wb-modal--sm" role="dialog" aria-modal="true">
            <div className="wb-modal__head">
              <strong>{t('home.deleteTitle')}</strong>
              <button type="button" className="wb-icon-btn wb-icon-btn--sm" onClick={() => setDeleteTarget(null)} aria-label={t('common.close')}>
                <Ic n="close" size={14} />
              </button>
            </div>
            <div className="wb-modal__body">
              <p className="wb-modal__text">{t('home.deleteConfirm', { name: deleteTarget.name || deleteTarget.id })}</p>
            </div>
            <div className="wb-modal__foot">
              <button type="button" className="wb-btn" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button>
              <button type="button" className="wb-btn wb-btn--danger" onClick={doRemove}>{t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

