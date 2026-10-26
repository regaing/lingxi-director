import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ic } from './Icons.jsx';
import { useI18n } from '../i18n.jsx';
import { assetKind } from '../graph/model.js';

const MIN_SCALE = 1;
const MAX_SCALE = 8;

/**
 * 素材放大预览：全屏遮罩 + 滚轮缩放 + 拖拽平移 + 多张左右切换。
 * 只有图片自己实现缩放；视频/音频交回浏览器原生控件（自绘播放条只会更难用）。
 * 走 portal 挂到 body：`position: fixed` 遇到带 transform 的祖先会锚错地方。
 */
export default function AssetLightbox({ items = [], index = 0, onClose, onIndexChange }) {
  const { t } = useI18n();
  const item = items[index] || null;
  const kind = assetKind(item);
  const file = item?.asset || item?.name || '';
  const src = file ? `/api/assets/${file}` : '';
  const multi = items.length > 1;

  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null);
  const [view, setView] = useState({ scale: MIN_SCALE, x: 0, y: 0 });

  /** contain 之后的实际显示尺寸决定能拖多远：图还没铺满画布时不该被拖出边界 */
  const limits = useCallback((scale) => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img || !img.naturalWidth) return { maxX: 0, maxY: 0 };
    // max-width/height:100% 只缩小不放大：小图按原尺寸渲染，不能按「铺满舞台」算可拖范围
    const fit = Math.min(1, stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight);
    return {
      maxX: Math.max(0, (img.naturalWidth * fit * scale - stage.clientWidth) / 2),
      maxY: Math.max(0, (img.naturalHeight * fit * scale - stage.clientHeight) / 2),
    };
  }, []);

  const clamp = useCallback((v) => {
    if (v.scale <= MIN_SCALE) return { scale: MIN_SCALE, x: 0, y: 0 };
    const { maxX, maxY } = limits(v.scale);
    return {
      scale: v.scale,
      x: Math.max(-maxX, Math.min(maxX, v.x)),
      y: Math.max(-maxY, Math.min(maxY, v.y)),
    };
  }, [limits]);

  const reset = useCallback(() => setView({ scale: MIN_SCALE, x: 0, y: 0 }), []);

  /** 以某个屏幕点为中心缩放：该点底下的画面保持不动（滚轮和双击都走这里） */
  const zoomAt = useCallback((nextScale, clientX, clientY) => {
    setView((v) => {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
      const stage = stageRef.current;
      if (scale === MIN_SCALE || !stage) return scale === MIN_SCALE ? { scale, x: 0, y: 0 } : { ...v, scale };
      const r = stage.getBoundingClientRect();
      const px = clientX - (r.left + r.width / 2);
      const py = clientY - (r.top + r.height / 2);
      const k = scale / v.scale;
      return clamp({ scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
    });
  }, [clamp]);

  // 换图复位，否则上一张的缩放/位移会跟到下一张
  useEffect(() => { reset(); }, [index, reset]);

  /**
   * 键盘：Esc 关闭、← → 切图、+ - 缩放、0 复位。
   * 必须挂 capture 阶段并就地 stopPropagation —— 编辑器在 window 上也听着 keydown
   * （Esc 清选中、Delete 删节点），不拦的话预览开着按 Delete 会把节点删掉。
   */
  useEffect(() => {
    const onKey = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!multi) return;
        e.preventDefault();
        const step = e.key === 'ArrowLeft' ? -1 : 1;
        onIndexChange?.((index + step + items.length) % items.length);
        return;
      }
      if (kind !== 'image') return;
      const stage = stageRef.current;
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(view.scale * 1.25, cx, cy); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(view.scale / 1.25, cx, cy); }
      else if (e.key === '0') { e.preventDefault(); reset(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, items.length, multi, kind, view.scale, zoomAt, reset, onClose, onIndexChange]);

  // 滚轮缩放：React 的 onWheel 监听是 passive 的，preventDefault 会被浏览器忽略，只能自己挂
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || kind !== 'image') return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      zoomAt(view.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [kind, view.scale, zoomAt]);

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const onBlank = e.target === stageRef.current;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false, onBlank };
    if (kind === 'image' && view.scale > MIN_SCALE) e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (!d.moved || kind !== 'image' || view.scale <= MIN_SCALE) return;
    setView((v) => clamp({ scale: v.scale, x: d.ox + dx, y: d.oy + dy }));
  }

  function onPointerUp() {
    const d = dragRef.current;
    dragRef.current = null;
    // 点空白（没拖动）才关闭：拖完松手不该把预览一起关掉
    if (d && d.onBlank && !d.moved) onClose?.();
  }

  function onDoubleClick(e) {
    if (kind !== 'image') return;
    if (view.scale > MIN_SCALE) { reset(); return; }
    zoomAt(2.5, e.clientX, e.clientY);
  }

  if (!item) return null;

  const pct = Math.round(view.scale * 100);
  const step = (dir) => onIndexChange?.((index + dir + items.length) % items.length);

  return createPortal(
    <div className="wb-lightbox" role="dialog" aria-modal="true" aria-label={t('asset.preview')}>
      <div className="wb-lightbox__bar">
        <Ic n={kind === 'audio' ? 'audio' : 'film'} size={14} className="wb-lightbox__glyph" />
        <span className="wb-lightbox__name" title={item.name || file}>{item.name || file}</span>
        <span className="wb-lightbox__meta">
          {multi ? `${index + 1}/${items.length} · ` : ''}
          {kind === 'image' && item.w ? `${item.w}×${item.h} · ` : ''}
          {t(`asset.${kind}`)}
        </span>
        <button type="button" className="wb-icon-btn wb-icon-btn--sm" onClick={onClose} aria-label={t('common.close')}>
          <Ic n="close" size={14} />
        </button>
      </div>

      <div
        className={`wb-lightbox__stage${kind === 'image' ? ' is-zoomable' : ''}${view.scale > MIN_SCALE ? ' is-zoomed' : ''}`}
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { dragRef.current = null; }}
        onDoubleClick={onDoubleClick}
      >
        {kind === 'image' && (
          <img
            ref={imgRef}
            className="wb-lightbox__img"
            src={src}
            alt={item.name || ''}
            draggable={false}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          />
        )}
        {kind === 'video' && <video className="wb-lightbox__video" src={src} controls autoPlay loop playsInline />}
        {kind === 'audio' && <audio className="wb-lightbox__audio" src={src} controls autoPlay />}
        {kind === 'file' && <div className="wb-lightbox__none">{t('asset.noPreview')}</div>}
      </div>

      <div className="wb-lightbox__foot">
        {multi && (
          <div className="wb-lightbox__nav">
            <button type="button" className="wb-btn wb-btn--xs" onClick={() => step(-1)} title={t('asset.prev')}>
              <Ic n="chevronLeft" size={13} />
            </button>
            <button type="button" className="wb-btn wb-btn--xs" onClick={() => step(1)} title={t('asset.next')}>
              <Ic n="chevronRight" size={13} />
            </button>
          </div>
        )}
        {kind === 'image' && (
          <div className="wb-lightbox__nav">
            <button type="button" className="wb-btn wb-btn--xs" onClick={() => { const s = stageRef.current; if (!s) return; const r = s.getBoundingClientRect(); zoomAt(view.scale / 1.25, r.left + r.width / 2, r.top + r.height / 2); }} title={t('asset.zoomOut')}>
              <Ic n="zoomOut" size={13} />
            </button>
            <span className="wb-lightbox__pct">{pct}%</span>
            <button type="button" className="wb-btn wb-btn--xs" onClick={() => { const s = stageRef.current; if (!s) return; const r = s.getBoundingClientRect(); zoomAt(view.scale * 1.25, r.left + r.width / 2, r.top + r.height / 2); }} title={t('asset.zoomIn')}>
              <Ic n="zoomIn" size={13} />
            </button>
            <button type="button" className="wb-btn wb-btn--xs" onClick={reset} disabled={view.scale === MIN_SCALE} title={t('asset.zoomFit')}>
              <Ic n="zoomFit" size={13} />
            </button>
          </div>
        )}
        <a className="wb-btn wb-btn--xs" href={src} target="_blank" rel="noreferrer">
          <Ic n="external" size={13} /> {t('asset.openOriginal')}
        </a>
        <span className="wb-lightbox__hint">{kind === 'image' ? t('asset.hint') : t('asset.hintMedia')}</span>
      </div>
    </div>,
    document.body,
  );
}
