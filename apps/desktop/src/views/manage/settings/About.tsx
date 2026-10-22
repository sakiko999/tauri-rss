/**
 * 关于与更新 tab:版本号 + 手动检查 + 下载进度 + 重启安装。
 *
 * 更新源是 GitHub Releases 的 latest.json(见 tauri.conf.json 的 plugins.updater)。
 * 安装包由 Rust 侧校验签名后拉起 NSIS 安装器 —— 前端拿不到也不该拿私钥。
 *
 * ⚠️ 检查/下载状态不放组件内:切 tab 会卸载本组件,状态与进度必须由
 * lib/update.ts 的模块 store 持有(见那里的注释)。
 */
import { useEffect, useState, useSyncExternalStore } from "react"
import { Icon } from "../../../components/Icon.tsx"
import { SideCard } from "../../../components/StateBlock.tsx"
import { Row } from "./Row.tsx"
import {
  getUpdatePhase,
  installUpdate,
  manualCheck,
  relaunchApp,
  subscribeUpdatePhase,
} from "../../../lib/update.ts"

/** 字节数 → 人类可读(只用于进度文案)。 */
function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

export function About() {
  const updater = globalThis.appHost.updater
  const phase = useSyncExternalStore(subscribeUpdatePhase, getUpdatePhase)
  const [version, setVersion] = useState("—")

  useEffect(() => {
    void updater
      ?.version()
      .then(setVersion)
      .catch(() => {})
  }, [updater])

  const busy = phase.kind === "checking" || phase.kind === "downloading"

  return (
    <>
      <SideCard title="关于" icon="info">
        <Row label="当前版本">
          <span className="tag num">v{version}</span>
        </Row>
        <Row
          label="自动更新"
          help={
            updater
              ? "从 GitHub Releases 检查新版本，安装包经签名校验后安装。"
              : "当前运行环境不支持应用内更新（仅桌面安装版可用）。"
          }
        >
          {updater ? (
            <button className="btn btn-secondary" onClick={() => void manualCheck()} disabled={busy}>
              <Icon name="refresh" size={14} /> {phase.kind === "checking" ? "检查中…" : "检查更新"}
            </button>
          ) : (
            <span className="tag">不支持</span>
          )}
        </Row>

        {phase.kind === "current" ? (
          <p className="setting-help">
            <Icon name="checkCircle" size={13} /> 已是最新版本。
          </p>
        ) : null}

        {phase.kind === "error" ? (
          <p className="setting-help update-error">检查或安装失败：{phase.message}</p>
        ) : null}

        {phase.kind === "available" ? (
          <div className="update-card">
            <div className="update-head">
              <Icon name="download" size={15} />
              <span className="update-title">
                发现新版本 v{phase.info.version}
                <span className="t-micro t-dim">（当前 v{phase.info.currentVersion}）</span>
              </span>
            </div>
            {phase.info.date ? <span className="t-micro t-dim">发布于 {phase.info.date.slice(0, 10)}</span> : null}
            {phase.info.body ? <p className="update-notes">{phase.info.body}</p> : null}
            <button className="btn btn-primary" onClick={() => void installUpdate(phase.info)}>
              <Icon name="download" size={14} /> 下载并安装
            </button>
          </div>
        ) : null}

        {phase.kind === "downloading" ? (
          <div className="update-card">
            <div className="update-head">
              <Icon name="download" size={15} />
              <span className="update-title">正在下载 v{phase.info.version}…</span>
            </div>
            <div
              className="update-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={phase.total ?? undefined}
              aria-valuenow={phase.total ? phase.downloaded : undefined}
            >
              <span
                style={{
                  width: phase.total ? `${Math.min(100, (phase.downloaded / phase.total) * 100)}%` : "35%",
                }}
              />
            </div>
            <span className="t-micro t-dim num">
              {fmtBytes(phase.downloaded)}
              {phase.total ? ` / ${fmtBytes(phase.total)}` : ""}
            </span>
          </div>
        ) : null}

        {phase.kind === "installed" ? (
          <div className="update-card">
            <div className="update-head">
              <Icon name="checkCircle" size={15} />
              <span className="update-title">v{phase.info.version} 已安装</span>
            </div>
            <p className="setting-help">若应用没有自动重启，点下面的按钮加载新版本。</p>
            <button className="btn btn-secondary" onClick={relaunchApp}>
              <Icon name="refresh" size={14} /> 重启应用
            </button>
          </div>
        ) : null}
      </SideCard>

      <SideCard title="项目" icon="layers">
        <Row label="源码与问题反馈" help="发布包与更新源都托管在 GitHub。">
          <button
            className="btn btn-secondary"
            onClick={() => void globalThis.appHost.openExternal("https://github.com/sakiko999/tauri-rss")}
          >
            <Icon name="external" size={14} /> 打开仓库
          </button>
        </Row>
      </SideCard>
    </>
  )
}
