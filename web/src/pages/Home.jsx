import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { go } from '../router.js';
import SettingsModal from '../components/SettingsModal.jsx';
import NotificationCenter from '../components/NotificationCenter.jsx';
import { LogoMark } from '../components/Logo.jsx';
import { Ic } from '../components/Icons.jsx';
import { fetchExportZip, saveBlob, safeFileName, importZip, isZip } from '../bundle.js';
import TemplatePicker from '../components/TemplatePicker.jsx';

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

/** 侧栏落点标记：全部 / 未分类 用伪 id，真实分类直接用分类 id（写进 data-cat） */
const DROP_ALL = '__all__';
const DROP_NONE = '__none__';
const SCROLL_EDGE = 40;   // 距侧栏顶/底多少像素开始自动滚
const SCROLL_STEP = 9;    // 每帧滚多少（~60fps 下约 540px/s）
const FADE_MS = 160;      // 落点淡出时长，与 CSS 的 .16s 对齐

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
  const [showTemplates, setShowTemplates] = useState(false);   // 从模板新建
  const [note, setNote] = useState('');             // 成功类提示，与 err 分开
  const fileRef = useRef(null);
  const [dragCat, setDragCat] = useState(null);
  const rootRef = useRef(null);

  /* ── 拖拽工作流到分类：与上面「分类排序」的 dragCat 互斥，同一时刻只有一个有值 ── */
  const [dragWf, setDragWf] = useState(null);         // { ids } 正在拖的工作流；null = 没在拖
  const [dropHit, setDropHit] = useState(undefined);  // 落点：undefined=无 / null=未分类 / 'cid'=分类
  const [menuStage, setMenuStage] = useState('main'); // 卡片菜单层级：'main' | 'move'
  const [leaving, setLeaving] = useState(() => new Set()); // 已移走、正在淡出的卡片 id
  const noClickRef = useRef(false);                   // 拖动刚结束时忽略 click，防误进画布
  const ghostRef = useRef(null);                      // 自定义拖影节点，dragEnd 时移除
  const scrollRef = useRef({ y: 0, raf: 0 });         // 侧栏自动滚动：光标 Y + rAF 句柄

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
      if (rootRef.current && !rootRef.current.contains(e.target)) { setMenuId(null); setMenuStage('main'); setMoveOpen(false); }
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

  /* ── 拖拽工作流到分类（⇢ 与上面的分类排序是两套互斥的拖拽） ── */

  // 卸载时收尾：不留 rAF 空转、不留拖影节点
  useEffect(() => () => {
    stopAutoScroll();
    ghostRef.current?.remove();
    ghostRef.current = null;
  }, []);

  /** 拖影节点：必须已挂进文档并渲染（CSS 把它挪到屏幕外），setDragImage 才拍得到 */
  function makeDragGhost(name, count) {
    const el = document.createElement('div');
    el.className = 'wb-drag-ghost';
    el.textContent = t('home.category.dragGhost', { name, n: count });
    document.body.appendChild(el);
    return el;
  }

  /** 落点：undefined=空白/无落点 · 'all'=「全部」拒收 · null=未分类 · 字符串=分类 id */
  function hitCat(e) {
    const el = e.target?.closest?.('[data-cat]');
    if (!el) return undefined;
    const raw = el.dataset.cat;
    if (raw === DROP_ALL) return 'all';
    return raw === DROP_NONE ? null : raw;
  }

  function onCardDragStart(e, it) {
    // 多选里拖一张 = 整批；拖未选中的卡片 = 只移它自己
    const ids = picked.has(it.id) && picked.size ? [...picked] : [it.id];
    setDragWf({ ids });
    setMenuId(null);
    setMenuStage('main');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', it.name || it.id);  // Firefox 不在 dragstart 写数据就不启动拖拽
    if (ids.length > 1) {
      const ghost = makeDragGhost(it.name || it.id, ids.length);  // 原生快照只有一张，看不出拖的是一批
      e.dataTransfer.setDragImage(ghost, 18, 18);
      ghostRef.current = ghost;
    }
    noClickRef.current = true;
  }

  function onCardDragEnd() {
    setDragWf(null);
    setDropHit(undefined);
    stopAutoScroll();
    ghostRef.current?.remove();
    ghostRef.current = null;
    setTimeout(() => { noClickRef.current = false; }, 0);
  }

  /** dragover 在指针不动时只按 ~350ms 重发，靠它驱动滚动会一顿一顿，所以用 rAF 自己跑 */
  function startAutoScroll(el) {
    if (scrollRef.current.raf) return;
    const tick = () => {
      const { y } = scrollRef.current;
      if (y) {
        const r = el.getBoundingClientRect();
        if (y - r.top < SCROLL_EDGE) el.scrollTop -= SCROLL_STEP;
        else if (r.bottom - y < SCROLL_EDGE) el.scrollTop += SCROLL_STEP;
      }
      scrollRef.current.raf = requestAnimationFrame(tick);
    };
    scrollRef.current.raf = requestAnimationFrame(tick);
  }

  function stopAutoScroll() {
    if (scrollRef.current.raf) cancelAnimationFrame(scrollRef.current.raf);
    scrollRef.current.raf = 0;
    scrollRef.current.y = 0;
  }

  /** 侧栏是唯一投放区：靠 data-cat 认人，避免每个分类项各挂一套 handler（子元素会让高亮闪） */
  function onSideDragOver(e) {
    if (!dragWf) return;                        // 拖分类排序时走分类项自己的逻辑
    scrollRef.current.y = e.clientY;
    startAutoScroll(e.currentTarget);
    const hit = hitCat(e);
    if (hit === undefined || hit === 'all') {   // 空白 /「全部」：不 preventDefault → 光标显示禁止符
      e.dataTransfer.dropEffect = 'none';
      if (dropHit !== undefined) setDropHit(undefined);
      return;
    }
    e.preventDefault();                         // 只有 preventDefault 过，drop 才会触发
    e.dataTransfer.dropEffect = 'move';
    if (dropHit !== hit) setDropHit(hit);       // 逐帧重算，同 id 不触发 setState → 不闪
  }

  function onSideDragLeave(e) {
    if (!dragWf) return;
    if (e.currentTarget.contains(e.relatedTarget)) return;   // 还在侧栏内部（进出子元素）
    stopAutoScroll();
    setDropHit(undefined);
  }

  function onSideDrop(e) {
    if (!dragWf) return;                        // 分类排序的 drop 交给分类项
    e.preventDefault();
    e.stopPropagation();
    const hit = hitCat(e);
    const ids = dragWf.ids;
    setDragWf(null);
    setDropHit(undefined);
    stopAutoScroll();
    if (hit === undefined || hit === 'all') return;
    moveIdsTo(ids, hit);
  }

  /** 改归属的唯一实现：已在目标分类的跳过，其余一次性批量提交 */
  async function moveIdsTo(ids, categoryId) {
    const cur = (id) => {
      const it = (items || []).find((x) => x.id === id);
      return it ? (it.categoryId ?? null) : undefined;
    };
    const todo = (ids || []).filter((id) => cur(id) !== (categoryId ?? null));
    if (!todo.length) return;                   // 原地松手：静默，不发请求不弹提示
    try {
      const r = await api.moveWorkflows(todo, categoryId);
      const n = r.moved ?? todo.length;
      setPicked(new Set());
      setNote(categoryId
        ? t('home.category.dragDone', { n, name: catName(categoryId) })
        : t('home.category.dragDoneUncat', { n }));
      setTimeout(() => setNote(''), 2600);
      // 卡片会从当前视图消失时先淡出，否则瞬消看着像误操作
      const staysVisible = isAll(activeCat) || (activeCat ?? null) === (categoryId ?? null);
      if (!staysVisible) {
        setLeaving(new Set(todo));
        await new Promise((done) => setTimeout(done, FADE_MS));
      }
      await load();
      setLeaving(new Set());
    } catch (e) {
      setErr(e.message);
      setLeaving(new Set());
    }
  }

  /** 卡片菜单里的「移动到分类」 */
  function moveOne(it, categoryId) {
    setMenuId(null);
    setMenuStage('main');
    moveIdsTo([it.id], categoryId);
  }

  async function movePicked(categoryId) {
    const ids = [...picked];
    if (!ids.length) return;
    setMoveOpen(false);
    setSelectMode(false);
    await moveIdsTo(ids, categoryId);
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

  // 根节点兜底：卡片拖到页面空白处松手时吞掉默认行为，否则个别引擎会去导航/搜索拖出的 text/plain
  return (
    <div
      className="wb-home"
      ref={rootRef}
      onDragOver={(e) => { if (dragWf) e.preventDefault(); }}
      onDrop={(e) => {
        if (!dragWf) return;
        e.preventDefault();
        setDragWf(null);
        setDropHit(undefined);
        stopAutoScroll();
      }}
    >
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
        <aside
          className="wb-cats"
          onDragOver={onSideDragOver}
          onDragLeave={onSideDragLeave}
          onDrop={onSideDrop}
        >
          <div className="wb-cats__head">
            <span>{dragWf ? t('home.category.dragTo') : t('home.categories')}</span>
            <button type="button" className="wb-icon-btn wb-icon-btn--sm" title={t('home.category.new')} onClick={() => setEditor({ name: '', color: CAT_COLORS[cats.items.length % CAT_COLORS.length] })}>
              <Ic n="categoryNew" size={15} />
            </button>
          </div>

          {/* 「全部」是纯过滤器，不接受拖放（不给 preventDefault → 光标显示禁止符） */}
          <button type="button" data-cat={DROP_ALL} className={`wb-cats__item${isAll(activeCat) ? ' is-on' : ''}`} onClick={() => setActiveCat(undefined)}>
            <Ic n="layers" size={14} />
            <span className="wb-cats__name">{t('common.all')}</span>
            <span className="wb-cats__count">{totalCount}</span>
          </button>

          <button type="button" data-cat={DROP_NONE} className={`wb-cats__item${activeCat === null ? ' is-on' : ''}${dragWf && dropHit === null ? ' is-drop' : ''}`} onClick={() => setActiveCat(null)}>
            <Ic n="inbox" size={14} />
            <span className="wb-cats__name">{t('home.uncategorized')}</span>
            <span className="wb-cats__count">{uncatCount}</span>
          </button>

          <div className="wb-cats__list">
            {cats.items.map((c) => (
              <div
                key={c.id}
                data-cat={c.id}
                className={`wb-cats__item wb-cats__item--cat${activeCat === c.id ? ' is-on' : ''}${dragCat === c.id ? ' is-dragging' : ''}${dragWf && dropHit === c.id ? ' is-drop' : ''}`}
                draggable
                onDragStart={() => setDragCat(c.id)}
                onDragOver={(e) => { if (!dragWf) e.preventDefault(); }}   // 排序需要；拖工作流由侧栏统一处理
                onDrop={(e) => { if (dragWf) return; e.preventDefault(); e.stopPropagation(); dropCat(c.id); }}
                onDragEnd={() => { setDragCat(null); setDropHit(undefined); }}
                onClick={() => setActiveCat(c.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') setActiveCat(c.id); }}
                title={dragWf ? t('home.category.dragTo') : t('home.category.dragHint')}
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
                  <button type="button" className="wb-btn" onClick={() => setShowTemplates(true)}>
                    <Ic n="layers" size={14} /> {t('tpl.open')}
                  </button>
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
                className={`wb-card${picked.has(it.id) ? ' is-picked' : ''}${dragWf?.ids.includes(it.id) ? ' is-dragging' : ''}${leaving.has(it.id) ? ' is-leaving' : ''}`}
                draggable
                onDragStart={(e) => onCardDragStart(e, it)}
                onDragEnd={onCardDragEnd}
                onClick={() => {
                  if (noClickRef.current) return;   // 刚拖完，部分引擎会补发 click
                  if (selectMode) togglePick(it.id); else go(`#/wf/${it.id}`);
                }}
              >
                <div
                  className={`wb-card__thumb${it.thumb ? ' has-img' : ''}`}
                  style={{ '--card-accent': it.categoryId ? catColor(it.categoryId) : 'var(--accent)' }}
                >
                  {/* draggable={false}：图片默认可拖，不关掉就从图上起手变成「拖这张图」 */}
                  {it.thumb && <img className="wb-card__img" src={it.thumb} alt="" loading="lazy" draggable={false} />}
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
                      <button
                        type="button"
                        className="wb-icon-btn wb-icon-btn--sm"
                        title={t('home.card.menu')}
                        onClick={() => { setMenuId((v) => (v === it.id ? null : it.id)); setMenuStage('main'); }}
                      >
                        <Ic n="more" size={15} />
                      </button>
                      {menuId === it.id && (
                        <div className="wb-menu wb-menu--right">
                          {menuStage === 'move' ? (
                            <>
                              <button type="button" className="wb-menu__item wb-menu__back" onClick={() => setMenuStage('main')}>
                                <Ic n="back" size={13} /> {t('common.back')}
                              </button>
                              <div className="wb-menu__sep" />
                              <button type="button" className="wb-menu__item" onClick={() => moveOne(it, null)}>
                                <span className="wb-cats__dot" style={{ background: 'var(--line-strong)' }} />
                                <span className="wb-cats__name">{t('home.uncategorized')}</span>
                                {!it.categoryId && <Ic n="check" size={13} className="wb-menu__chk is-on" />}
                              </button>
                              {cats.items.map((c) => (
                                <button key={c.id} type="button" className="wb-menu__item" onClick={() => moveOne(it, c.id)}>
                                  <span className="wb-cats__dot" style={{ background: c.color }} />
                                  <span className="wb-cats__name">{c.name}</span>
                                  {it.categoryId === c.id && <Ic n="check" size={13} className="wb-menu__chk is-on" />}
                                </button>
                              ))}
                            </>
                          ) : (
                            <>
                              <button type="button" className="wb-menu__item" onClick={() => rename(it)}>
                                <Ic n="rename" size={13} /> {t('common.rename')}
                              </button>
                              <button type="button" className="wb-menu__item" onClick={() => duplicate(it)}>
                                <Ic n="duplicate" size={13} /> {t('common.duplicate')}
                              </button>
                              <button type="button" className="wb-menu__item" onClick={() => setMenuStage('move')}>
                                <Ic n="move" size={13} /> {t('home.category.move')}
                                <Ic n="chevronRight" size={13} className="wb-menu__chk" />
                              </button>
                              <button type="button" className="wb-menu__item" onClick={() => exportOne(it)}>
                                <Ic n="download" size={13} /> {t('home.export')}
                              </button>
                              <div className="wb-menu__sep" />
                              <button type="button" className="wb-menu__item wb-menu__item--danger" onClick={() => remove(it)}>
                                <Ic n="remove" size={13} /> {t('common.delete')}
                              </button>
                            </>
                          )}
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
      {showTemplates && (
        <TemplatePicker
          onClose={() => setShowTemplates(false)}
          onCreated={(id) => { setShowTemplates(false); go(`/wf/${id}`); }}
        />
      )}
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

