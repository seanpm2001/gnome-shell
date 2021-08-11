// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
/* exported AppMenu */
const { Clutter, Gio, GLib, Meta, Shell, St } = imports.gi;

const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;

var AppMenu = class AppMenu extends PopupMenu.PopupMenu {
    /**
     * @param {Clutter.Actor} sourceActor - actor the menu is attached to
     * @param {St.Side} side - arrow side
     */
    constructor(sourceActor, side = St.Side.TOP) {
        if (Clutter.get_default_text_direction() === Clutter.TextDirection.RTL) {
            if (side === St.Side.LEFT)
                side = St.Side.RIGHT;
            else if (side === St.Side.RIGHT)
                side = St.Side.LEFT;
        }

        super(sourceActor, 0.5, side);

        this.actor.add_style_class_name('app-menu');

        this._app = null;
        this._appSystem = Shell.AppSystem.get_default();

        this._windowsChangedId = 0;
        this._updateWindowsLaterId = 0;

        /* Translators: This is the heading of a list of open windows */
        this._openWindowsHeader = new PopupMenu.PopupSeparatorMenuItem(_('Open Windows'));
        this.addMenuItem(this._openWindowsHeader);

        this._windowSection = new PopupMenu.PopupMenuSection();
        this.addMenuItem(this._windowSection);

        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._newWindowItem = this.addAction(_('New Window'), () => {
            this._animateLaunch();
            this._app.open_new_window(-1);
            Main.overview.hide();
        });

        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._actionSection = new PopupMenu.PopupMenuSection();
        this.addMenuItem(this._actionSection);

        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._detailsItem = this.addAction(_('Show Details'), async () => {
            const id = this._app.get_id();
            const args = GLib.Variant.new('(ss)', [id, '']);
            const bus = await Gio.DBus.get(Gio.BusType.SESSION, null);
            bus.call(
                'org.gnome.Software',
                '/org/gnome/Software',
                'org.gtk.Actions', 'Activate',
                new GLib.Variant('(sava{sv})', ['details', [args], null]),
                null, 0, -1, null);
        });

        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.addAction(_('Quit'), () => this._app.request_quit());

        this._signals = [];
        this._signals.push([
            this._appSystem,
            this._appSystem.connect('installed-changed',
                () => this._updateDetailsVisibility()),
        ]);
        this._updateDetailsVisibility();
    }

    _updateDetailsVisibility() {
        const sw = this._appSystem.lookup_app('org.gnome.Software.desktop');
        this._detailsItem.visible = sw !== null;
    }

    _animateLaunch() {
        if (this.sourceActor.animateLaunch)
            this.sourceActor.animateLaunch();
    }

    /** */
    destroy() {
        super.destroy();

        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];

        this.setApp(null);
    }

    /**
     * @returns {bool} - true if the menu is empty
     */
    isEmpty() {
        if (!this._app)
            return true;
        return super.isEmpty();
    }

    /**
     * @param {Shell.App} app - the app the menu represents
     */
    setApp(app) {
        if (this._app === app)
            return;

        if (this._windowsChangedId)
            this._app.disconnect(this._windowsChangedId);
        this._windowsChangedId = 0;

        this._app = app;

        if (app) {
            this._windowsChangedId = app.connect('windows-changed',
                () => this._queueUpdateWindowsSection());
        }

        this._updateWindowsSection();

        const appInfo = app?.app_info;
        const actions = appInfo?.list_actions() ?? [];

        this._actionSection.removeAll();
        actions.forEach(action => {
            const label = appInfo.get_action_name(action);
            this._actionSection.addAction(label, event => {
                if (action === 'new-window')
                    this._animateLaunch();

                this._app.launch_action(action, event.get_time(), -1);
                Main.overview.hide();
            });
        });

        this._newWindowItem.visible =
            app && app.can_open_new_window() && !actions.includes('new-window');
    }

    _queueUpdateWindowsSection() {
        if (this._updateWindowsLaterId)
            return;

        this._updateWindowsLaterId = Meta.later_add(
            Meta.LaterType.BEFORE_REDRAW, () => {
                this._updateWindowsSection();
                return GLib.SOURCE_REMOVE;
            });
    }

    _updateWindowsSection() {
        if (this._updateWindowsLaterId)
            Meta.later_remove(this._updateWindowsLaterId);
        this._updateWindowsLaterId = 0;

        this._windowSection.removeAll();
        this._openWindowsHeader.hide();

        if (!this._app)
            return;

        const windows = this._app.get_windows();
        if (windows.length < 2)
            return;

        this._openWindowsHeader.show();

        windows.forEach(window => {
            const title = window.title || this._app.get_name();
            const item = this._windowSection.addAction(title, event => {
                Main.activateWindow(window, event.get_time());
            });
            const id = window.connect('notify::title', () => {
                item.label.text = window.title || this._app.get_name();
            });
            item.connect('destroy', () => window.disconnect(id));
        });
    }
};