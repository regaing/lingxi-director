import React, { useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';

/**
 * 可删除连线：悬停/选中时在中点浮出 × 按钮。
 * 原版连线太细、几乎点不中，这是「连线删不掉」的直接解法。
 * 删除通过 window 事件交给编辑器处理，这样撤销栈能统一记录。
 */
export default function DeletableEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, selected,
}) {
  const [hover, setHover] = useState(false);
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });

  const show = hover || selected;

  return (
    <>
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ ...style, stroke: show ? 'var(--accent)' : undefined, strokeWidth: show ? 2.2 : undefined }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`wb-edge-x${show ? ' is-on' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('wb:delete-edge', { detail: id }));
          }}
          title="delete edge"
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
