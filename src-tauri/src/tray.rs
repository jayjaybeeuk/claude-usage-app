//! System tray with dynamic usage stats, ported from the Electron tray.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::claude;
use crate::settings;
use crate::state::{AppState, TrayStats};

pub const TRAY_ID: &str = "main-tray";

fn tray_icon() -> tauri::image::Image<'static> {
    tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
        .expect("invalid embedded tray icon")
}

fn build_menu(app: &AppHandle, stats: Option<&TrayStats>) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;

    if let Some(s) = stats {
        menu.append(&MenuItem::with_id(app, "hdr-claude", "Claude", false, None::<&str>)?)?;
        menu.append(&MenuItem::with_id(
            app,
            "stat-session",
            format!("  Session:  {}%", s.session.round() as i64),
            false,
            None::<&str>,
        )?)?;
        menu.append(&MenuItem::with_id(
            app,
            "stat-weekly",
            format!("  Weekly:   {}%", s.weekly.round() as i64),
            false,
            None::<&str>,
        )?)?;
        if s.sonnet > 0.0 {
            menu.append(&MenuItem::with_id(
                app,
                "stat-sonnet",
                format!("  Sonnet:   {}%", s.sonnet.round() as i64),
                false,
                None::<&str>,
            )?)?;
        }
        if s.codex_session.is_some() || s.codex_weekly.is_some() {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
            menu.append(&MenuItem::with_id(app, "hdr-codex", "Codex", false, None::<&str>)?)?;
            if let Some(cs) = s.codex_session {
                menu.append(&MenuItem::with_id(
                    app,
                    "stat-codex-session",
                    format!("  Session:  {}%", cs.round() as i64),
                    false,
                    None::<&str>,
                )?)?;
            }
            if let Some(cw) = s.codex_weekly {
                menu.append(&MenuItem::with_id(
                    app,
                    "stat-codex-weekly",
                    format!("  Weekly:   {}%", cw.round() as i64),
                    false,
                    None::<&str>,
                )?)?;
            }
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }

    menu.append(&MenuItem::with_id(app, "show", "Show Widget", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "logout", "Log Out", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?)?;

    Ok(menu)
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "show" => {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                #[cfg(target_os = "macos")]
                let _ = win.set_focus();
            }
        }
        "refresh" => {
            let _ = app.emit("refresh-usage", ());
        }
        "logout" => {
            settings::delete(app, "sessionKey");
            settings::delete(app, "organizationId");
            claude::clear_webview_session(app);
            let _ = app.emit("session-expired", ());
            *app.state::<AppState>().tray_stats.lock().unwrap() = None;
            update_tray(app);
        }
        "exit" => {
            app.exit(0);
        }
        _ => {}
    }
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app, None)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_icon())
        .icon_as_template(true)
        .tooltip("Agent Usage")
        .menu(&menu)
        .on_menu_event(handle_menu_event);

    // On macOS a click opens the menu (matching Electron's context-menu tray).
    // Elsewhere, left click toggles the widget and right click opens the menu.
    if cfg!(target_os = "macos") {
        builder = builder.show_menu_on_left_click(true);
    } else {
        builder = builder.show_menu_on_left_click(false).on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(win) = tray.app_handle().get_webview_window("main") {
                    if win.is_visible().unwrap_or(false) {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                    }
                }
            }
        });
    }

    builder.build(app)?;
    Ok(())
}

pub fn update_tray(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let stats = app.state::<AppState>().tray_stats.lock().unwrap().clone();

    #[cfg(target_os = "macos")]
    {
        match &stats {
            Some(s) => {
                let claude_pct = format!("{}%", s.session.round() as i64);
                let codex_pct = s
                    .codex_session
                    .map(|cs| format!(" ✦{}%", cs.round() as i64))
                    .unwrap_or_default();
                let _ = tray.set_title(Some(format!("{claude_pct}{codex_pct}")));
            }
            None => {
                let _ = tray.set_title(None::<&str>);
            }
        }
    }

    if let Ok(menu) = build_menu(app, stats.as_ref()) {
        let _ = tray.set_menu(Some(menu));
    }

    match &stats {
        Some(s) => {
            let codex_info = s
                .codex_session
                .map(|cs| format!(" | Codex Session: {}%", cs.round() as i64))
                .unwrap_or_default();
            let _ = tray.set_tooltip(Some(format!(
                "Agent Usage — Claude Session: {}% | Weekly: {}%{}",
                s.session.round() as i64,
                s.weekly.round() as i64,
                codex_info
            )));
        }
        None => {
            let _ = tray.set_tooltip(Some("Agent Usage"));
        }
    }
}

#[tauri::command]
pub fn update_tray_usage(app: AppHandle, stats: TrayStats) {
    *app.state::<AppState>().tray_stats.lock().unwrap() = Some(stats);
    update_tray(&app);
}
