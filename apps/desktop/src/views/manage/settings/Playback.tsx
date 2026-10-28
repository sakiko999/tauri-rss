/** 播放 tab:自动播放 / 省流 / 画质(锁档)+ 弹幕开关。 */
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
        <Row label="播完自动下一条" help="播到片尾自动播播放队列里的下一条（播过的那条出队）。关闭则播完停住。">
          <Switch
            checked={settings.autoPlayNext}
            label="播完自动下一条"
            onChange={(v) => void setSetting("autoPlayNext", v)}
          />
        </Row>
        <Row label="画质">
          <span className="tag">锁最高档</span>
        </Row>
      </SideCard>

      <SideCard title="弹幕" icon="captions">
        <Row label="启用弹幕" help="播放页的总开关;播放页内还可临时关闭。">
          <Switch checked={settings.danmakuEnabled} label="启用弹幕" onChange={(v) => void setSetting("danmakuEnabled", v)} />
        </Row>
      </SideCard>
    </>
  )
}
