/**
 * OnboardingModal —— 首次启动引导(仅首次,标记记在 usePrefs.onboarded)。
 */
import { usePrefs } from "../../store/prefs.ts"
import { useDesktop } from "../../store/index.ts"
import { Modal } from "../../components/Modal.tsx"
import { Icon } from "../../components/Icon.tsx"
import { overlayBlock } from "../../lib/uiOverlay.ts"

export function OnboardingModal() {
  const onboarded = usePrefs((s) => s.onboarded)
  const setPrefs = usePrefs((s) => s.set)
  const allItems = useDesktop((s) => s.allItems)
  const subscriptions = useDesktop((s) => s.subscriptions)

  if (onboarded) return null

  return (
    <Modal
      open
      onOpenChange={() => setPrefs({ onboarded: true })}
      title="欢迎使用订阅工作台"
      desc="一个把 RSS、视频、直播、社交聚到一起的本地阅读器"
      footer={
        <>
          <span className="t-micro t-dim flex-1">
            当前 {subscriptions.length} 个订阅，{allItems.length} 条内容
          </span>
          <button className="btn btn-primary" onClick={() => setPrefs({ onboarded: true })}>
            开始使用
          </button>
        </>
      }
    >
      <ol className="steps-list" {...overlayBlock("onboarding-steps", "onboarding:steps")}>
        <li>
          <span>
            <b>侧栏</b>是订阅树：内容类型 / 智能订阅（今日、未读、星标、继续）/ 分组下的各个源。顶部的 + 添加新源。
          </span>
        </li>
        <li>
          <span>
            <b>发现</b>里可以按平台浏览分区、搜索房间与主播，取到想看的内容再一键订阅。
          </span>
        </li>
        <li>
          <span>
            <b>播放页</b>是真正的播放器，支持弹幕；直播会显示在线人数与「回直播」按钮。
          </span>
        </li>
        <li>
          <span>
            <b>账号与凭证</b>里扫码或粘贴凭证，可解锁登录档位（如 B站 1080P）。不登录也能用：热门、排行榜、弹幕与全部直播流。
          </span>
        </li>
        <li>
          <span>
            <b>Ctrl/⌘+K</b> 打开命令面板，<b>Ctrl/⌘+R</b> 刷新全部，<b>Ctrl/⌘+\</b> 折叠侧栏。阅读时 <b>j/k</b> 上下切换文章。
          </span>
        </li>
      </ol>
      <div className="banner" data-tone="ok">
        <Icon name="checkCircle" size={15} />
        <div className="banner-body">
          <span className="banner-title">抓取在本机完成</span>
          内容与凭证只存本地，不经任何中转服务器。
        </div>
      </div>
    </Modal>
  )
}
