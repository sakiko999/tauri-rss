/** 通用设置行(标签 + 说明 + 控件)。设置页各 tab 共用。 */
export function Row({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        {help ? <span className="setting-help">{help}</span> : null}
      </span>
      <span className="setting-control">{children}</span>
    </div>
  )
}
