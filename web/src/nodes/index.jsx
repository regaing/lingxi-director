import React from 'react';
import BaseNode from './BaseNode.jsx';

/** 所有节点共用同一个渲染器：布局由 NODE_DEFS 驱动，加类型只要在这里登记一行 */
const nodeTypes = {
  'text.prompt': BaseNode,
  'text.negative': BaseNode,
  'text.merge': BaseNode,
  'media.image': BaseNode,
  'media.video': BaseNode,
  'media.audio': BaseNode,
  'param.video': BaseNode,
  'task.source': BaseNode,
  'logic.condition': BaseNode,
  'gen.video': BaseNode,
  'gen.context': BaseNode,
  'gen.regen': BaseNode,
  'task.watch': BaseNode,
  'text.vars': BaseNode,
  'video.frame': BaseNode,
  'video.concat': BaseNode,
  'image.fit': BaseNode,
  'video.info': BaseNode,
  'output.preview': BaseNode,
  'output.download': BaseNode,
};

export default nodeTypes;
