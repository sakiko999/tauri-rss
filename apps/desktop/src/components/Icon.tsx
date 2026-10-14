/**
 * Icon —— 语义名 → lucide 图标。视图里只写语义名(如 "live"/"star"),不直接引 lucide,
 * 便于统一换图标集 / 调默认尺寸笔画。
 */
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bookmark,
  Captions,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Columns2,
  Command,
  Compass,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  Gauge,
  Heart,
  Image as ImageIcon,
  Inbox,
  Info,
  LayoutGrid,
  Layers,
  List,
  ListVideo,
  Loader2,
  Lock,
  Maximize,
  MessageSquare,
  Minimize,
  Moon,
  MoreHorizontal,
  Music,
  PanelLeft,
  Pause,
  Pencil,
  Play,
  Plus,
  QrCode,
  Radio,
  RefreshCw,
  Rss,
  Search,
  Settings,
  Shield,
  SkipBack,
  SkipForward,
  Sparkles,
  Star,
  Sun,
  Tag,
  Trash2,
  Type,
  Upload,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

const MAP: Record<string, LucideIcon> = {
  // 导航 / 库
  layers: Layers,
  rss: Rss,
  play: Play,
  music: Music,
  radio: Radio,
  message: MessageSquare,
  star: Star,
  heart: Heart,
  sun: Sun,
  moon: Moon,
  inbox: Inbox,
  compass: Compass,
  clock: Clock,
  bookmark: Bookmark,
  folder: Folder,
  folderOpen: FolderOpen,
  tag: Tag,
  settings: Settings,
  panelLeft: PanelLeft,
  list: List,
  grid: LayoutGrid,
  columns: Columns2,
  image: ImageIcon,
  database: Database,
  type: Type,

  // 动作
  plus: Plus,
  command: Command,
  refresh: RefreshCw,
  external: ExternalLink,
  search: Search,
  close: X,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  more: MoreHorizontal,
  edit: Pencil,
  trash: Trash2,
  download: Download,
  upload: Upload,
  back: ArrowLeft,
  check: Check,
  loader: Loader2,

  // 播放器
  pause: Pause,
  skipBack: SkipBack,
  skipForward: SkipForward,
  volume: Volume2,
  mute: VolumeX,
  fullscreen: Maximize,
  exitFullscreen: Minimize,
  live: Radio,
  captions: Captions,
  speed: Gauge,
  queue: ListVideo,
  monitor: LayoutGrid,

  // 状态
  alert: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  checkCircle: CheckCircle2,
  offline: WifiOff,
  lock: Lock,
  sparkle: Sparkles,
  shield: Shield,
  qr: QrCode,
  eye: Eye,
  eyeOff: EyeOff,
}

export type IconName = keyof typeof MAP

export function Icon({
  name,
  size = 16,
  className,
  strokeWidth = 1.6,
}: {
  name: string
  size?: number
  className?: string
  strokeWidth?: number
}) {
  const Cmp = MAP[name] ?? Info
  return <Cmp size={size} className={className} strokeWidth={strokeWidth} aria-hidden focusable={false} />
}

/** 填充变体(状态强调用:星标/播放/暂停)。 */
const SOLID: Record<string, LucideIcon> = { star: Star, play: Play }

export function SolidIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Cmp = SOLID[name]
  if (!Cmp) return <Icon name={name} size={size} className={className} />
  return <Cmp size={size} className={className} fill="currentColor" aria-hidden focusable={false} />
}
