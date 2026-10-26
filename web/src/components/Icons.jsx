/**
 * 图标统一出口：只在这里 import lucide，业务代码一律用这里的名字。
 * 好处：换图标库 / 统一线宽与尺寸只改一处；也避免各页面散落 size={16} size={18}。
 */
import React from 'react';
import {
  ArrowLeft, Save, ShieldCheck, Gauge, Play, LoaderCircle, ListChecks,
  Languages, Settings, Bell, BellRing, FolderPlus, Folder, Pencil, Trash2,
  Copy, MoreVertical, Search, Plus, GripVertical, Sparkles, X, Download,
  Check, AlertTriangle, Zap, Clapperboard, Layers, RefreshCw, Inbox,
  ChevronDown, ChevronRight, Info, CircleCheck, CircleX, Clock, FastForward,
  PlayCircle, Megaphone, ArrowUpRight, SlidersHorizontal, Wand2, GitBranch,
  Combine, ExternalLink, Film, CheckCheck, CircleDot, ArrowRightLeft, Upload,
  PanelLeft, PanelRight, RotateCcw, RotateCw, Music,
  ChevronLeft, ZoomIn, ZoomOut, Maximize,
} from 'lucide-react';

const base = (size, strokeWidth, rest) => ({
  size,
  strokeWidth,
  absoluteStrokeWidth: true,
  ...rest,
});

/** 通用图标：默认 16px、1.7 线宽（在 13px 正文里不糊也不发飘） */
export const Icon = ({ as: Cmp, size = 16, strokeWidth = 1.7, ...rest }) =>
  <Cmp {...base(size, strokeWidth, rest)} />;

export const Icons = {
  back: ArrowLeft,
  save: Save,
  validate: ShieldCheck,
  estimate: Gauge,
  run: Play,
  running: LoaderCircle,
  tasks: ListChecks,
  lang: Languages,
  settings: Settings,
  bell: Bell,
  bellRing: BellRing,
  categoryNew: FolderPlus,
  category: Folder,
  rename: Pencil,
  remove: Trash2,
  duplicate: Copy,
  more: MoreVertical,
  search: Search,
  add: Plus,
  drag: GripVertical,
  sparkles: Sparkles,
  close: X,
  download: Download,
  check: Check,
  warn: AlertTriangle,
  zap: Zap,
  brand: Clapperboard,
  layers: Layers,
  refresh: RefreshCw,
  empty: Inbox,
  inbox: Inbox,
  play: Play,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronLeft: ChevronLeft,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  zoomFit: Maximize,
  info: Info,
  ok: CircleCheck,
  fail: CircleX,
  clock: Clock,
  runTo: FastForward,
  runSingle: PlayCircle,
  notice: Megaphone,
  open: ArrowUpRight,
  params: SlidersHorizontal,
  optimize: Wand2,
  branch: GitBranch,
  merge: Combine,
  external: ExternalLink,
  film: Film,
  audio: Music,
  readAll: CheckCheck,
  dot: CircleDot,
  move: ArrowRightLeft,
  upload: Upload,
  collapseLeft: PanelLeft,
  collapseRight: PanelRight,
  undo: RotateCcw,
  redo: RotateCw,
};

/** 便捷组件：<Ic n="play" /> 等价 <Icon as={Icons.play} /> */
export function Ic({ n, size = 16, strokeWidth = 1.7, ...rest }) {
  const Cmp = Icons[n];
  if (!Cmp) return null;
  return <Cmp {...base(size, strokeWidth, rest)} />;
}

export default Icons;
