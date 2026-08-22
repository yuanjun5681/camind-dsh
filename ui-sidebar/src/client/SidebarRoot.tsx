/**
 * Sidebar shell copied from the official 0.1.1-rc.2 implementation (the
 * `sidebar.brand.mark`/`sidebar.brand.name` seats are upstream-native since
 * 0.1.1). Local changes: passing the shell's `pathname`/`navigate` into the
 * official `sidebar.footer.action` list (see contract/slots.ts), and an
 * account footer row — user chip left, settings trigger right. The trigger
 * is always rendered with `wide: false` so the official occupant paints its
 * compact rail variant (36px circular icon button) instead of the full-width
 * labeled row.
 */
import { useEffect, useRef, useState } from 'react'
import {
  FishLogo, IconNewChatOutline16, IconPanelLeftOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import css from './SidebarRoot.module.css'

function clsx(...names: Array<string | false | undefined>): string {
  return names.filter(Boolean).join(' ')
}

/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
const COLLAPSE_SETTLE_MS = 150
const SCROLLBAR_LINGER_MS = 2000

/** Local account chip: no account system here, the display name is fixed. */
const ACCOUNT_NAME = 'user'

function avatarColor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return `hsl(${hash % 360} 45% 55%)`
}

function UserChip({ name }: { name: string }) {
  const display = name.charAt(0).toUpperCase() + name.slice(1)
  return (
    <div className={css.userChip} title={name}>
      <span className={css.avatar} style={{ backgroundColor: avatarColor(name) }} aria-hidden="true">
        {display.charAt(0)}
      </span>
      <span className={css.userName}>{display}</span>
    </div>
  )
}

export function SidebarRoot({
  collapsed,
  width,
  pathname,
  navigate,
  startSession,
  toggleSidebar,
  t,
  renderSlot,
}: SidebarRootComponentProps) {
  // Wide content stays mounted while the collapse animates (fading via
  // .collapsed .wide), unmounts at settle, and remounts right away on expand.
  const [settled, setSettled] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) { setSettled(false); return }
    const timer = window.setTimeout(() => { setSettled(true) }, COLLAPSE_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [collapsed])
  const wide = !collapsed || !settled

  // Freeze the content at its expanded width while it fades out (collapsed
  // && wide): the sliding column then clips it instead of reflowing it. The
  // rail layout (.collapsed styles) only applies once the fade settles.
  const lastWideWidth = useRef(width)
  if (!collapsed) lastWideWidth.current = width

  // Rail-in only crossfades a live collapse: a refresh straight into the
  // collapsed state renders the rail statically (no delay-hidden icons).
  const everWide = useRef(!collapsed)
  if (!collapsed) everWide.current = true

  const column = useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }

  useEffect(() => {
    if (!pointerInside) return
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect()
      if (rect === undefined) return
      const inside = event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom
      if (inside) cancelLinger()
      else armLinger()
    }
    document.addEventListener('pointermove', onMove)
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelLinger()
    }
  }, [pointerInside])

  return (
    <div
      ref={column}
      className={clsx(
        css.root, !wide && css.collapsed, !wide && everWide.current && css.railIn,
        collapsed && wide && css.fading, !pointerInside && css.quietBars,
      )}
      style={wide ? { width: collapsed ? lastWideWidth.current : width } : undefined}
      onPointerEnter={() => {
        cancelLinger()
        setPointerInside(true)
      }}
      onPointerLeave={() => { armLinger() }}
    >
      <div className={css.logoRow}>
        {/* Expanded, the brand doubles as a New Session shortcut; the
            collapsed rail's logo is the expand toggle below instead. */}
        {wide && (
          <button
            type="button"
            className={clsx(css.brand, css.wide)}
            aria-label={t('session.new.label')}
            onClick={() => { startSession() }}
          >
            <span className={css.brandIdentity} aria-hidden="true">
              <span className={css.brandMark}>
                {renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: <FishLogo size={24} /> })}
              </span>
              <span className={css.brandName}>
                {renderSlot('sidebar.brand.name', {}, {
                  fallback: (
                    <>
                      <span className={css.fallbackBrandName}>DSH Local Build</span>
                      {process.env.DSH_CLIENT_COMMIT_HASH
                        ? <span className={css.buildRevision}>{process.env.DSH_CLIENT_COMMIT_HASH}</span>
                        : null}
                    </>
                  ),
                })}
              </span>
            </span>
          </button>
        )}
        {/* Rail resting state is the whale mark; hovering swaps in the panel
            icon (the expand affordance, figma sidebar-hover flow). */}
        <Tooltip label={collapsed ? t('toggle.open') : t('toggle.collapse')} delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.toggle)}
            aria-label={collapsed ? t('toggle.open') : t('toggle.collapse')}
            onClick={() => { toggleSidebar() }}
          >
            {!wide && (
              <span className={css.railMark} aria-hidden="true">
                {renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: <FishLogo size={24} /> })}
              </span>
            )}
            {/* Rail icons render at 18 (figma rail spec); expanded keeps the glyph-native sizes. */}
            <IconPanelLeftOutline16 className={css.panelIcon} size={wide ? 16 : 18} />
          </button>
        </Tooltip>
      </div>

      <Tooltip label={t('session.new.label')} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={css.newSession}
          aria-label={t('session.new.label')}
          onClick={() => { startSession() }}
        >
          <IconNewChatOutline16 size={wide ? 14 : 18} />
          {wide && <span className={clsx(css.newSessionLabel, css.wide)}>{t('session.new')}</span>}
        </button>
      </Tooltip>

      <div className={css.regionArea}>
        {renderSlot('sidebar.workspaces', {
          wide,
          expandSidebar: () => { if (collapsed) toggleSidebar() },
        })}
      </div>

      <div className={css.footArea}>
        <div className={css.footerActions}>
          {renderSlot('sidebar.footer.action', { wide, pathname, navigate })}
        </div>
        <div className={css.settingsArea}>
          {wide && <UserChip name={ACCOUNT_NAME} />}
          <div className={css.settingsSlot}>
            {renderSlot('sidebar.settings', { wide: false })}
          </div>
        </div>
      </div>
    </div>
  )
}
