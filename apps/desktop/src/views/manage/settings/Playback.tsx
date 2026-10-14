/** 播放 tab:自动播放 / 省流 / 画质(锁档)+ 弹幕开关 + 图片代理。 */
import { useDesktop } from "../../../store/index.ts"
import { SideCard } from "../../../components/StateBlock.tsx"
import { Switch } from "../../../components/Modal.tsx"
import { Row } from "./Row.tsx"

export function Playback() {
  const settings = useDesktop((s) => s.settings)
  const setSetting = useDesktop((s) => s.setSetting)
  if (!settings) return null
  return (
    <>
      <SideCard title="播放" icon="play">
        <Row label="自动播放" help="点开播放页立即起播;关闭后停在首帧，点播放按钮开始。">
          <Switch checked={settings.autoplayVideo} label="自动播放" onChange={(v) => void setSetting("autoplayVideo", v)} />
        </Row>
        <Row label="省流模式" help="不加载任何图片（封面/缩略图留占位），慢网络或按流量计费时用。">
          <Switch checked={settings.dataSaver} label="省流模式" onChange={(v) => void setSetting("dataSaver", v)} />
        </Row>
        <Row label="画质" help="本播放器一律选最高清晰度并锁档 —— 隧道转发的带宽估算不可靠，自动降档会骤降且不回升。">
          <span className="tag">锁最高档</span>
        </Row>
      </SideCard>

      <SideCard title="弹幕" icon="captions">
        <Row label="启用弹幕" help="播放页的总开关;播放页内还可临时关闭。">
          <Switch checked={settings.danmakuEnabled} label="启用弹幕" onChange={(v) => void setSetting("danmakuEnabled", v)} />
        </Row>
      </SideCard>

      <SideCard title="图片" icon="image">
        <Row
          label="防盗链图片走隧道"
          help="命中防盗链图床(sinaimg 等)的图片经宿主转发并带上站内 Referer;关闭后这类图会 403。"
        >
          <Switch checked={settings.imageProxy} label="图片代理" onChange={(v) => void setSetting("imageProxy", v)} />
        </Row>
      </SideCard>
    </>
  )
}
