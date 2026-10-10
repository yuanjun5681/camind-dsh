const SIDEBAR_DEFAULT = 280;
const DARK_ATTRIBUTE = 'data-ds-dark-theme';
const THEME_SOURCE_ATTRIBUTE = 'data-ds-theme-source';
const CONTENT_FONT_SIZE_VARIABLE = '--dsh-content-font-size';
let layoutState = {
    sidebar: SIDEBAR_DEFAULT,
    narrow: false,
    narrowExpanded: false,
    activePanel: null,
    rightbar: { open: false, track: false, fullscreen: false },
};
const layoutListeners = new Set();
function emitLayout() {
    for (const listener of layoutListeners)
        listener();
}
function writeLayout(patch) {
    layoutState = { ...layoutState, ...patch };
    emitLayout();
}
export function getLayoutSnapshot() {
    return layoutState;
}
export function subscribeLayout(listener) {
    layoutListeners.add(listener);
    return () => { layoutListeners.delete(listener); };
}
export const layoutActions = {
    setSidebar(px) {
        writeLayout({ sidebar: Math.min(420, Math.max(264, Math.round(px))) });
    },
    toggleSidebar() {
        if (layoutState.narrow)
            writeLayout({ narrowExpanded: !layoutState.narrowExpanded });
        else
            writeLayout({ sidebar: layoutState.sidebar === 0 ? SIDEBAR_DEFAULT : 0 });
    },
    setNarrow(narrow) {
        if (layoutState.narrow === narrow)
            return;
        writeLayout({ narrow, narrowExpanded: false });
    },
};
class LayoutController {
    /** Root-scoped navigation state exposed to panel-aware components. */
    panelInfo = {
        getSnapshot: () => ({ activePanelId: layoutState.activePanel }),
        subscribe: (listener) => subscribeLayout(listener),
    };
    #slots;
    #navigation = new AbortController();
    attachSlots(slots) {
        this.#slots = slots;
    }
    selectPanel(panelId) {
        if (panelId !== null && !this.#slots?.entries('main').some((entry) => entry.options.key === panelId)) {
            throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`);
        }
        this.#navigation.abort();
        this.#navigation = new AbortController();
        writeLayout({ activePanel: panelId });
    }
    beginNavigation() {
        this.#navigation.abort();
        this.#navigation = new AbortController();
        return this.#navigation.signal;
    }
    dispose() {
        this.#navigation.abort();
    }
    toggleSidebar() {
        layoutActions.toggleSidebar();
    }
    openRightbar(track, fullscreen) {
        writeLayout({ rightbar: { open: true, track, fullscreen } });
    }
    closeRightbar() {
        writeLayout({ rightbar: { open: false, track: false, fullscreen: false } });
    }
}
/** 与上游 ui-layout theme-presenter 同口径：color-scheme + palette 属性 +
 * 主题来源属性 + 内容字号轴 + token 内联 + theme-color。 */
class ThemePresenter {
    appliedTokens = [];
    themeColorMeta = document.createElement('meta');
    constructor() {
        this.themeColorMeta.name = 'theme-color';
    }
    apply(snapshot) {
        const scheme = snapshot.active.colorScheme;
        document.documentElement.style.colorScheme = scheme;
        document.documentElement.setAttribute(THEME_SOURCE_ATTRIBUTE, snapshot.preference === 'system' ? 'system' : scheme);
        const body = document.body;
        if (scheme === 'dark')
            body.setAttribute(DARK_ATTRIBUTE, '');
        else
            body.removeAttribute(DARK_ATTRIBUTE);
        if (typeof snapshot.fontSize === 'number') {
            body.style.setProperty(CONTENT_FONT_SIZE_VARIABLE, `${snapshot.fontSize}px`);
        }
        for (const name of this.appliedTokens)
            body.style.removeProperty(name);
        this.appliedTokens = [];
        for (const [name, value] of Object.entries(snapshot.active.tokens)) {
            body.style.setProperty(name, value);
            this.appliedTokens.push(name);
        }
        this.themeColorMeta.content = getComputedStyle(body).backgroundColor;
        if (!this.themeColorMeta.isConnected)
            document.head.append(this.themeColorMeta);
    }
    dispose() {
        document.documentElement.style.removeProperty('color-scheme');
        document.documentElement.removeAttribute(THEME_SOURCE_ATTRIBUTE);
        const body = document.body;
        body.removeAttribute(DARK_ATTRIBUTE);
        body.style.removeProperty(CONTENT_FONT_SIZE_VARIABLE);
        for (const name of this.appliedTokens)
            body.style.removeProperty(name);
        this.appliedTokens = [];
        this.themeColorMeta.remove();
    }
}
export const layoutShim = {
    name: 'ui-shell-layout-shim',
    inject: ['slots', 'theme'],
    apply(ctx) {
        const host = ctx;
        const layout = new LayoutController();
        layout.attachSlots(host.slots);
        ctx.effect(() => host.reflect.provide('layout', layout), 'ui-shell-layout: service');
        ctx.effect(() => host.slots.provideRoot({ hooks: { panelInfo: layout.panelInfo } }), 'ui-shell-layout: panelInfo');
        ctx.effect(() => () => layout.dispose(), 'ui-shell-layout: navigation');
        ctx.effect(() => {
            const presenter = new ThemePresenter();
            presenter.apply(host.theme.getTheme());
            const off = ctx.on('theme/change', (snapshot) => {
                presenter.apply(snapshot);
            });
            return () => {
                off();
                presenter.dispose();
            };
        }, 'ui-shell-layout: theme presenter');
    },
};
